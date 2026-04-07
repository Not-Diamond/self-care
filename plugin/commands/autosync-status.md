---
description: Show the current autosync state for this project
argument: ""
allowed-tools:
  - Bash
---

# Self-Care Autosync Status

Display the current autosync status from `.self-care/autosync.json` plus the global project runtime memory under `.self-care/autosync/`.

## Step 1: Define Paths

```text
CONFIG_PATH=".self-care/config.json"
STATE_PATH=".self-care/autosync.json"
```

## Step 2: Load Status

Run:

```bash
node plugin/lib/autosync.mjs status --config "$CONFIG_PATH" --state "$STATE_PATH"
```

Parse the JSON output and display:

```text
Self-Care Autosync
  Enabled: <true|false>
  Source: <source or unconfigured>
  Project: <project or n/a>
  Host: <host if langfuse, otherwise n/a>
  Interval: every <poll_interval_minutes> minute(s)
  Sampling rate: <sampling_rate>
  Last sync: <last_sync_at or never>
  Last sync count: <last_sync_count>
  Pending traces: <pending_count>
  Next sync: <next_sync_at or n/a>
  Consecutive errors: <consecutive_errors>
  Last error: <last_error or none>
  Task ID: <loop_task_id or none>
  Config file: .self-care/autosync.json
  Runtime: .self-care/autosync/
```

If `scope_changed` is true, add one extra line:

```text
  Note: the connected source or project changed since autosync was last enabled.
```
