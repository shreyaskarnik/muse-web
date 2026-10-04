#!/usr/bin/env python3
"""Print the board matrix from the SDK's own CI as JSON for a GitHub Actions matrix.

Reading upstream's .github/workflows/esp32.yml means a board added there is
built here too, with the same target and sdkconfig overlays.

Usage: upstream_matrix.py <path to muse-gadget-sdk checkout> [board ...]
"""

import json
import sys
from pathlib import Path

import yaml


def main() -> None:
    sdk = Path(sys.argv[1])
    wanted = set(sys.argv[2:])
    workflow = yaml.safe_load((sdk / ".github/workflows/esp32.yml").read_text())
    include = workflow["jobs"]["build"]["strategy"]["matrix"]["include"]
    boards = [
        {"board": b["board"], "target": b["target"], "overlays": b.get("overlays") or ""}
        for b in include
        if not wanted or b["board"] in wanted
    ]
    if not boards:
        sys.exit(f"no boards matched {sorted(wanted)}")
    print(json.dumps({"include": boards}))


if __name__ == "__main__":
    main()
