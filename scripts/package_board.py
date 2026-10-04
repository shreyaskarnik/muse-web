#!/usr/bin/env python3
"""Copy one board's flashable files out of an ESP-IDF build dir and describe them.

Uses build/flasher_args.json (what `idf.py flash` itself uses), so offsets
come from the build: the C5 bootloader at 0x2000, the SDK's partition table
at 0x10000, the app at 0x20000, and anything a board adds.

Usage: package_board.py <build dir> <out dir> <board> <sdk ref>
Writes <out dir>/<board>/*.bin and <out dir>/<board>/board.json
"""

import json
import shutil
import sys
from pathlib import Path

# ESP Web Tools chipFamily names.
CHIP_FAMILY = {
    "esp32": "ESP32",
    "esp32s2": "ESP32-S2",
    "esp32s3": "ESP32-S3",
    "esp32c3": "ESP32-C3",
    "esp32c5": "ESP32-C5",
    "esp32c6": "ESP32-C6",
    "esp32c61": "ESP32-C61",
    "esp32h2": "ESP32-H2",
    "esp32p4": "ESP32-P4",
}


def main() -> None:
    build, out, board, ref = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
    args = json.loads((build / "flasher_args.json").read_text())
    chip = args["extra_esptool_args"]["chip"]
    app_file = args["app"]["file"]

    dest = out / board
    dest.mkdir(parents=True, exist_ok=True)
    parts = []
    for offset, rel in sorted(args["flash_files"].items(), key=lambda kv: int(kv[0], 16)):
        name = Path(rel).name
        shutil.copyfile(build / rel, dest / name)
        part = {"path": name, "offset": int(offset, 16)}
        if rel == app_file:
            part["app"] = True  # the page patches the SDK token into this one
        parts.append(part)

    if sum(1 for p in parts if p.get("app")) != 1:
        sys.exit(f"{board}: expected exactly one app image in flasher_args.json")

    version = (build.parent / "version.txt").read_text().strip()
    (dest / "board.json").write_text(json.dumps({
        "board": board,
        "chipFamily": CHIP_FAMILY[chip],
        "version": version,
        "sdkRef": ref,
        "parts": parts,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
