#!/usr/bin/env bash
set -euo pipefail

pytest 2>&1 | sift preset test-status
