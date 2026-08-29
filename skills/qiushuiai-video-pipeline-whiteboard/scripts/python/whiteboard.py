#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "command failed")


def duration(path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path)
    ], capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def hand_assets():
    root = Path(__file__).resolve().parents[2]
    return root / "assets" / "drawing-hand.png", root / "assets" / "hand-mask.png"


def prepare_hand():
    hp, mp = hand_assets()
    hand = cv2.imread(str(hp))
    mask = cv2.imread(str(mp), cv2.IMREAD_GRAYSCALE)
    if hand is None or mask is None:
        raise RuntimeError("whiteboard hand assets are missing")
    ys, xs = np.where(mask == 255)
    hand = hand[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    hand[mask == 0] = [0, 0, 0]
    alpha = mask.astype(float) / 255.0
    return hand, alpha, 1.0 - alpha


def draw_region(canvas, ink, image, out, hand, inv, width, height, grid, skip, region=None):
    masked_ink = ink.copy()
    if region is not None:
        masked_ink[region == 0] = 255
    cells = []
    for y in range(0, height, grid):
        for x in range(0, width, grid):
            block = masked_ink[y:min(y + grid, height), x:min(x + grid, width)]
            if np.any(block < 10):
                cells.append((y, x))
    current = (0, 0)
    frame_count = 0
    while cells:
        index = min(range(len(cells)), key=lambda i: math.dist(cells[i], current))
        y, x = cells.pop(index)
        current = (y, x)
        y2, x2 = min(y + grid, height), min(x + grid, width)
        block = masked_ink[y:y2, x:x2]
        if region is None:
            canvas[y:y2, x:x2] = np.repeat(block[:, :, None], 3, axis=2)
        else:
            selected = region[y:y2, x:x2] == 255
            for channel in range(3):
                canvas[y:y2, x:x2, channel][selected] = block[selected]
        frame_count += 1
        if frame_count % skip:
            continue
        frame = canvas.copy()
        hh, hw = min(hand.shape[0], height - y), min(hand.shape[1], width - x)
        if hh > 0 and hw > 0:
            for channel in range(3):
                frame[y:y + hh, x:x + hw, channel] = frame[y:y + hh, x:x + hw, channel] * inv[:hh, :hw]
            frame[y:y + hh, x:x + hw] += hand[:hh, :hw]
        out.write(frame)
    if region is None:
        canvas[:] = image
    else:
        canvas[region == 255] = image[region == 255]


def animate(args):
    image = cv2.imread(args.image)
    if image is None:
        raise RuntimeError(f"cannot read image: {args.image}")
    image = cv2.resize(image, (args.width, args.height))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10)
    hand, mask, inv = prepare_hand()
    out = cv2.VideoWriter(args.output, cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height))
    canvas = np.full_like(image, 255)
    ordered_layers = []
    ordered_layer_names = []
    masks = []
    segmentation_mode = "full_image"
    if args.segmentation and Path(args.segmentation).exists():
        import base64
        data = json.loads(Path(args.segmentation).read_text(encoding="utf-8"))
        for layer in sorted(data.get("ordered_layers", []), key=lambda item: item.get("order", 0)):
            merged = np.zeros((args.height, args.width), dtype=np.uint8)
            for encoded in layer.get("masks_base64", []):
                raw = np.frombuffer(base64.b64decode(encoded), np.uint8)
                part = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
                if part is not None:
                    part = cv2.resize(part, (args.width, args.height))
                    merged = cv2.bitwise_or(merged, cv2.threshold(part, 127, 255, cv2.THRESH_BINARY)[1])
            if np.any(merged):
                ordered_layers.append(merged)
                ordered_layer_names.append(layer.get("name") or f"layer-{len(ordered_layers)}")
        for item in data.get("segmentations", {}).values():
            merged = np.zeros((args.height, args.width), dtype=np.uint8)
            for encoded in item.get("masks_base64", []):
                raw = np.frombuffer(base64.b64decode(encoded), np.uint8)
                part = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
                if part is not None:
                    part = cv2.resize(part, (args.width, args.height))
                    merged = cv2.bitwise_or(merged, cv2.threshold(part, 127, 255, cv2.THRESH_BINARY)[1])
            if np.any(merged):
                masks.append(merged)
    if ordered_layers:
        segmentation_mode = "ordered_layers"
        background = np.full((args.height, args.width), 255, dtype=np.uint8)
        for region in ordered_layers:
            draw_region(canvas, ink, image, out, hand, inv, args.width, args.height, args.grid, args.skip, region)
            background[region == 255] = 0
        draw_region(canvas, ink, image, out, hand, inv, args.width, args.height, 20, 12, background)
        for _ in range(args.fps * args.hold):
            out.write(image)
        out.release()
    else:
        parent = list(range(len(masks)))
        def find(i):
            if parent[i] != i:
                parent[i] = find(parent[i])
            return parent[i]
        for i in range(len(masks)):
            for j in range(i + 1, len(masks)):
                overlap = np.sum(cv2.bitwise_and(masks[i], masks[j]) == 255)
                smaller = min(np.sum(masks[i] == 255), np.sum(masks[j] == 255))
                if smaller and overlap / smaller > .3:
                    parent[find(i)] = find(j)
        groups = {}
        for i, item in enumerate(masks):
            root = find(i)
            groups[root] = cv2.bitwise_or(groups.get(root, np.zeros_like(item)), item)
        if groups:
            segmentation_mode = "sam3_groups"
            background = np.full((args.height, args.width), 255, dtype=np.uint8)
            for region in groups.values():
                draw_region(canvas, ink, image, out, hand, inv, args.width, args.height, args.grid, args.skip, region)
                background[region == 255] = 0
            draw_region(canvas, ink, image, out, hand, inv, args.width, args.height, 20, 12, background)
        else:
            draw_region(canvas, ink, image, out, hand, inv, args.width, args.height, args.grid, args.skip)
        for _ in range(args.fps * args.hold):
            out.write(image)
        out.release()
    raw_duration = duration(args.output)
    final_duration = raw_duration
    target = None
    speed_adjusted = False
    retime_ratio = 1.0
    if args.audio_duration > 0:
        target = max(1.0, args.audio_duration * min(args.coverage, .95))
        if raw_duration > target + .04:
            temp = f"{args.output}.retimed.mp4"
            retime_ratio = target / raw_duration
            run(["ffmpeg", "-y", "-i", args.output, "-vf", f"setpts={retime_ratio:.8f}*PTS", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", temp])
            os.replace(temp, args.output)
            final_duration = duration(args.output)
            speed_adjusted = True
    metrics = {
        "fps": args.fps,
        "grid": args.grid,
        "skip": args.skip,
        "hold": args.hold,
        "coverage": args.coverage,
        "audio_duration_seconds": args.audio_duration,
        "target_max_draw_duration_seconds": target,
        "raw_draw_duration_seconds": raw_duration,
        "final_draw_duration_seconds": final_duration,
        "speed_adjusted": speed_adjusted,
        "retime_ratio": retime_ratio,
        "segmentation_mode": segmentation_mode,
        "ordered_layers_count": len(ordered_layers),
        "ordered_layer_names": ordered_layer_names,
        "sam3_mask_groups_count": len(masks),
        "output": str(Path(args.output).resolve()),
    }
    if args.metrics_output:
        Path(args.metrics_output).write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(Path(args.output).resolve()), "metrics": metrics}, ensure_ascii=False))


