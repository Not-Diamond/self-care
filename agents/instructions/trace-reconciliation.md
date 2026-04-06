# Trace Reconciliation Instructions

These instructions describe how to reconcile cases from skill agents with persistent memory.

## Overview

Reconciliation takes raw events from 14 skill agents and:
1. Deduplicates by span (priority order)
2. Applies cross-skill cascade rules
3. Computes case hashes for identification
4. Matches against previous events from memory
5. Writes updated memory file

## Step 1: Deduplicate by Span

When the same span (line number) is flagged by multiple skills, keep only the highest priority:

| Priority | Skill | Reason |
|----------|-------|--------|
| 1 (highest) | `tool-failure` | Deterministic tool (`agents/tools/`) |
| 2 | `step-repetition` | Deterministic tool (`agents/tools/`) |
| 3 | Other interpretive skills | Keep first, discard `instruction-following` |
| 4 (lowest) | `instruction-following` | Catch-all |

**Algorithm:**
```
FOR each unique span:
  candidates = events with this span
  IF any is tool-failure: keep it, ALSO keep any co-fire partners (see Co-fire Exceptions)
  ELSE IF any is step-repetition: keep it, ALSO keep any co-fire partners
  ELSE: keep first non-instruction-following, or instruction-following if only option
  THEN: apply Co-fire Exceptions — restore any discarded event that forms a co-fire pair
```

## Step 2: Apply Cross-Skill Cascade Rules

For events within 3 lines of each other, keep the more specific.
**Cascades take precedence over co-fire exceptions** — if a pair appears in both tables, the cascade wins and the loser is discarded.

| Winner | Loser | Reason |
|--------|-------|--------|
| `goal-drift` | `missed-action` | Drifting subsumes missing |
| `reasoning-action-mismatch` | `missed-action` | Mismatch is more specific |
| `tool-failure` | `context-utilization` | Can't use failed tool's output |
| `premature-termination` | `missed-action` | Stopping early subsumes missing the action |
| `contradictory-instructions` | `instruction-following` | Conflicting instructions is more specific |
| `contradictory-instructions` | `ambiguous-instructions` | Contradiction is stricter than ambiguity |
| `missing-context` | `context-utilization` | Can't utilize context that's missing/irrelevant |
| `ambiguous-instructions` | `instruction-following` | Ambiguity is more specific than generic violation |
| `guardrail-violation` | `persona-adherence` | Safety violation is more specific than persona break |
| `guardrail-violation` | `instruction-following` | Safety is more specific than instruction violation |
| Any interpretive skill | `instruction-following` | IF is catch-all |

### Co-fire Exceptions

Keep BOTH events when these co-occur on the same span (different root causes or risk dimensions):

| Skill A | Skill B | Reason |
|---------|---------|--------|
| `missing-context` | `grounding` | Different root causes |
| `guardrail-violation` | `grounding` | Different risk dimensions |
| `guardrail-violation` | `tool-failure` | Attempted action vs execution error |
| `tool-failure` | `premature-termination` | Resource exhaustion/timeout forces agent to stop entirely |
| `step-repetition` | `guardrail-violation` | Mechanical loop vs intentional/reckless resource abuse |
| `ambiguous-instructions` | `tool-failure` | Missing/vague setup prerequisites vs resulting execution error |
| `contradictory-instructions` | `tool-failure` | Defective tool definition vs resulting execution error |
| `premature-termination` | `reasoning-action-mismatch` | Sub-agent stopped early and parent failed to detect/recover |

## Step 3: Compute Case Hashes

For each deduplicated event, compute a stable identifier:

```bash
# Hash = sha256(type + span + evidence_prefix)[:16]
echo -n "{\"type\":\"$TYPE\",\"span\":\"$SPAN\",\"evidence_prefix\":\"${EVIDENCE:0:100}\"}" | shasum -a 256 | cut -c1-16
```

The hash uniquely identifies a case across runs.

## Step 4: Reconcile with Previous Events

Compare current events to `previous_events` loaded from memory:

**For each current event (with case_hash computed):**

```
SEARCH previous_events for matching case_hash

IF MATCH FOUND:
  persistence_status = "recurring"
  detection_count = previous.detection_count + 1
  first_detected_at = previous.first_detected_at  # Keep original
  last_detected_at = NOW

IF NO MATCH:
  persistence_status = "new"
  detection_count = 1
  first_detected_at = NOW
  last_detected_at = NOW
```

**For each previous event:**

```
SEARCH current events for matching case_hash

IF NOT FOUND:
  Add to resolved[] array with resolved_at = NOW
```

## Step 5: Write Memory File

Write active events to the memory file (JSONL format, one event per line):

```bash
# Expand ~ and write
MEMORY_PATH="$HOME/.claude/projects/$PROJECT_DIR/memory/self-care/$TRACE_HASH.jsonl"
mkdir -p "$(dirname "$MEMORY_PATH")"
```

Use the Write tool to save. Each line is a JSON object:

```json
{"case_hash":"abc123","type":"tool-failure","severity":"high","classification":"auto-fixable","span":"line 42","description":"...","evidence":"...","proposedFix":"...","detected_by_skill":"tool-failure","first_detected_at":"2026-02-19T10:00:00Z","last_detected_at":"2026-02-19T12:00:00Z","detection_count":3,"status":"active"}
```

**CRITICAL:** Write the RECONCILED data with updated `detection_count`, not raw skill outputs.

## Output Format

The final JSON output includes:

```json
{
  "format": "OTEL|Claude Code",
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
      "span": "<line N or span identifier>",
      "description": "...",
      "evidence": "...",
      "proposedFix": "..."
    }
  ],
  "resolved": [
    {
      "case_hash": "<16-char hash>",
      "type": "<case-type>",
      "span": "<span>",
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

## Timestamp Format

Use ISO 8601 UTC: `YYYY-MM-DDTHH:MM:SSZ`

Get current timestamp:
```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
