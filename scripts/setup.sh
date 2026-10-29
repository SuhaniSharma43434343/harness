#!/usr/bin/env sh
# Forge setup for macOS and Linux: checks prerequisites, installs pinned dependencies.
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$DIR"
command -v node >/dev/null 2>&1 || { echo "Node.js 22+ is required: https://nodejs.org"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Git 2.40+ is required: https://git-scm.com"; exit 1; }
if [ -f package-lock.json ]; then npm ci; else npm install; fi
# The starter site's own dependencies (Astro), used by forge site --build and the build tests.
(cd starters/astro-base && npm ci --no-audit --no-fund)
# Optional: the browser test tools for the quality gates (Playwright, axe-core, Lighthouse).
case " $* " in
  *" --with-test-tools "*)
    (cd tools && npm ci --no-audit --no-fund && npx playwright install chromium) ;;
esac
[ -f forge.config.json ] || cp forge.config.example.json forge.config.json
./forge doctor
