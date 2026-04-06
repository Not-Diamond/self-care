---
description: Main entry point — run the full pipeline (validate, analyze, report, review & apply)
argument: "[trace-file] [details]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Task
  - Write
  - Bash
  - AskUserQuestion
---

# Triage Pipeline

Run the full Self-Care triage pipeline on the provided trace file. Supports both OTEL (JSON) and Claude Code (JSONL) formats. This orchestrates 5 stages sequentially: validation, analysis, reporting, review & apply, and summary.

## Stage 0a: Analytics Consent Check

Before running the pipeline, check if the user has consented to analytics collection.

**Read the config file** at `.self-care/config.json` using the **Read** tool.

- **If the file exists** and contains valid JSON with `analytics.enabled` set to `true` or `false`: consent is already recorded. Skip to Stage 0b.
- **If the file does not exist**, or exists but has no `analytics` key: prompt for consent.

**Prompt for consent** using **AskUserQuestion**:
- **question**: "Self-Care can collect anonymous usage analytics to help improve the tool. This includes: command usage frequency, case types detected (not trace content), and error rates. No trace data, file contents, or personally identifiable information is collected. Would you like to enable analytics?"
- **header**: "Analytics"
- **options**:
  - `{ "label": "Enable analytics", "description": "Help improve Self-Care with anonymous usage data" }`
  - `{ "label": "Disable analytics", "description": "Opt out of usage analytics" }`

**Save the config**:
1. Get timestamp: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
2. Ensure the config directory exists: `mkdir -p .self-care/`
3. Read existing `.self-care/config.json` to preserve other settings (e.g. `source`, `langsmith`). Merge the `analytics` key into the existing object and write it back:
   ```json
   {
     "...existing keys preserved...",
     "analytics": {
       "enabled": <true if "Enable analytics", false otherwise>,
       "consentTimestamp": "<timestamp>"
     }
   }
   ```

---

## Stage 0b: Parse Arguments

Parse `$ARGUMENTS` to extract:

- **trace_path**: The trace file path — the first quoted string (quotes stripped) or the first whitespace-delimited token. May be empty.
- **details**: All remaining text after the trace file path (trimmed). May be empty.

**Example inputs:**
- `/path/to/trace.json` → trace_path="/path/to/trace.json", details=""
- `"/path/to/trace.json"` → trace_path="/path/to/trace.json", details=""
- `/path/to/trace.json The agent is a retail customer service bot` → trace_path="/path/to/trace.json", details="The agent is a retail customer service bot"
- `"/path/to/trace.json" The agent should always escalate billing issues` → trace_path="/path/to/trace.json", details="The agent should always escalate billing issues"
- *(empty)* → trace_path="", details=""

### If trace_path is a file on disk:

Store both values and continue to Stage 1.

### If trace_path is empty (no arguments or only details):

**Load config:**
```
CONFIG_PATH=".self-care/config.json"
```

Read `$CONFIG_PATH`. If the file does not exist or is invalid JSON:
```
✗ No trace source configured. Run /self-care:init first, or provide a trace file:
  /self-care:run <trace-file>
```
**Stop.**

**Fetch recent traces:**
```bash
node lib/list.mjs --source <source> --limit 10 --config "$CONFIG_PATH"
```

