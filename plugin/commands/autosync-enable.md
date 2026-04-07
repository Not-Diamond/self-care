---
description: Enable scheduled autosync for the configured trace source
argument: ""
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - CronCreate
  - CronDelete
  - CronList
---

# Self-Care Autosync Enable

Enable background autosync for this project using Claude Code scheduled tasks.

Use the existing `.self-care/config.json` as the source of truth for the connected provider. Persist configurable autosync settings in `.self-care/autosync.json`.

Store runtime state, pending traces, and staged trace files under `.self-care/autosync/` via the autosync CLI. Do not write runtime state into `.self-care/autosync.json`.

## Step 1: Define Paths

```text
CONFIG_PATH=".self-care/config.json"
STATE_PATH=".self-care/autosync.json"
AUTOSYNC_CLI="node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs""
PROJECT_NAME=<run `basename "$(pwd)"` and store the result>
TICK_PROMPT="/self-care:autosync-tick $PROJECT_NAME"
```

## Step 2: Ensure Self-Care Is Initialized

Read `$CONFIG_PATH`.

If the file does not exist or is invalid JSON, stop and output:

```text
✗ Self-Care is not initialized for this project.
  Run /self-care:init first, then retry /self-care:autosync-enable.
```

## Step 3: Load Current Autosync Settings

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs" status --config "$CONFIG_PATH" --state "$STATE_PATH"
```

Parse the JSON output and store:

- `poll_interval_minutes`
- `sampling_rate`
- `loop_task_id`
- `current_scope`

Defaults come from the status output if the autosync file does not exist yet.

## Step 4: Confirm Or Update Settings

If `.self-care/autosync.json` already exists, output the current settings and ask via AskUserQuestion:

```text
Autosync is already configured:
  Interval: every <poll_interval_minutes> minute(s)
  Sampling rate: <sampling_rate>

Would you like to keep these settings or change them?
1. Keep current settings
2. Change settings
```

If the user chooses to keep the current settings, reuse them as-is.
Set `POLL_INTERVAL_MINUTES` and `SAMPLING_RATE` from the values returned in Step 3.

If there is no autosync config yet, or the user chooses to change settings, ask these questions via AskUserQuestion:

1. Poll interval:
```text
How often should autosync poll for traces?

1. Every 5 minutes
2. Every 10 minutes
3. Every 30 minutes
4. Every 60 minutes
5. Custom
```

If the user chooses custom, ask them to enter the interval in minutes. It must be either less than 60, or a whole number of hours such as 60 or 120.

2. Sampling rate:
```text
What percentage of newly discovered traces should autosync analyze?

1. 1%
2. 5%
3. 10%
4. Custom
```

If the user chooses custom, accept either a decimal between 0 and 1, or a percentage such as `5%`.

After collecting values, store them as `POLL_INTERVAL_MINUTES` and `SAMPLING_RATE`.

## Step 5: Replace Any Existing Scheduled Task

If `loop_task_id` is present, delete it with `CronDelete` before creating the new one.

If `loop_task_id` is empty or null, use `CronList` and look for recurring tasks whose prompt is exactly:

```text
$TICK_PROMPT
```

Delete those stale tasks before creating the new one.

## Step 6: Translate The Interval To Cron

Use `POLL_INTERVAL_MINUTES`.

- If the interval is between `1` and `59`, use cron expression `*/<minutes> * * * *`
- If the interval is a whole number of hours (`interval % 60 == 0`), use cron expression `0 */<hours> * * *`
- Otherwise stop and output:

```text
✗ Unsupported autosync interval in .self-care/autosync.json.
  Use a minute-based interval under 60, or a whole number of hours, then rerun /self-care:autosync-enable.
```

## Step 7: Create The Scheduled Task

Use `CronCreate` to create a recurring task with:

- the cron expression from Step 6
- the prompt:

```text
$TICK_PROMPT
```

Store the returned task ID as `loop_task_id`.

## Step 8: Persist Enabled Autosync State

Source `.env` first so credential validation sees the provider keys, then run:

```bash
if [ -f .env ]; then set -a && source .env && set +a; fi
node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs" enable --config "$CONFIG_PATH" --state "$STATE_PATH" --poll-interval-minutes "$POLL_INTERVAL_MINUTES" --sampling-rate "$SAMPLING_RATE" --loop-task-id "$LOOP_TASK_ID"
```

Parse the JSON output. If the CLI returns an error, delete the task you just created with `CronDelete`, then report the error and stop.

## Step 9: Output Summary

Output:

```text
✓ Autosync enabled
  Source: <source> (<project details if available>)
  Interval: every <poll_interval_minutes> minute(s)
  Sampling rate: <sampling_rate>
  Config: .self-care/autosync.json
  Runtime: .self-care/autosync/
  Task ID: <loop_task_id>

Edit .self-care/autosync.json to change settings, then rerun /self-care:autosync-enable to refresh the scheduled task.
Claude Code recurring tasks expire after 7 days, so rerun this command to renew autosync when needed.
```
