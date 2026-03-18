#!/usr/bin/env bash
set -euo pipefail

git diff 2>&1 | sift "what changed?"
