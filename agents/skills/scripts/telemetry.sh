#!/usr/bin/env bash
# telemetry.sh — Fire-and-forget telemetry events to PostHog.
#
# Usage: bash agents/skills/scripts/telemetry.sh <event_name> [json_properties]
#
# Reads consent from .self-care/config.json in the working directory.
# All events require analytics.enabled = true. No exceptions.
# All failures are silent — telemetry never breaks the pipeline.
#
# Environment:
#   SC_TELEMETRY_DEBUG=1  — print payload to stderr instead of sending
#   SC_POSTHOG_KEY        — override the default PostHog API key

set -euo pipefail

# --- Constants ---
POSTHOG_HOST="https://us.i.posthog.com"
POSTHOG_KEY="${SC_POSTHOG_KEY:-phc_ttY3WHbWGMpCav4BtRCDEaGGGDALppXJajhPL4kCU64B}"
CONFIG_PATH=".self-care/config.json"

# --- Args ---
event_name="${1:-}"
default_props='{}'
event_properties="${2:-$default_props}"

if [ -z "$event_name" ]; then
  exit 0
fi

# --- Guard: required tools ---
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# --- Guard: config must exist ---
if [ ! -f "$CONFIG_PATH" ]; then
  exit 0
fi

config=$(cat "$CONFIG_PATH" 2>/dev/null) || exit 0

# --- Guard: consent check ---
# Reads analytics.enabled from config (set by init/run consent prompt).
# Default: disabled. Missing key or any non-true value = no telemetry.
opted_in=$(echo "$config" | jq -r '.analytics.enabled // false' 2>/dev/null) || exit 0
if [ "$opted_in" != "true" ]; then
  exit 0
fi

# --- Anonymous ID ---
anonymous_id=$(echo "$config" | jq -r '.anonymous_id // empty' 2>/dev/null) || exit 0

if [ -z "$anonymous_id" ]; then
  # Generate UUID: try uuidgen (macOS/Linux), fall back to Python
  if command -v uuidgen >/dev/null 2>&1; then
    anonymous_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  elif command -v python3 >/dev/null 2>&1; then
    anonymous_id=$(python3 -c "import uuid; print(uuid.uuid4())")
  else
    # Last resort: pseudo-random hex
    anonymous_id=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n' | sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)\(.\{12\}\)/\1-\2-\3-\4-\5/')
  fi

  # Write anonymous_id back to config atomically
  tmp_config=$(mktemp "${CONFIG_PATH}.XXXXXX" 2>/dev/null) || exit 0
  if echo "$config" | jq --arg id "$anonymous_id" '. + {anonymous_id: $id}' > "$tmp_config" 2>/dev/null; then
    mv "$tmp_config" "$CONFIG_PATH" 2>/dev/null || rm -f "$tmp_config"
  else
    rm -f "$tmp_config"
  fi
fi

# --- Build payload ---
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

payload=$(jq -n \
  --arg api_key "$POSTHOG_KEY" \
  --arg event "$event_name" \
  --arg distinct_id "$anonymous_id" \
  --arg timestamp "$timestamp" \
  --argjson properties "$event_properties" \
  '{
    api_key: $api_key,
    event: $event,
    distinct_id: $distinct_id,
    timestamp: $timestamp,
    properties: ($properties + {distinct_id: $distinct_id, "$lib": "self-care-plugin"})
  }' 2>/dev/null) || exit 0

# --- Send or debug ---
if [ "${SC_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo "$payload" >&2
  exit 0
fi

# Fire-and-forget: background curl, discard output
curl -sS -X POST "${POSTHOG_HOST}/capture/" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  >/dev/null 2>&1 &

exit 0
