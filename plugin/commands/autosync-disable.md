---
description: Disable scheduled autosync for the current project
argument: ""
allowed-tools:
  - Bash
  - CronDelete
  - CronList
---

# Self-Care Autosync Disable

Disable background autosync for this project. This should cancel the scheduled task and mark `.self-care/autosync.json` as disabled.

Do not ask the user any questions.

## Step 1: Define Paths

```text
CONFIG_PATH=".self-care/config.json"
STATE_PATH=".self-care/autosync.json"
AUTOSYNC_CLI="node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs""
PROJECT_NAME=<run `basename "$(pwd)"` and store the result>
```

## Step 2: Load Autosync Status

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs" status --config "$CONFIG_PATH" --state "$STATE_PATH"
```

Parse the JSON output and store `loop_task_id` if present.

## Step 3: Cancel Scheduled Task(s)

If `loop_task_id` is present, delete that task with `CronDelete`.

If `loop_task_id` is missing, use `CronList` to find recurring tasks whose prompt is exactly:

```text
/self-care:autosync-tick <PROJECT_NAME>
```

Delete those tasks as a best-effort cleanup.

## Step 4: Persist Disabled State

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/autosync.mjs" disable --state "$STATE_PATH"
```

Parse the JSON output.

## Step 5: Output Summary

Output:

```text
✓ Autosync disabled
  Config: .self-care/autosync.json
  Runtime: .self-care/autosync/

Run /self-care:autosync-enable to turn it back on.
```
