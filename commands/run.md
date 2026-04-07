---
description: Main entry point — run the full pipeline (validate, analyze, report, review, summarize)
argument: <trace-file> [details]
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

Run the full Self-Care triage pipeline on the provided trace file. Supports both OTEL (JSON) and Claude Code (JSONL) formats. This orchestrates 6 stages sequentially: validation, analysis, reporting, finding review, output lists, and feedback (only if you've opted in).

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
node "${CLAUDE_PLUGIN_ROOT}/lib/list.mjs" --source <source> --limit 10 --config "$CONFIG_PATH"
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
node "${CLAUDE_PLUGIN_ROOT}/lib/fetch.mjs" --source <source> --id <selected_trace_id> --project <project_name_or_id> > /tmp/self-care-fetch-<selected_trace_id>.json
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
Stage 1/6: Validating trace...
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
Stage 2/6: Analyzing for cases...
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
Stage 3/6: Generating report...
```

Use the **report-generator** agent to create the preliminary triage report.

Provide the agent with data from previous stages:
- **Trace metadata**: format + format-specific fields (from Stage 1)
- **Cases**: Complete event list with details (from Stage 2)
- **Review status**: "pending" (review has not happened yet)
- **User-provided context** (if **details** is non-empty): pass it with instruction to include an "Agent Context" section at the top of the report summarizing the intended behavior
- **Source URL** (if `source_url` is set and not null): pass it as `"sourceUrl": "<source_url>"` so it appears in the report

The agent will create a report at `./.self-care/reports/` and output a terminal summary.

**If there are no cases (total = 0), skip to the Pipeline Summary.**

---

## Stage 4: Finding Review

**Before starting, output:**
```
Stage 4/6: Reviewing findings...
```

### 4a. Offer to Skip Review

Before iterating through findings, use **AskUserQuestion** to give the developer a choice:

- **question**:
  ```
  Found <total> findings (<high> high, <medium> medium, <low> low).

  Would you like to review each finding individually?
  Reviewing helps build intuition about agent failure modes and improves future detection accuracy.
  ```
- **header**: "Finding Review"
- **options**:
  - `{ "label": "Review findings", "description": "Walk through each finding one by one" }`
  - `{ "label": "Skip review", "description": "Go straight to the categorized results" }`

If the developer selects **Skip review** → jump directly to Stage 5. All cases retain their original `classification` from analysis. No false positives are recorded. Set `review_skipped = true`.

### 4b. Iterate Through Findings

**IMPORTANT: You MUST ask the user about EVERY finding individually. Do not skip any findings or assume the user's answer for one finding applies to others.**

Iterate through ALL cases, sorted by severity (high → medium → low). For EACH finding, use **AskUserQuestion** to present it and collect the user's decision.

**CRITICAL formatting rule: Do NOT use triple-backtick code fences (```) anywhere in the AskUserQuestion question text.** Claude Code's AskUserQuestion renders backticks as literal characters, making content unreadable. Instead use Unicode box-drawing characters for visual structure.

For EACH finding:

1. Use **AskUserQuestion** with:
   - **question**: (plain text, NO code fences)
     ```
     Finding <N>/<total>: [<type>] (<severity>)
     ─────────────────────────────────────────────────────────

     <description>

     Evidence: <evidence>
     ─────────────────────────────────────────────────────────
     Is this finding relevant?
     ```

   - **header**: "<type>"
   - **options**:
     - `{ "label": "Relevant", "description": "True positive — confirmed finding" }`
     - `{ "label": "Irrelevant", "description": "False positive — not applicable" }`
     - `{ "label": "Skip", "description": "Skip without judgment" }`

2. Wait for the user's response.

3. Record the result:
   - **"Relevant"**: Add to `true_positives[]` (with the full case data including `classification`). Output: `✓ Marked as true positive`
   - **"Irrelevant"**: Add to `false_positives[]` (with any free-text notes as `developerNote`). Output: `✗ Marked as false positive`
   - **"Skip"**: Add to `skipped[]`. Output: `○ Skipped`
   - **Free-text response**: Record as notes attached to a "Skip" decision.

