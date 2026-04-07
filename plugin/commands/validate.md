---
description: Validate a trace file (OTEL or Claude Code) and extract metadata
argument: <trace-file>
allowed-tools:
  - Bash
---

# Validate Trace

Validate the provided trace file and report its metadata. Supports both OTEL (JSON) and Claude Code (JSONL) formats.

## Instructions

Run the deterministic trace validator:

```bash
npx tsx agents/tools/validate-trace.ts $ARGUMENTS
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

**If `valid` is false**, display the errors:
```
Trace Validation: FAILED
Errors:
- <each error on its own line>
```
