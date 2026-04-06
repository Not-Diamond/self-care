#!/usr/bin/env bash
# Checks whether required env vars are set (sourcing .env if present).
# Prints "set" for each var that is present, "unset" otherwise.
# Usage: ./check-env.sh VAR1 [VAR2 ...]

set -euo pipefail

if [ -f .env ]; then
  set -a && source .env && set +a
fi

for var in "$@"; do
  if [ -n "${!var:-}" ]; then
    echo "$var=set"
  else
    echo "$var=unset"
  fi
done
