#!/usr/bin/env python3
"""Collect every firmware/<board>/board.json into firmware/boards.json for the page.

Usage: index_boards.py <firmware dir>
"""

import json
import sys
from pathlib import Path


def main() -> None:
    firmware = Path(sys.argv[1])
    boards = [json.loads(p.read_text()) for p in sorted(firmware.glob("*/board.json"))]
    if not boards:
        sys.exit("no boards found")
    (firmware / "boards.json").write_text(json.dumps({"boards": boards}, indent=2) + "\n")
    print(f"indexed {len(boards)} boards")


if __name__ == "__main__":
    main()