Parse the JSON output. Present the trace list via AskUserQuestion using box-drawing characters (no triple-backtick code fences):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Recent traces from <Source> (<project name>):                        │
│                                                                      │
│  1 │ <name>          │ <date> <time> │ <duration>                    │
│  2 │ <name>          │ <date> <time> │ <duration>                    │
│  3 │ <name>          │ <date> <time> │ <duration>                    │
│  ...                                                                 │
│                                                                      │
│ Pick a number, or type to filter:                                    │
│ • "more" for next page                                               │
│ • "search <name>" to filter by name                                  │
└──────────────────────────────────────────────────────────────────────┘
```

Format duration as compact (e.g. "1.2s", "45s", "2m30s"). Omit duration if null.

**Handle user input in a loop:**
- If the user enters a **number**: select that trace. Break the loop.
- If `"more"`: run `list.ts` with `--cursor <next_cursor>` (LangSmith) or `--page <next_page>` (LangFuse). Present updated list.
- If `"search <term>"`: run `list.ts` with `--name <term>`. Present filtered list.
- Repeat until the user selects a trace.

**Fetch and convert the selected trace:**

Run the fetch CLI. For LangSmith, pass `--project` from config's `langsmith.project`. For LangFuse, pass `--project-id` from config's `langfuse.project_id` (if available) and `--host` from config's `langfuse.host`.

```bash
node lib/fetch.mjs --source <source> --id <selected_trace_id> --project <project_name_or_id> > /tmp/self-care-fetch-<selected_trace_id>.json
```

Parse the JSON envelope:
1. Read `/tmp/self-care-fetch-<selected_trace_id>.json`
2. Extract the `.otel` value — write it to `/tmp/self-care-trace-<selected_trace_id>.json` using the **Write** tool
3. Extract `.source_url` — store as `source_url` for use in Stage 3 and Pipeline Summary (may be `null`)
4. Set `trace_path` = `/tmp/self-care-trace-<selected_trace_id>.json`

Output:
```
✓ Fetched trace → <trace_path>
```

Continue to Stage 1 with `trace_path` and `source_url`.

---

## Stage 1: Validation

**Before starting, output:**
```
Stage 1/5: Validating trace...
```

Run the same deterministic validator used by `/self-care:validate`:

```bash
npx tsx agents/tools/validate-trace.ts "<trace_path>"
```

Parse the JSON output. See `commands/validate.md` for the full schema — the result contains `valid`, `format`, `errors`, `warnings`, and `metadata`.

Extract from the result:
- **format**: `metadata.format` — "otel" or "claude-code"
- **validation_status**: `valid` — true or false
- **Format-specific fields** from `metadata`: trace ID / session ID, span count / message count, service name, time range, event types — whichever are present for the format.

**If validation_status is false, stop the pipeline here.** Report the validation errors and do not proceed to Stage 2.

**After validation succeeds, output:**
```
✓ Valid <format> trace (<span_count> spans or <message_count> messages)
```

---

## Stage 2: Analysis

**Before starting, output:**
```
Stage 2/5: Analyzing for cases...
```

Use the **trace-analyzer** agent to analyze the trace file at: `<trace_path>`

Provide the agent with the validation context from Stage 1, including the **format** field so it applies the correct analysis strategy:
- OTEL: span-based analysis
- Claude Code: event-based analysis

If **details** is non-empty, pass it to the agent as additional context:
> "The user has provided the following context about this trace: <details>"

After the agent returns:

1. **Output per-skill progress**: The analyzer's response includes per-skill result lines (formatted as `  ✓ <skill-name>: <N> events`). Extract these lines from the response and output them so the user sees the breakdown by skill. This is important because the analyzer runs as a Task agent whose output is not directly visible to the user.

2. **Extract analysis data** from the **JSON code block at the end of the response** — these fields are required for Stage 3:
   - **cases**: The `events` array from the JSON block, each containing:
     - `type` (grounding, missed-action, instruction-following, context-utilization, goal-drift, persona-adherence, reasoning-action-mismatch, step-repetition, tool-failure, premature-termination, contradictory-instructions, missing-context, ambiguous-instructions, guardrail-violation)
     - `severity` (low, medium, high)
     - `span` (span name for OTEL, event type for Claude Code)
     - `description`
     - `evidence` (specific trace data supporting the event)
     - `classification` (auto-fixable, manual-review)
     - `proposedFix` (recommended fix or "Manual review required: ..." for manual-review events)
   - **analysis_summary**: The `summary` object from the JSON block (total, autoFixable, manualReview, high, medium, low)

**If no cases are found (total = 0), skip to Stage 3** to generate the report (with no cases to report).

**After extracting data, output the summary:**
```
✓ Found <total> cases (<high> high, <medium> medium, <low> low)
```
Or if no events found:
```
✓ No cases detected
```

3. **Output the JSON analysis block** exactly as returned by the trace-analyzer. This structured output enables downstream tooling and re-analysis verification.

---

## Stage 3: Reporting

**Before starting, output:**
```
Stage 3/5: Generating report...
```

Use the **report-generator** agent to create the triage report.

Provide the agent with data from previous stages:
- **Trace metadata**: format + format-specific fields (from Stage 1)
- **Cases**: Complete event list with details (from Stage 2)
- **Remediation status**: "pending" (remediations have not been applied yet)
- **User-provided context** (if **details** is non-empty): pass it with instruction to include an "Agent Context" section at the top of the report summarizing the intended behavior
- **Source URL** (if `source_url` is set and not null): pass it as `"sourceUrl": "<source_url>"` so it appears in the report

The agent will create a report at `./.self-care/reports/` and output a terminal summary. The report will show proposed remediations for auto-fixable events, which the user will review in Stage 4.

**If there are no auto-fixable events, skip to the Pipeline Summary** after generating the report.

---

## Stage 4: Review & Apply

**Before starting, output:**
```
Stage 4/5: Computing proposed remediations...
```
(Skip this stage if no auto-fixable events exist)

### 4a. Compute Diffs

Use the **context-refiner** agent in **preview mode** to compute exact diffs for auto-fixable events.

Provide the agent with:
- `mode: "preview"`
- The auto-fixable events from Stage 2
- The trace file path: `<trace_path>`
- **User-provided context** (if **details** is non-empty): pass it to help the agent propose fixes that align with the agent's intended behavior

The agent will discover relevant files, read them, and return a JSON block with `proposed_diffs` containing the exact `file_path`, `old_string`, and `new_string` for each fix.

**After diffs are computed, output:**
```
✓ Computed <N> proposed diffs
```

### 4b. Present Diffs for Review

**IMPORTANT: You MUST ask the user about EVERY diff individually. Do not skip any diffs or assume the user's answer for one diff applies to others.**

Iterate through ALL proposed diffs, one at a time, sorted by severity (high → medium → low). For EACH diff, use **AskUserQuestion** to present the diff and collect the user's decision.

**CRITICAL formatting rule: Do NOT use triple-backtick code fences (```) anywhere in the AskUserQuestion question text.** Claude Code's AskUserQuestion renders backticks as literal characters, making diffs unreadable. Instead use Unicode box-drawing characters for visual structure.

