---
description: Run one non-interactive autosync cycle
argument: ""
allowed-tools:
  - Read
  - Bash
  - Task
---

# Self-Care Autosync Tick

Run a single non-interactive autosync cycle.

This command is meant to be invoked by Claude Code scheduled tasks. Never ask the user any questions. Keep output concise and operational.

Do not use `/self-care:run` from here. It is interactive and includes remediation review. Reuse the same validator, `trace-analyzer`, and `report-generator` building blocks directly.

If `$ARGUMENTS` contains a project identifier from the scheduled task prompt, ignore it.

## Step 1: Define Paths

```text
CONFIG_PATH=".self-care/config.json"
STATE_PATH=".self-care/autosync.json"
AUTOSYNC_CLI="node lib/autosync.mjs"
```

## Step 2: Poll Autosync State And Stage Work

Source `.env` first, then run:

```bash
if [ -f .env ]; then set -a && source .env && set +a; fi
node lib/autosync.mjs tick --config "$CONFIG_PATH" --state "$STATE_PATH"
```

Parse the JSON output.

## Step 3: Handle Non-Work States

If the status is one of the following, print one short line and stop:

- `config_missing`
- `disabled`
- `locked`
- `not_due`
- `no_new_traces`

If the status is `error`, output a short failure line that includes the message and stop.

## Step 4: Process Each Staged Trace

Process `result.traces` in order. For each trace:

### 4a. Validate

Run:

```bash
npx tsx agents/tools/validate-trace.ts "<file_path>"
```

Parse the JSON output.

If validation fails:

- output a short failure line for that trace
- do not mark it complete
- continue to the next staged trace

### 4b. Analyze

Use the **trace-analyzer** agent to analyze the trace file at: `<file_path>`

Provide the agent with the validation context from 4a, including the **format** field so it applies the correct analysis strategy (OTEL: span-based analysis, Claude Code: event-based analysis). Also pass the pre-computed hash `trace_hash` so the analyzer skips re-hashing.

The trace-analyzer will run all 14 detection skills (2 deterministic tools + 12 interpretive skill agents) and return a reconciled JSON result. This is the same analysis pipeline used by `/self-care:run`.

After the agent returns:

1. **Output per-skill progress**: Extract the per-skill result lines (formatted as `✓ <skill-name>: <N> events`) from the response and output them.

2. **Extract analysis data** from the **JSON code block at the end of the response**:
   - **events**: The `events` array — each containing `type`, `severity`, `classification`, `span`, `description`, `evidence`, `proposedFix`
   - **summary**: The `summary` object (`total`, `autoFixable`, `manualReview`, `high`, `medium`, `low`)

### 4c. Generate Report

Invoke the `report-generator` agent with:

- the validated trace metadata
- the `events` array from the analyzer JSON
- `remediationStatus: "pending"`
- `sourceUrl` from the staged trace entry if present
- no user-provided context

Parse the report-generator output and extract the report path from the line:

```text
Report saved to: <path>
```

### 4d. Mark Complete

Only after both analysis and report generation succeed, run:

```bash
node lib/autosync.mjs complete --state "$STATE_PATH" --trace-hash "<trace_hash>"
```

If analysis or report generation fails, leave the trace pending by skipping this step.

### 4e. Output Per-Trace Result

If `summary.total == 0`, output:

```text
Autosync analyzed <display_name or trace_hash>: no cases detected. Report: <report_path>
```

Otherwise output:

```text
Autosync analyzed <display_name or trace_hash>: <total> cases (<high> high, <medium> medium, <low> low). Report: <report_path>
```

## Step 5: Final Summary

After processing all staged traces, output one concise summary line with:

- processed count
- failed count
- remaining pending count

If `result.reused_pending` is true, mention that this tick resumed previously staged traces.

## Step 6: Write Notification Signal

If any processed trace had `summary.total > 0`, write a signal file so the Notification hook can alert the user.

Write to `.self-care/autosync/last-notify.json` using the Write tool:

```json
{
  "timestamp": "<ISO timestamp>",
  "total_cases": <total>,
  "traces_with_cases": <count>,
  "report_paths": ["<path1>", "<path2>"]
}
```

If no traces had cases, delete the signal file if it exists:

```bash
rm -f .self-care/autosync/last-notify.json
```

## Important Rules

- Never ask the user for approval during autosync
- Never run Stage 4 remediation review/apply from `/self-care:run`
- Leave failed traces pending for the next tick by not marking them complete
- Runtime state and staged trace files live under `.self-care/autosync/`
