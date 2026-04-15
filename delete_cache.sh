#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
find "$ROOT_DIR" \( \( -type d -o -type l \) \( -name node_modules -o -name .turbo -o -name dist -o -name .next \) \) -prune -print0 |
xargs -0r rm -rf
