import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    images = [cv2.imread(path) for path in args.inputs]
    if any(image is None for image in images):
        raise SystemExit("无法读取画布图片")
    width, height = 640, 360
    cells = []
    for index, image in enumerate(images, 1):
        frame = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        cv2.rectangle(frame, (0, 0), (86, 44), (255, 255, 255), -1)
        cv2.putText(frame, f"SCENE {index:02d}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (20, 20, 20), 2, cv2.LINE_AA)
        cells.append(frame)
    columns = 2
    rows = math.ceil(len(cells) / columns)
    blank = np.full((height, width, 3), 255, dtype=np.uint8)
    while len(cells) < rows * columns:
        cells.append(blank.copy())
    sheet = np.vstack([np.hstack(cells[row * columns:(row + 1) * columns]) for row in range(rows)])
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(args.output, sheet)


if __name__ == "__main__":
    main()
