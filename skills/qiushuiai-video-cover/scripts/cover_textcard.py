#!/usr/bin/env python3
import argparse
import os
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CANVAS = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
}

CONTENT = {
    "9:16": (1080, 1440),
    "16:9": (1440, 1080),
}

SAFE_INSET = {
    "9:16": dict(left=100, right=100, top=160, bottom=160),
    "16:9": dict(left=120, right=120, top=80, bottom=80),
}

FONTS_BOLD = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJKsc-Bold.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
]

FONTS_REGULAR = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf",
]


def find_font_path(candidates):
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def load_font(path, size, bold=False):
    if not path:
        return ImageFont.load_default()
    try:
        if path.endswith(".ttc"):
            return ImageFont.truetype(path, size, index=1 if bold else 0)
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def fit_font_size(draw, text, max_width, path, bold, start=180):
    size = start
    while size > 10:
        font = load_font(path, size, bold)
        bbox = draw.textbbox((0, 0), text, font=font)
        if (bbox[2] - bbox[0]) <= max_width:
            return size, font
        size -= 2
    return size, load_font(path, size, bold)


def calc_display_width(text):
    width = 0
    for ch in text:
        if ch.isascii() and not ch.isspace():
            width += 0.5
        else:
            width += 1 if unicodedata.east_asian_width(ch) in ("W", "F") else 0.5
    return width


def split_text_evenly(text):
    total_width = calc_display_width(text)
    half = total_width / 2
    positions = []
    acc = 0
    for index, ch in enumerate(text):
        acc += 0.5 if ch.isascii() and not ch.isspace() else (1 if unicodedata.east_asian_width(ch) in ("W", "F") else 0.5)
        good_break = True
        if index + 1 < len(text):
            curr_in_word = ch.isascii() and not ch.isspace()
            next_in_word = text[index + 1].isascii() and not text[index + 1].isspace()
            if curr_in_word and next_in_word:
                good_break = False
        positions.append((index + 1, acc, good_break))

    best_index = None
    best_dist = float("inf")
    for split_index, cumulative, good_break in positions[:-1]:
        if good_break:
            dist = abs(cumulative - half)
            if dist < best_dist:
                best_dist = dist
                best_index = split_index
    if best_index is None:
        for split_index, cumulative, _ in positions[:-1]:
            dist = abs(cumulative - half)
            if dist < best_dist:
                best_dist = dist
                best_index = split_index
    if best_index is None or best_index >= len(text):
        return [text]
    line_a = text[:best_index].rstrip()
    line_b = text[best_index:].lstrip()
    if not line_a or not line_b:
        return [text]
    return [line_a, line_b]


def generate_cover(line1, line2, ratio, color1, color2, bg, output_path):
    width, height = CANVAS[ratio]
    content_w, content_h = CONTENT[ratio]
    content_x = (width - content_w) // 2
    content_y = (height - content_h) // 2
    safe = SAFE_INSET[ratio]
    safe_x = content_x + safe["left"]
    safe_y = content_y + safe["top"]
    safe_w = content_w - safe["left"] - safe["right"]
    safe_h = content_h - safe["top"] - safe["bottom"]

    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)
    bold_path = find_font_path(FONTS_BOLD)
    reg_path = find_font_path(FONTS_REGULAR)

    size1, _ = fit_font_size(draw, "六六六六六六", safe_w, bold_path, bold=True)
    font1 = load_font(bold_path, size1, bold=True)
    size2 = max(int(size1 * 0.62), 24)
    font2 = load_font(reg_path, size2, bold=False)

    line1_lines = [line1]
    if (draw.textbbox((0, 0), line1, font=font1)[2]) > safe_w:
        line1_lines = split_text_evenly(line1)

    line2_lines = [line2] if line2 else []
    if line2 and (draw.textbbox((0, 0), line2, font=font2)[2]) > safe_w:
        line2_lines = split_text_evenly(line2)

    line1_heights = [draw.textbbox((0, 0), text, font=font1)[3] for text in line1_lines]
    line2_heights = [draw.textbbox((0, 0), text, font=font2)[3] for text in line2_lines]
    intra_gap1 = int(size1 * 0.2)
    intra_gap2 = int(size2 * 0.2)
    inter_gap = int(size1 * 0.35)

    block_h = sum(line1_heights) + intra_gap1 * (len(line1_lines) - 1)
    if line2_lines:
        block_h += inter_gap + sum(line2_heights) + intra_gap2 * (len(line2_lines) - 1)
    cur_y = safe_y + (safe_h - block_h) // 2

    for index, text in enumerate(line1_lines):
        bbox = draw.textbbox((0, 0), text, font=font1)
        x = safe_x + (safe_w - (bbox[2] - bbox[0])) // 2 - bbox[0]
        y = cur_y - bbox[1]
        draw.text((x, y), text, font=font1, fill=color1)
        cur_y += line1_heights[index] + (intra_gap1 if index < len(line1_lines) - 1 else 0)

    if line2_lines:
        cur_y += inter_gap

    for index, text in enumerate(line2_lines):
        bbox = draw.textbbox((0, 0), text, font=font2)
        x = safe_x + (safe_w - (bbox[2] - bbox[0])) // 2 - bbox[0]
        y = cur_y - bbox[1]
        draw.text((x, y), text, font=font2, fill=color2)
        cur_y += line2_heights[index] + (intra_gap2 if index < len(line2_lines) - 1 else 0)

    image.save(output_path, "PNG")
    print(f"ok {ratio} {output_path}")


def build_output_name(prefix, ratio):
    orientation = "横版" if ratio == "16:9" else "竖版"
    suffix = ratio.replace(":", "x")
    return f"{prefix}-{orientation}-{suffix}.png"


def main():
    parser = argparse.ArgumentParser(description="Generate deterministic textcard video covers")
    parser.add_argument("--line1", required=True)
    parser.add_argument("--line2", default="")
    parser.add_argument("--color1", default="#FFD700")
    parser.add_argument("--color2", default="#FFFFFF")
    parser.add_argument("--bg", default="#000000")
    parser.add_argument("--output-dir", default=".")
    parser.add_argument("--prefix", default="cover")
    parser.add_argument("--ratio", default="all", choices=["all", "9:16", "16:9"])
    args = parser.parse_args()

    if calc_display_width(args.line1) > 12:
        print("line1 too long", file=sys.stderr)
        sys.exit(1)
    if args.line2 and calc_display_width(args.line2) > 18:
        print("line2 too long", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ratios = ["9:16", "16:9"] if args.ratio == "all" else [args.ratio]

    for ratio in ratios:
        output_path = output_dir / build_output_name(args.prefix, ratio)
        generate_cover(args.line1, args.line2, ratio, args.color1, args.color2, args.bg, str(output_path))


if __name__ == "__main__":
    main()