4. **Continue to the next finding** — repeat steps 1-3 until ALL findings have been presented.

**After ALL findings reviewed, output:**
```
✓ Review complete (<tp_count> true positives, <fp_count> false positives, <skipped_count> skipped)
```

---

## Stage 5: Output Lists + Updated Report

**Before starting, output:**
```
Stage 5/6: Generating results...
```

### 5a. Classify Into Two Lists

Classification uses the `classification` field from the analyzer output (auto-fixable vs manual-review), applied only to cases that made it through review.

**If the developer reviewed findings (Stage 4b):**
- **Auto-Remediable** = cases from `true_positives[]` AND `skipped[]` where `classification == "auto-fixable"`
- **Needs More Context** = cases from `true_positives[]` AND `skipped[]` where `classification == "manual-review"`
- False positives are excluded from both reports (tracked only in the outcome sidecar)
- Set `reviewStatus = "complete"`

**If the developer skipped review (Stage 4a):**
- **Auto-Remediable** = all cases with `classification: "auto-fixable"` from analysis
- **Needs More Context** = all cases with `classification: "manual-review"` from analysis
- **False Positives** = empty
- Set `reviewStatus = "skipped"`

### 5b. Write Two Categorized Reports

Write two separate markdown report files to `./.self-care/reports/`. Use `<date>` (today, YYYY-MM-DD) and `<short_id>` (first 8 chars of trace_id or session_id) for filenames.

Each report includes trace metadata so it stands alone as a complete document.

**Auto-Remediable Report** — `./.self-care/reports/<date>-<short_id>-auto-remediable.md`

Use the **Write** tool to create this file. Only write this file if there are auto-remediable cases (skip if the list is empty).

```markdown
---
report_type: auto-remediable
<format-specific metadata fields from Stage 1>
timestamp: <ISO timestamp>
case_count: <count>
severity_breakdown:
  high: <count>
  medium: <count>
  low: <count>
---

# Auto-Remediable Cases

These findings can be addressed with targeted codebase changes.

## Trace Summary

<same trace summary as the triage report — format, IDs, span/message count, time range>

## Cases

### Case 1: <type> (<severity>)

**Description**: <description>
**Evidence**: <evidence>
**Proposed Fix**: <proposedFix>

---

### Case 2: <type> (<severity>)

...
```

**Manual-Review Report** — `./.self-care/reports/<date>-<short_id>-manual-review.md`

Use the **Write** tool to create this file. Only write this file if there are needs-more-context cases (skip if the list is empty).

```markdown
---
report_type: manual-review
<format-specific metadata fields from Stage 1>
timestamp: <ISO timestamp>
case_count: <count>
severity_breakdown:
  high: <count>
  medium: <count>
  low: <count>
---

# Cases Requiring More Context

These findings need further investigation or domain expertise.

## Trace Summary

<same trace summary as the triage report — format, IDs, span/message count, time range>

## Cases

### Case 1: <type> (<severity>)

**Description**: <description>
**Evidence**: <evidence>
**Recommendation**: <proposedFix>

---

### Case 2: <type> (<severity>)

...
```

**Format-specific metadata fields** for YAML frontmatter:
- OTEL: `format: otel`, `trace_id`, `service_name`, `span_count`
- Claude Code: `format: claude-code`, `session_id`, `message_count`

### 5c. Display Two Lists in Terminal

After writing the reports, output the categorized results with case details:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Auto-Remediable Cases (<count>)
These findings can be addressed with targeted codebase changes.

  1. [<type>] (<severity>) — <description>
     Fix: <proposedFix first line>
  2. [<type>] (<severity>) — <description>
     Fix: <proposedFix first line>

  Report: <auto_remediable_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cases Requiring More Context (<count>)
