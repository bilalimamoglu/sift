#!/usr/bin/env bash
set -euo pipefail

npm audit 2>&1 | sift preset audit-critical --format json
