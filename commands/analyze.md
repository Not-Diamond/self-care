---
description: Validate and analyze a trace file for cases
argument: <trace-file> [--hash <hash>] [--skip-validation]
allowed-tools:
  - Read
  - Write
  - Grep
  - Glob
  - Task
  - Bash
  - AskUserQuestion
---

# Analyze Trace

Validate and analyze the provided trace file for cases (grounding, missed-action, instruction-following, context-utilization, goal-drift, persona-adherence, reasoning-action-mismatch, step-repetition, tool-failure, premature-termination, contradictory-instructions, missing-context, ambiguous-instructions, guardrail-violation). Supports both OTEL (JSON) and Claude Code (JSONL) formats.

## Arguments

- `<trace-file>`: Path to the trace file (required)
- `--hash <hash>`: Pre-computed trace hash (optional). If provided, skip `shasum` computation and use this hash for memory lookup and output. This is a 16-character hex string.

**Parse arguments**: Extract the trace file path and optional `--hash` value from `$ARGUMENTS`. Example inputs:
- `"/path/to/trace.json"` → path="/path/to/trace.json", hash=null
- `"/path/to/trace.json" --hash abc123def456789` → path="/path/to/trace.json", hash="abc123def456789"

## Memory Behavior

Sift maintains persistent memory for each trace file to track cases across analysis runs:

- **Memory storage**: `.self-care/memory/<trace_hash>.jsonl`
- **Trace hash**: SHA256 of trace file content (first 16 characters), or provided via `--hash`
- **Persistence**: Events are tracked as "new" (first detection) or "recurring" (seen before)
- **Resolution**: Previously detected events that no longer appear are marked as "resolved"

## Instructions

### Stage 0: Parse Arguments

Extract the trace file path and optional flags from `$ARGUMENTS`:

1. If `$ARGUMENTS` contains `--hash`, extract the hash value:
   - **provided_hash**: The value after `--hash` (trimmed)
   - Remove `--hash <value>` from the argument string
2. Otherwise: **provided_hash** = null

3. If `$ARGUMENTS` contains `--skip-validation`:
   - **skip_validation** = true
   - Remove `--skip-validation` from the argument string
4. Otherwise: **skip_validation** = false

5. The remaining string is **trace_path** (trimmed, with quotes removed)

6. If the prompt (not `$ARGUMENTS`) contains an `<analysis-config>` block, extract its JSON content:
   - **analysis_config_json**: The JSON string inside the `<analysis-config>` tags
   - This block appears after the command line in the prompt body (appended by the server)
7. Otherwise: **analysis_config_json** = null

8. If the prompt contains an `<agent-context>` block, extract its text content:
   - **agent_context**: The text inside the `<agent-context>` tags
9. Otherwise: **agent_context** = null

Store these values for use in later stages.

### Stage 1: Validation

**If `skip_validation` is true:** Skip the LLM validation agent. Instead, detect format directly:
1. Use **Grep** tool: pattern `"type":"user"`, path: trace_path, output_mode: count
2. If count > 0: **format** = "Claude Code"
3. Otherwise, use **Grep**: pattern `"resourceSpans"`, path: trace_path, output_mode: count
4. If count > 0: **format** = "OTEL"
5. Otherwise: Report "Unknown trace format" and stop

**If `skip_validation` is false:** Run the deterministic trace validator:

```bash
node "${CLAUDE_PLUGIN_ROOT}/agents/tools/validate-trace.mjs" "<trace_path>"
```

Parse the JSON output to extract validation status and metadata.

After validation (or format detection), extract these fields based on detected format:

**For OTEL format:**
- **format**: "OTEL"
- **trace_id**: The trace ID
- **service_name**: The service name
- **span_count**: Total span count
- **time_range**: Start and end timestamps

**For Claude Code format:**
- **format**: "Claude Code"
- **session_id**: The session ID
- **message_count**: User + assistant message count
- **event_types**: List of event types found
- **time_range**: Start and end timestamps

- **validation_status**: PASSED or FAILED

**If validation fails and `skip_validation` is false**, check whether the errors are **recoverable** (eligible for flexible validation):

Recoverable errors (any of these present → offer fallback):
- "No system prompt found"
- "Unknown trace format"
- "Invalid Claude Code event structure"