These findings need further investigation or domain expertise.

  1. [<type>] (<severity>) — <description>
     Reason: <proposedFix>
  2. [<type>] (<severity>) — <description>
     Reason: <proposedFix>

  Report: <manual_review_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If either list is empty, output `  (none)` under the heading and omit the Report line for that list.

### 5d. Regenerate Triage Report With Review Outcomes

Call the **report-generator** agent again with:
- **Trace metadata**: same as Stage 3
- **Cases**: same full case list from Stage 2
- **Review status**: `reviewStatus` ("complete" or "skipped")
- **Review outcomes**: the categorized lists:
  - `autoRemediable[]` — cases with type, severity, description, proposedFix
  - `needsMoreContext[]` — cases with type, severity, description, proposedFix
  - `falsePositives[]` — cases with type, severity, description, developerNote
  - `skipped[]` — cases with type, severity, description
- **User-provided context** (if **details** is non-empty)

The agent will overwrite the triage report file with the final version including review outcomes.

### 5e. Write Outcome Sidecar

**Only if review was done and true or false positives exist.** Use the **Write** tool to save a JSON file at `./.self-care/reports/<date>-<short_id>-outcome.json` where `<date>` is today's date (YYYY-MM-DD) and `<short_id>` is the first 8 characters of trace_id (OTEL) or session_id (Claude Code):

```json
{
  "trace_id": "<id>",
  "timestamp": "<ISO timestamp>",
  "true_positives": [
    {
      "type": "<case type>",
      "severity": "<severity>",
      "description": "<description>",
      "developerNote": "<free text if provided, else null>"
    }
  ],
  "false_positives": [
    {
      "type": "<case type>",
      "severity": "<severity>",
      "description": "<description>",
      "developerNote": "<free text if provided, else null>"
    }
  ]
}
```

---

## Stage 6: Feedback

**Guard: Only prompt if analytics is enabled.** Use Bash to check if `.self-care/config.json` exists and analytics is enabled:

```
cat .self-care/config.json 2>/dev/null | jq -r '.analytics.enabled // false'
```

If the result is not `"true"`, skip this stage entirely.

If opted in, use **AskUserQuestion**:
- **question**: `Would you recommend this tool to others?`
- **header**: "Feedback"
- **options**:
  - `{ "label": "Yes", "description": "I would recommend Self-Care" }`
  - `{ "label": "No", "description": "I would not recommend Self-Care" }`

Free-text responses are captured as additional notes.

After the user responds, send feedback via telemetry:

```
bash agents/skills/scripts/telemetry.sh sc_feedback_run '<json>'
```

Where `<json>` is:
```json
{
  "trace_format": "<format>",
  "total_cases": <N>,
  "true_positive_auto_fixable": <N>,
  "true_positive_manual_review": <N>,
  "false_positives": <N>,
  "skipped": <N>,
  "recommendation": "yes|no",
  "notes": "<free-text if provided, else null>"
}
```

Output: `Thank you for your feedback.`

---

## Pipeline Summary

After Stage 5 completes (or Stage 3 if no cases), display the final pipeline summary. The summary is shown **before** Stage 6 (Feedback).

**If findings were reviewed:**

For OTEL traces:
```
Self-Care Complete

Trace: <service_name> (<trace_id>)
Source: <source_url>
Cases found: <total>
  Auto-remediable:       <auto_remediable_count>
  Needs more context:    <needs_context_count>
  True positives:       <tp_count>
  False positives:       <fp_count>
  Skipped:               <skipped_count>

Reports:
  Triage:           <triage_report_path>
  Auto-remediable:  <auto_remediable_path or "(none)">
  Manual-review:    <manual_review_path or "(none)">

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What's Next
• Review the reports in ./.self-care/reports/
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
```

**If review was skipped:**

Same as above but omit the "False positives" and "Skipped" lines.

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
4. **Re-run Stages 3 → 4 → 5** with the updated findings

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