For EACH diff:

1. Use **AskUserQuestion** with:
   - **question**: (plain text, NO code fences — use `│` for code lines)
     ```
     Fix <N>/<total>: [<event_type>] (<severity>)

     ★ Rationale
     <context.rationale>
     ─────────────────────────────────────────────────────────

     <event_description>

     File: <file_path>
     Section: <context.file_section>

     ┌─ Current ─────────────────────────────────────────────
     │ <old_line_1>
     │ <old_line_2>
     │ <old_line_3>
     └───────────────────────────────────────────────────────

     ┌─ Proposed ────────────────────────────────────────────
     │ <new_line_1>
     │ <new_line_2>
     │ <new_line_3>
     └───────────────────────────────────────────────────────
     ```

   - **header**: "<event_type>"
   - **options**:
     - `{ "label": "Apply", "description": "Apply this change" }`
     - `{ "label": "Skip", "description": "Do not apply" }`

2. Wait for the user's response.

3. Record the result:
   - **"Apply"**: Add to `approved_diffs`. Output: `✓ Queued for apply`
   - **"Skip"**: Add to `skipped_diffs`. Output: `○ Skipped`
   - **Free-text response**: Record as feedback alongside the skip.

4. **Continue to the next diff** — repeat steps 1-3 until ALL diffs have been presented.

**Diff display rules (within AskUserQuestion):**
- Every line of code MUST be prefixed with `│ ` (box-drawing vertical bar + space)
- For **changed lines**: use `│ - ` prefix in Current block, `│ + ` prefix in Proposed block
- For **unchanged context lines**: use plain `│ ` prefix
- For **insertions** (empty `old_string`): omit Current block, show only Proposed with header `┌─ New content ──...`
- For **deletions** (empty `new_string`): omit Proposed block, show only Current with header `┌─ Removed ──...`
- Show complete content if 15 lines or fewer
- For longer content: first 8 lines + `│ ... (<N> more lines)` + last 3 lines

