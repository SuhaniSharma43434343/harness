#!/usr/bin/env sh
# Clean-extraction test (acceptance A1 and A14) for macOS and Linux.
# Usage: scripts/clean-extract-test.sh path/to/forge-vX.Y.Z.zip
# Extracts the ZIP into a new empty folder, runs setup (npm ci and doctor) and the test suite,
# and keeps a log next to the ZIP. Run it on a machine or account that never held the repo.
set -e
ZIP="$1"
[ -f "$ZIP" ] || { echo "Usage: $0 path/to/forge-vX.Y.Z.zip"; exit 2; }
ZIP="$(CDPATH= cd -- "$(dirname -- "$ZIP")" && pwd)/$(basename -- "$ZIP")"
LOG="${ZIP%.zip}-clean-extract.log"
WORK="$(mktemp -d)"
{
  echo "Clean extraction of $(basename "$ZIP") on $(uname -sm), $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  unzip -q "$ZIP" -d "$WORK"
  cd "$WORK"/forge-v*
  ./scripts/setup.sh
  npm test
  echo "PASS"
} 2>&1 | tee "$LOG"
echo "Log: $LOG"
