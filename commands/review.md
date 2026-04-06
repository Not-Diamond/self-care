---
description: Review unreviewed reports — walk through findings and categorize them
argument: "[count]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Bash
  - AskUserQuestion
  - Task
---

# Review Unreviewed Reports

Review reports that have not been reviewed yet (`review_status: pending`). Walks through findings for each report using the same review flow as `/self-care:run` stages 4, 5, and 6.

## Stage 0: Parse Arguments

Parse `$ARGUMENTS` to extract:

- **count**: Optional positive integer — the number of reports to review. Defaults to all pending reports if not specified.

**Example inputs:**
- `` (empty) → review all pending reports
- `3` → review the 3 most recent pending reports
- `1` → review only the most recent pending report

---

## Stage 1: Find Pending Reports

Use Bash to find all reports with `review_status: pending` in `./.self-care/reports/`:

```
grep -l 'review_status: pending' ./.self-care/reports/*-triage.md 2>/dev/null | sort -r
```

This returns report files sorted newest-first (filenames start with YYYY-MM-DD).

For each report file found, verify that a corresponding data sidecar exists. The data file has the same name but with `-data.json` instead of `-triage.md`:
- Report: `./.self-care/reports/2026-04-01-abc12345-triage.md`
- Data: `./.self-care/reports/2026-04-01-abc12345-data.json`

Skip any report whose data sidecar is missing (output a warning: `⚠ Skipping <report_file>: data file not found`).

If **count** is specified, take only the first **count** reports from the sorted list.

**If no pending reports are found, output:**
```
No unreviewed reports found in ./.self-care/reports/
```
And stop.

**Otherwise, output:**
```
Found <N> unreviewed report(s). Reviewing <M> report(s)...
```
Where `<N>` is the total pending and `<M>` is the number being reviewed (limited by count if specified).

---

## Stage 2: Review Each Report

For each pending report (newest first):

### 2a. Load Report Data

Read the data sidecar JSON file. Extract:
- **format**: trace format (otel or claude-code)
- **metadata**: trace metadata
- **cases**: the full case array (type, severity, description, evidence, classification, proposedFix)
- **agentContext**: optional user-provided context

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Report <current>/<total>: <report_filename>
```

For OTEL: `Trace: <service_name> (<trace_id>)`
For Claude Code: `Session: <session_id>`

```
Cases: <total_cases> (<high> high, <medium> medium, <low> low)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2b. Finding Review (same as run.md Stage 4)

**Offer to skip review for this report** using **AskUserQuestion**:

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
  - `{ "label": "Skip report", "description": "Skip this report entirely and move to the next" }`

If **Skip report** → move to the next report. Leave this report as pending.

If **Skip review** → jump to 2c. All cases retain their original `classification`. No false positives recorded. Set `reviewStatus = "skipped"`.

If **Review findings** → iterate through ALL cases, sorted by severity (high → medium → low).