def merge(args):
    video_duration, audio_duration = duration(args.video), duration(args.audio)
    pad = max(0, audio_duration - video_duration)
    command = ["ffmpeg", "-y"]
    subtitle_filter = ""
    if args.subtitle:
        subtitle_filter = f"subtitles={args.subtitle}:force_style='FontName=Heiti SC,FontSize=18,Outline=0.6,Shadow=0,PrimaryColour=&HFFFFFF&,MarginV=22'"
    if args.background:
        overlay_chain = "[bg][fg]overlay=0:0:format=auto,setsar=1"
        if subtitle_filter:
            overlay_chain = f"{overlay_chain},{subtitle_filter}"
        command.extend([
            "-loop", "1", "-i", args.background,
            "-i", args.video,
            "-i", args.audio,
            "-filter_complex",
            f"[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[bg];"
            f"[1:v]tpad=stop_mode=clone:stop_duration={pad:.3f},format=rgba,colorkey=0xFFFFFF:0.18:0.08[fg];"
            f"{overlay_chain}[v]",
            "-map", "[v]",
            "-map", "2:a",
        ])
    else:
        vf = f"tpad=stop_mode=clone:stop_duration={pad:.3f}"
        if subtitle_filter:
            vf = f"{vf},{subtitle_filter}"
        command.extend([
            "-i", args.video,
            "-i", args.audio,
            "-vf", vf,
            "-map", "0:v",
            "-map", "1:a",
        ])
    command.extend([
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        args.output,
    ])
    run(command)
    print(json.dumps({"status": "ok", "output": str(Path(args.output).resolve())}, ensure_ascii=False))


def concat(args):
    command = ["ffmpeg", "-y"]
    for item in args.inputs:
        command.extend(["-i", item])
    streams = "".join(f"[{i}:v][{i}:a]" for i in range(len(args.inputs)))
    command.extend(["-filter_complex", f"{streams}concat=n={len(args.inputs)}:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]", "-pix_fmt", "yuv420p", args.output])
    run(command)
    print(json.dumps({"status": "ok", "output": str(Path(args.output).resolve())}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("animate")
    p.add_argument("--image", required=True); p.add_argument("--output", required=True)
    p.add_argument("--width", type=int, default=1920); p.add_argument("--height", type=int, default=1080)
    p.add_argument("--fps", type=int, default=25); p.add_argument("--grid", type=int, default=10)
    p.add_argument("--skip", type=int, default=3); p.add_argument("--hold", type=int, default=1)
    p.add_argument("--segmentation")
    p.add_argument("--audio-duration", type=float, default=0); p.add_argument("--coverage", type=float, default=.95)
    p.add_argument("--metrics-output")
    p.set_defaults(func=animate)
    p = sub.add_parser("merge")
    p.add_argument("--video", required=True); p.add_argument("--audio", required=True)
    p.add_argument("--background")
    p.add_argument("--subtitle"); p.add_argument("--output", required=True)
    p.set_defaults(func=merge)
    p = sub.add_parser("concat")
    p.add_argument("--inputs", nargs="+", required=True); p.add_argument("--output", required=True)
    p.set_defaults(func=concat)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
