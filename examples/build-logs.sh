#!/usr/bin/env bash
set -euo pipefail

npm run build 2>&1 | sift preset build-failure