Unrecoverable errors (if ANY of these are present → do NOT offer fallback):
- "File not found"
- "File is not valid JSON or JSONL"
- "Empty Claude Code trace"
- "Missing resourceSpans"
- "No spans found in trace"

**If any unrecoverable error is present**, stop here and report the failure. Do not proceed to analysis.

**If at least one error is recoverable**, offer flexible validation via **AskUserQuestion**:

- **question**:
  ```
  Deterministic validation failed:
  ─────────────────────────────────────────────────────────
  <each error on its own line, prefixed with •>
  ─────────────────────────────────────────────────────────
  Would you like to try flexible (AI-assisted) validation?
  This uses an LLM to assess whether the trace is still
  structurally usable despite not passing strict format checks.
  ```
- **header**: "Flexible Validation"
- **options**:
  - `{ "label": "Try flexible validation", "description": "Use AI to assess trace structure" }`
  - `{ "label": "Stop", "description": "Accept the validation failure" }`

**If the user selects "Stop"**, stop here and report the failure. Do not proceed to analysis.

**If the user selects "Try flexible validation"**, invoke the **flexible-validator** agent via **Task** with:
- **trace_path**: the trace file path
- **deterministic_result**: the full JSON output from the deterministic validator

Parse the agent's JSON output.

- **If the flexible validator returns `valid: true`**: populate **format** and format-specific fields from the flexible result's `metadata`, and continue to Stage 2.
- **If the flexible validator returns `valid: false`**: stop here and report the flexible validator's errors and `flexibleNotes`. Do not proceed to analysis.

**If validation fails and `skip_validation` is true**, stop here and report the failure. Do not proceed to analysis.

### Stage 2: Analysis

Use the **trace-analyzer** agent to analyze the validated trace file.

Pass to the trace-analyzer agent:
- **trace_path** (the parsed file path from Stage 0)
- The detected format from validation
- **provided_hash** (if not null, tell the analyzer to use this hash instead of computing it)
- **analysis_config_json** (if not null, include as: "Analysis configuration: `<analysis-config>`{json}`</analysis-config>`")
- **agent_context** (if not null, include as: "Agent context: `<agent-context>`{text}`</agent-context>`")

The agent will:
1. Read the trace file
2. Spawn all 14 skill detection agents in parallel
3. Aggregate and deduplicate results
4. Return structured JSON

After the agent completes:

1. **Output per-skill progress**: The analyzer's response includes per-skill result lines (formatted as `  ✓ <skill-name>: <N> events`). Extract these lines from the response and output them so the user sees the breakdown by skill. This is important because the analyzer runs as a Task agent whose output is not directly visible to the user.

2. **Output the JSON result** exactly as returned. Do not reformat or summarize - pass through the complete JSON verbatim.

**Important**: The response ends with a JSON code block containing structured results:
```json
{
  "format": "OTEL" | "Claude Code",
  "trace_hash": "<16-char hash>",
  "eventCount": N,
  "events": [
    {
      "type": "<case-type>",
      "severity": "high|medium|low",
      "classification": "auto-fixable|manual-review",
      "case_hash": "<16-char hash>",
      "persistence_status": "new|recurring",
      "detection_count": N,
      "first_detected_at": "<ISO timestamp>",
      "span": "<span identifier>",
      "description": "...",
      "evidence": "...",
      "proposedFix": "..."
    }
  ],
  "resolved": [
    {
      "case_hash": "<16-char hash>",
      "type": "<case-type>",
      "span": "<span identifier>",
      "resolved_at": "<ISO timestamp>"
    }
  ],
  "summary": {
    "total": N,
    "new": N,
    "recurring": N,
    "resolved": N,
    "autoFixable": N,
    "manualReview": N,
    "high": N,
    "medium": N,
    "low": N
  }
}
```

### Output Fields

| Field | Description |
|-------|-------------|
| `trace_hash` | SHA256 of trace file content (first 16 chars) |
| `case_hash` | Unique identifier for each case (based on type, span, evidence) |
| `persistence_status` | "new" if first detection, "recurring" if seen before |
| `detection_count` | Number of times this event has been detected |
| `first_detected_at` | ISO timestamp of first detection |
| `resolved` | Array of previously detected events no longer present |

This JSON block is the canonical output for automated parsing and downstream processing.