**CRITICAL formatting rule: Do NOT use triple-backtick code fences (```) anywhere in the AskUserQuestion question text.**

For EACH finding, use **AskUserQuestion**:

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

Record results:
- **"Relevant"**: Add to `true_positives[]` (with full case data including `classification`). Output: `✓ Marked as true positive`
- **"Irrelevant"**: Add to `false_positives[]` (with any free-text notes as `developerNote`). Output: `✗ Marked as false positive`
- **"Skip"**: Add to `skipped[]`. Output: `○ Skipped`
- **Free-text response**: Record as notes attached to a "Skip" decision.

After all findings reviewed:
```
✓ Review complete (<tp_count> true positives, <fp_count> false positives, <skipped_count> skipped)
```

### 2c. Output Lists + Updated Report (same as run.md Stage 5)

**Classify into two lists:**

Classification uses the `classification` field from the analyzer output (auto-fixable vs manual-review), applied only to cases that made it through review.

If the developer **reviewed findings**:
- **Auto-Remediable** = cases from `true_positives[]` AND `skipped[]` where `classification == "auto-fixable"`
- **Needs More Context** = cases from `true_positives[]` AND `skipped[]` where `classification == "manual-review"`
- False positives are excluded from both reports (tracked only in the outcome sidecar)
- Set `reviewStatus = "complete"`

If the developer **skipped review**:
- **Auto-Remediable** = all cases with `classification: "auto-fixable"`
- **Needs More Context** = all cases with `classification: "manual-review"`
- **False Positives** = empty
- Set `reviewStatus = "skipped"`

**Write two categorized reports:**

Write two separate markdown report files to `./.self-care/reports/`. Derive `<date>` and `<short_id>` from the report filename.

Each report includes trace metadata so it stands alone as a complete document.

**Auto-Remediable Report** — `./.self-care/reports/<date>-<short_id>-auto-remediable.md`

Use the **Write** tool to create this file. Only write this file if there are auto-remediable cases (skip if the list is empty).

```markdown
---
report_type: auto-remediable
<format-specific metadata fields from data sidecar>
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
<format-specific metadata fields from data sidecar>
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

**Display two lists in terminal:**

After writing the reports, output the categorized results with case details:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Auto-Remediable Cases (<count>)
These findings can be addressed with targeted codebase changes.

  1. [<type>] (<severity>) — <description>
     Fix: <proposedFix first line>

  Report: <auto_remediable_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cases Requiring More Context (<count>)
These findings need further investigation or domain expertise.

  1. [<type>] (<severity>) — <description>
     Reason: <proposedFix>

  Report: <manual_review_path>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If either list is empty, output `  (none)` under the heading and omit the Report line for that list.

**Regenerate triage report with review outcomes:**

Call the **report-generator** agent with:
- **Trace metadata**: from the data sidecar
- **Cases**: full case list from the data sidecar
- **Review status**: `reviewStatus` ("complete" or "skipped")
- **Review outcomes**: the categorized lists:
  - `autoRemediable[]` — cases with type, severity, description, proposedFix
  - `needsMoreContext[]` — cases with type, severity, description, proposedFix
  - `falsePositives[]` — cases with type, severity, description, developerNote
  - `skipped[]` — cases with type, severity, description
- **User-provided context**: `agentContext` from data sidecar (if present)

The agent will overwrite the triage report file with the final version including review outcomes.

**Write outcome sidecar (only if review was done and true or false positives exist):**

Use the **Write** tool to save `./.self-care/reports/<date>-<short_id>-outcome.json` (deriving date and short_id from the report filename):

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

### 2d. Continue to Next Report

After completing one report, move to the next pending report and repeat from 2a.

---

## Stage 3: Feedback (same as run.md Stage 6)

After all reports have been reviewed, check analytics consent:

```
cat .self-care/config.json 2>/dev/null | jq -r '.analytics.enabled // false'
```

If not `"true"`, skip.

If opted in, use **AskUserQuestion**:
- **question**: `Would you recommend this tool to others?`
- **header**: "Feedback"
- **options**:
  - `{ "label": "Yes", "description": "I would recommend Self-Care" }`
  - `{ "label": "No", "description": "I would not recommend Self-Care" }`

Send feedback via telemetry:

```
bash agents/skills/scripts/telemetry.sh sc_feedback_review '<json>'
```

Where `<json>` is:
```json
{
  "reports_reviewed": <N>,
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

## Summary

After all reports processed (and after Stage 3 if applicable), output:

```
Review Complete

Reports reviewed: <reviewed_count>/<total_pending>
  Completed:    <completed_count>
  Skipped:      <skipped_report_count>

Total findings across all reports:
  Auto-remediable:    <total_auto>
  Needs more context: <total_context>
  True positives:     <total_tp>
  False positives:    <total_fp>
  Skipped:            <total_skipped>

Reports saved to: ./.self-care/reports/
```
