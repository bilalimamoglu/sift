#!/usr/bin/env bash
set -euo pipefail

terraform plan 2>&1 | sift preset infra-risk
