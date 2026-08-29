#!/usr/bin/env python3
import argparse
import base64
import io
import json
import mimetypes
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import requests


def local_session():
    session = requests.Session()
    session.trust_env = False
    return session


def rle_to_mask(rle):
    counts = rle.get("counts")
    size = rle.get("size")
    if not counts or not size or len(size) != 2:
        return None
    values = []
    value = 0
    for count in counts:
        values.extend([value] * int(count))
        value = 1 - value
    total = int(size[0]) * int(size[1])
    if len(values) < total:
        values.extend([0] * (total - len(values)))
    mask = np.array(values[:total], dtype=np.uint8).reshape((int(size[0]), int(size[1])))
    return mask * 255


def encode_mask_png(mask):
    buffer = io.BytesIO()
    Image.fromarray(mask).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def region_mask(width, height, box):
    x1, y1, x2, y2 = box
    x1 = max(0, min(width, int(x1)))
    x2 = max(0, min(width, int(x2)))
    y1 = max(0, min(height, int(y1)))
    y2 = max(0, min(height, int(y2)))
    mask = np.zeros((height, width), dtype=np.uint8)
    if x2 > x1 and y2 > y1:
        mask[y1:y2, x1:x2] = 255
    return mask


def normalize_sam3_response(payload):
    results = payload.get("results", payload)
    masks = results.get("masks", [])
    masks_base64 = []
    for item in masks:
        if isinstance(item, dict) and "counts" in item and "size" in item:
            mask = rle_to_mask(item)
            if mask is not None:
                masks_base64.append(encode_mask_png(mask))
        elif isinstance(item, str):
            masks_base64.append(item)
    normalized = dict(payload)
    normalized["masks_base64"] = masks_base64
    return normalized


def segment_with_session_api(base_url, image, obj):
    base = base_url.rstrip("/")
    session = local_session()
    with image.open("rb") as handle:
        upload = session.post(f"{base}/upload", files={"file": (image.name, handle, mimetypes.guess_type(image.name)[0] or "image/png")}, timeout=120)
    upload.raise_for_status()
    session_id = upload.json().get("session_id")
    if not session_id:
        raise RuntimeError(f"SAM upload response missing session_id: {upload.text[:500]}")
    segment = session.post(f"{base}/segment/text", json={"session_id": session_id, "prompt": obj}, timeout=120)
    segment.raise_for_status()
    try:
        session.delete(f"{base}/session/{session_id}", timeout=30)
    except requests.RequestException:
        pass
    return normalize_sam3_response(segment.json())


def segment_with_legacy_api(url, image, obj):
    session = local_session()
    with image.open("rb") as handle:
        sam = session.post(url, files={"file": (image.name, handle, mimetypes.guess_type(image.name)[0] or "image/png")}, data={"prompt": obj}, timeout=120)
    sam.raise_for_status()
    return normalize_sam3_response(sam.json())


def upload_session(base_url, image):
    base = base_url.rstrip("/")
    session = local_session()
    with image.open("rb") as handle:
        upload = session.post(f"{base}/upload", files={"file": (image.name, handle, mimetypes.guess_type(image.name)[0] or "image/png")}, timeout=120)
    upload.raise_for_status()
    session_id = upload.json().get("session_id")
    if not session_id:
        raise RuntimeError(f"SAM upload response missing session_id: {upload.text[:500]}")
    return session, session_id


def segment_with_uploaded_session(session, base_url, session_id, obj):
    base = base_url.rstrip("/")
    segment = session.post(f"{base}/segment/text", json={"session_id": session_id, "prompt": obj}, timeout=120)
    segment.raise_for_status()
    return normalize_sam3_response(segment.json())


def delete_uploaded_session(session, base_url, session_id):
    try:
        session.delete(f"{base_url.rstrip('/')}/session/{session_id}", timeout=30)
    except requests.RequestException:
        pass


def segment_object(sam_url, image, obj):
    try:
        return segment_with_session_api(sam_url, image, obj)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 405):
            try:
                return segment_with_legacy_api(sam_url, image, obj)
            except requests.RequestException as fallback_exc:
                print(f"SAM3 legacy segmentation failed for {obj}: {fallback_exc}", file=sys.stderr)
                return {}
        print(f"SAM3 segmentation failed for {obj}: {exc}", file=sys.stderr)
        return {}
    except requests.RequestException as exc:
        print(f"SAM3 segmentation failed for {obj}: {exc}", file=sys.stderr)
        return {}


def build_ordered_layers(image, segmentations):
    with Image.open(image) as img:
        width, height = img.size
    title_box = [0, 0, int(width * 0.58), int(height * 0.2)]
    layers = [{
        "order": 1,
        "name": "title area",
        "source": "region",
        "region_box": title_box,
        "masks_base64": [encode_mask_png(region_mask(width, height, title_box))],
    }]
    order = 2
    for name, item in segmentations.items():
        masks = item.get("masks_base64", []) if isinstance(item, dict) else []
        if not masks:
            continue
        layers.append({
            "order": order,
            "name": name,
            "source": "sam3",
            "sam_prompt": item.get("prompt", name) if isinstance(item, dict) else name,
            "masks_base64": masks,
        })
        order += 1
    return layers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sam-url", required=True)
    args = parser.parse_args()
    key = os.environ.get("DASHSCOPE_API_KEY")
    if not key:
        raise RuntimeError("DASHSCOPE_API_KEY is required for object identification")
    image = Path(args.image)
    mime = mimetypes.guess_type(image.name)[0] or "image/png"
    encoded = base64.b64encode(image.read_bytes()).decode("ascii")
    prompt = 'Identify 3-5 large, visually distinct object groups in this image that SAM-style segmentation can reliably isolate. Return a raw JSON list of short English noun phrases only, for example: ["person", "stacked boxes", "arrows"]. Prefer physical or diagrammatic regions such as people, boxes, papers, arrows, panels, screens, documents, and large icons. Group smaller related parts into large logical entities. Do not include Chinese. Do not include tiny text labels, title text, decorative marks, or abstract concepts. Do not include markdown formatting or explanation.'
    response = requests.post(
        f"{os.environ.get('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com').rstrip('/')}/compatible-mode/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": os.environ.get("DASHSCOPE_VL_MODEL", "qwen-vl-max"), "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}]}]},
        timeout=120,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"].strip().replace("```json", "").replace("```", "")
    objects = json.loads(content)
    result = {"image_path": str(image.resolve()), "objects": objects, "segmentations": {}}
    session = None
    session_id = None
    try:
        session, session_id = upload_session(args.sam_url, image)
        for obj in objects:
            try:
                result["segmentations"][obj] = segment_with_uploaded_session(session, args.sam_url, session_id, obj)
            except requests.RequestException as exc:
                print(f"SAM3 segmentation failed for {obj}: {exc}", file=sys.stderr)
                result["segmentations"][obj] = {}
    except requests.RequestException as exc:
        print(f"SAM3 upload failed, fallback to per-object compatibility mode: {exc}", file=sys.stderr)
        for obj in objects:
            result["segmentations"][obj] = segment_object(args.sam_url, image, obj)
    finally:
        if session is not None and session_id:
            delete_uploaded_session(session, args.sam_url, session_id)
    result["ordered_layers"] = build_ordered_layers(image, result["segmentations"])
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(Path(args.output).resolve()), "objects": objects}, ensure_ascii=False))


if __name__ == "__main__":
    main()
