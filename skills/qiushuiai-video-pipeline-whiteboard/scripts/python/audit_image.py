#!/usr/bin/env python3
import argparse
import json
import sys

import cv2
import numpy as np


def metrics(path: str):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"无法读取图片: {path}")
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    bright_ratio = float((gray >= 235).mean())
    dark_ratio = float((gray <= 80).mean())
    mean_value = float(hsv[:, :, 2].mean())
    sat_ratio = float((hsv[:, :, 1] >= 55).mean())

    edges = cv2.Canny(gray, 80, 180)
    edge_ratio = float((edges > 0).mean())

    blur = cv2.GaussianBlur(rgb, (0, 0), 1.2)
    detail = np.abs(rgb.astype(np.int16) - blur.astype(np.int16)).mean(axis=2)
    texture_ratio = float((detail > 18).mean())

    unique_colors = np.unique(rgb.reshape(-1, 3), axis=0)
    palette_ratio = float(len(unique_colors) / rgb.reshape(-1, 3).shape[0])

    reasons = []
    if bright_ratio < 0.55 or mean_value < 205:
      reasons.append("深色背景或整体过暗")
    if sat_ratio > 0.22:
      reasons.append("颜色饱和区域过多，疑似写实或海报风")
    if texture_ratio > 0.20:
      reasons.append("纹理细节过多，疑似写实图像")
    if edge_ratio > 0.12:
      reasons.append("边缘密度过高，疑似非简洁线稿")
    if dark_ratio > 0.32:
      reasons.append("深色实体面积过大，不像白板底图")
    if palette_ratio > 0.015:
      reasons.append("颜色种类过多，疑似非白板线稿")

    return {
        "ok": not reasons,
        "reasons": reasons,
        "metrics": {
            "bright_ratio": round(bright_ratio, 4),
            "dark_ratio": round(dark_ratio, 4),
            "mean_value": round(mean_value, 2),
            "sat_ratio": round(sat_ratio, 4),
            "edge_ratio": round(edge_ratio, 4),
            "texture_ratio": round(texture_ratio, 4),
            "palette_ratio": round(palette_ratio, 6),
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    result = metrics(args.image)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
    print(payload)
    if not result["ok"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
