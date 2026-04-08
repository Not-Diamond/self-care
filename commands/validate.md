---
description: Validate a trace file (OTEL or Claude Code) and extract metadata
argument: <trace-file>
allowed-tools:
  - Bash
  - AskUserQuestion
  - Task
---

# Validate Trace

Validate the provided trace file and report its metadata. Supports both OTEL (JSON) and Claude Code (JSONL) formats.

## Instructions

Run the deterministic trace validator:

```bash
node "${CLAUDE_PLUGIN_ROOT}/agents/tools/validate-trace.mjs" $ARGUMENTS
```

Parse the JSON output. The result contains:
- `valid`: boolean — whether the trace passed validation
- `format`: "otel" | "claude-code" | "unknown"
- `errors`: array of critical failure messages
- `warnings`: array of non-critical issues
- `metadata`: object with format-specific fields

**If `valid` is true**, display the validation results:

For OTEL:
```
Trace Validation: PASSED
Format: OTEL
Trace ID: <metadata.traceId>
Service Name: <metadata.serviceName>
Span Count: <metadata.spanCount>
System Prompt: <metadata.systemPromptDetected ? "FOUND (via " + metadata.systemPromptMethod + ")" : "NOT FOUND">
```

For Claude Code:
```
Trace Validation: PASSED
Format: Claude Code
Session ID: <metadata.sessionId>
Event Types: <metadata.eventTypes joined with ", ">
System Prompt: <metadata.systemPromptDetected ? "FOUND (via " + metadata.systemPromptMethod + ")" : "NOT FOUND">
```

**If `valid` is false**, check whether the errors are **recoverable** (eligible for flexible validation):

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

**If any unrecoverable error is present**, display the errors and stop:
```
Trace Validation: FAILED
Errors:
- <each error on its own line>
```

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

**If the user selects "Stop"**, display the errors and stop:
```
Trace Validation: FAILED
Errors:
- <each error on its own line>
```

**If the user selects "Try flexible validation"**, invoke the **flexible-validator** agent via **Task** with:
- **trace_path**: the trace file path from `$ARGUMENTS`
- **deterministic_result**: the full JSON output from the deterministic validator

Parse the agent's JSON output.

**If the flexible validator returns `valid: true`:**

For OTEL:
```
Trace Validation: PASSED (flexible)
Format: OTEL
Trace ID: <metadata.traceId>
Service Name: <metadata.serviceName>
Span Count: <metadata.spanCount>
System Prompt: <metadata.systemPromptDetected ? "FOUND (via " + metadata.systemPromptMethod + ")" : "NOT FOUND">
Note: <flexibleNotes>
```

For Claude Code:
```
Trace Validation: PASSED (flexible)
Format: Claude Code
Session ID: <metadata.sessionId>
Event Types: <metadata.eventTypes joined with ", ">
System Prompt: <metadata.systemPromptDetected ? "FOUND (via " + metadata.systemPromptMethod + ")" : "NOT FOUND">
Note: <flexibleNotes>
```

**If the flexible validator returns `valid: false`:**
```
Trace Validation: FAILED (deterministic + flexible)
Errors:
- <each error from the flexible validator on its own line>
Note: <flexibleNotes>
```