After ALL diffs have been reviewed, categorize results:
- **approved_diffs**: Diffs where user selected "Apply"
- **skipped_diffs**: Diffs where user selected "Skip" (with feedback if provided)
- **skipped_events**: Events where no diff could be computed
- **escalations**: Manual-review events (not presented to user)

**After ALL diffs reviewed, output:**
```
✓ Review complete (<approved_count> to apply, <skipped_count> skipped, <escalated_count> escalated)
```

---

## Stage 5: Apply & Summary

**Before starting, output:**
```
Stage 5/5: Applying <approved_count> approved fixes...
```
(Skip to summary if no diffs were approved)

### 5a. Apply Approved Diffs

For each diff in **approved_diffs**, apply it using the **Edit** tool:
- `file_path`: from the diff
- `old_string`: from the diff
- `new_string`: from the diff

Track success/failure for each edit.

### 5b. Output Summary

**Before starting, output:**
```
Stage 5/5: Summary
```

For each event processed, output a line using these icons:
- `✓` for successfully applied fixes
- `✗` for failed fixes (Edit tool error)
- `○` for skipped fixes (user denied, with reason if provided)
- `⊘` for skipped events (no diff could be computed)
- `⚑` for escalated events (manual-review)

```
  ✓ Event 1: <drift-type> (<severity>) — <file_path>: <brief change description>
  ✓ Event 2: <drift-type> (<severity>) — <file_path>: <brief change description>
  ○ Event 3: <drift-type> (<severity>) — Skipped by user
  ⚑ Event 4: <drift-type> (<severity>) — Escalated: <reason>
  ✓ Event 5: <drift-type> (<severity>) — <file_path>: <brief change description>
```

---

## Pipeline Summary

After Stage 5 completes (or Stage 3 if no auto-fixable events), display the final pipeline summary to the user using this exact format:

**For OTEL traces:**
```
Self-Care Complete

Trace: <service_name> (<trace_id>)
Source: <source_url>
Cases found: <total>
  Applied: <applied_count>
  Skipped by user: <skipped_count>
  Escalated: <escalated_count>

Report saved to: <report_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What's Next
• Review the report: <report_path>
• Disagree with findings? Tell me what was incorrect and I'll re-analyze
• Analyze another trace: /self-care:run <trace-file>
```

Omit the "Source:" line if source_url is not set or is null.

**For Claude Code traces:**
```
Self-Care Complete

Session: <session_id>
Source: <source_url>
Messages: <message_count>
Cases found: <total>
  Applied: <applied_count>
  Skipped by user: <skipped_count>
  Escalated: <escalated_count>

Report saved to: <report_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What's Next
• Review the report: <report_path>
• Disagree with findings? Tell me what was incorrect and I'll re-analyze
• Analyze another trace: /self-care:run <trace-file>
```

Omit the "Source:" line if source_url is not set or is null.

---

## Handling User Feedback

After the pipeline completes, the user may provide feedback about the analysis results. Feedback can include: false positives, missed issues, severity corrections, case type corrections, classification changes (auto-fixable vs manual-review), scope adjustments, or requests for clarification.

When the user provides ANY feedback about the analysis:

1. **Acknowledge** the feedback
2. **Re-run Stage 2 (Analysis)** — invoke the **trace-analyzer** agent with:
   - The original trace file path
   - The user's feedback as additional context to guide re-analysis
   - The original **details** (if non-empty), so agent context is preserved across re-analysis
3. **Output updated JSON** with the revised findings
4. **Re-run Stage 3 (Reporting)** to regenerate the report with the updated findings
5. **Re-run Stage 4 (Approval & Remediation)** only if the updated findings include auto-fixable events

After re-analysis, output the updated JSON analysis block with the standard format:

```json
{
  "format": "...",
  "eventCount": N,
  "events": [...],
  "summary": {...}
}
```

**Important:** Always re-run the actual analysis via the trace-analyzer agent — do not manually edit previous results. The user's feedback provides guidance, but the analyzer makes the final determination based on trace evidence. If the analyzer disagrees with the feedback after re-examination, explain why with specific evidence from the trace.
