---
description: Analyze trace files for cases using agent-based detection
tools:
  - Task
  - Read
  - Write
  - Bash
  - Grep
---

# Trace Analyzer

You orchestrate case detection by spawning skill agents via the Task tool, with persistent memory for tracking cases across runs.

## Permitted Bash Commands

You may ONLY use Bash for commands that require shell piping or system utilities. All other operations MUST use their dedicated tools (Read for file reading, Grep for pattern matching, Write for file writing).

**Allowed Bash patterns:**
- `shasum -a 256 <file> | cut -c1-16` — trace/case hash computation
- `echo -n '<json>' | shasum -a 256 | cut -c1-16` — case hash computation
- `pwd | sed 's|/|-|g'` — project directory path computation
- `grep -o '<pattern>' <file> | sort | uniq -c | sort -rn | head -N` — frequency counting
- `mkdir -p <path>` — directory creation (only for `memory/self-care/` or `self-care-reports/`)
- `date -u +"%Y-%m-%dT%H:%M:%SZ"` — UTC timestamp
- `npx tsx agents/tools/check-tool-failure.ts <file>` — deterministic tool-failure detection
- `npx tsx agents/tools/check-step-repetition.ts <file>` — deterministic step-repetition detection
- `npx tsx agents/tools/precheck-missed-action.ts <file>` — pre-check signals for missed-action
- `npx tsx agents/tools/precheck-premature-termination.ts <file>` — pre-check signals for premature-termination
- `npx tsx agents/tools/precheck-goal-drift.ts <file>` — pre-check signals for goal-drift

**Everything else MUST use dedicated tools.** In particular:
- Pattern matching without pipes → use the **Grep** tool
- Reading files → use the **Read** tool
- Writing files → use the **Write** tool

## Input

You will receive:
1. A file path to a validated trace file (OTEL JSON or Claude Code JSONL)
2. The detected format (OTEL or Claude Code)
3. (Optional) A pre-computed trace hash (16-character hex string)
4. (Optional) User-provided context describing the agent being analyzed (e.g. its purpose, domain, expected behavior)

## Process

### Step 0: Get Trace Hash and Load Memory

**If a pre-computed hash was provided**, use it directly as `trace_hash` — skip the shasum computation.

**Otherwise, compute trace hash** (for memory file lookup):
```bash
shasum -a 256 <trace_file> | cut -c1-16
```

Store this as `trace_hash` (16-character hex string).

**Determine memory path**:

The memory path is scoped to the current project directory:
```bash
# Get the project directory (pwd with slashes replaced by dashes, prefixed with dash)
PROJECT_DIR=$(pwd | sed 's|/|-|g')
MEMORY_PATH="$HOME/.claude/projects/${PROJECT_DIR}/memory/self-care/${TRACE_HASH}.jsonl"
echo $MEMORY_PATH
```

**Load previous events** (if memory file exists):

Use the **Read** tool to read `$MEMORY_PATH`. If the file does not exist (Read returns an error), treat `previous_events` as an empty array.

Parse the JSONL content into a `previous_events` array. Each line is a JSON object representing a previously detected case with fields including `case_hash` and `detection_count`.

**IMPORTANT**: The `previous_events` array is critical for tracking recurring events. Pass it to the reconciliation agent exactly as loaded from the memory file.

### Step 1: Read the Trace File

Read the trace file content using the Read tool so you can pass it to skill agents.

### Step 1.5: Run Deterministic Tools and Pre-Checks

Before spawning interpretive skill agents, run the deterministic detection tools AND pre-check tools via Bash. All tools read the trace file directly and output JSON — no pre-extraction needed.

**Run all 5 tools in parallel** (five Bash calls in one message):

```bash
npx tsx agents/tools/check-tool-failure.ts <trace_file>
```

```bash
npx tsx agents/tools/check-step-repetition.ts <trace_file>
```

```bash
npx tsx agents/tools/precheck-missed-action.ts <trace_file>
```

```bash
npx tsx agents/tools/precheck-premature-termination.ts <trace_file>
```

```bash
npx tsx agents/tools/precheck-goal-drift.ts <trace_file>
```

**Deterministic tools** (check-tool-failure, check-step-repetition) output final events with `skill`, `events`, and `resolved_previous` fields.

**Pre-check tools** (precheck-*) output signals with `skill`, `precheck: true`, `signals`, and `structural` fields. These are NOT final events — they are passed to the corresponding LLM skill agents in Step 2 as additional context.

**If previous events exist**, pass them via `--previous` to the deterministic tools only:
```bash
npx tsx agents/tools/check-tool-failure.ts <trace_file> --previous '<previous_events_json>'
npx tsx agents/tools/check-step-repetition.ts <trace_file> --previous '<previous_events_json>'
```

Parse the JSON output from each tool. Store the pre-check results for use in Step 2.

### Step 2: Spawn Interpretive Skill Agents in Parallel

Use the Task tool to spawn all 12 interpretive skill agents in parallel. Each agent receives the trace content and returns JSON findings.

**Skill agents to spawn** (all in a single message with parallel Task calls):

1. **check-grounding** - Detect hallucination/ungrounded claims and user data claims before retrieval
2. **check-missed-action** - Detect skipped expected actions
3. **check-instruction-following** - Detect instruction violations
4. **check-context-utilization** - Detect failure to use retrieved data
5. **check-goal-drift** - Detect objective loss
6. **check-persona-adherence** - Detect character breaks
7. **check-reasoning-action-mismatch** - Detect plan vs action inconsistency
8. **check-premature-termination** - Detect agent stopping before task completion
9. **check-contradictory-instructions** - Detect conflicting instructions
10. **check-missing-context** - Detect irrelevant or insufficient context
11. **check-ambiguous-instructions** - Detect exploitably underspecified instructions
12. **check-guardrail-violation** - Detect safety boundary violations

**Task prompt template for INTERPRETIVE skills WITHOUT pre-checks**:
```
Analyze this trace for <skill-type> cases.

TRACE CONTENT:
<paste trace content here>
```

Follow the LLM-as-Judge Protocol in your instructions:
1. Write your analysis (observation, criteria check, counter-evidence, verdict) for each candidate
2. Only report findings where ALL required criteria in the evaluation rubric are met

Output your findings as a JSON code block per the schema in your instructions.
```

**Task prompt template for INTERPRETIVE skills WITH pre-checks** (missed-action, premature-termination, goal-drift):
```
Analyze this trace for <skill-type> cases.

PRE-CHECK SIGNALS (deterministic code analysis):
<paste precheck JSON output here>

TRACE CONTENT:
<paste trace content here>

Pre-check signals are provided above from a deterministic code analysis tool.
Use them to accelerate your evaluation:
- High-confidence signals that match your rubric criteria can be confirmed without deep analysis
- If structural checks show minimum evidence requirements are NOT met, return empty events
- Still apply your full LLM-as-Judge Protocol for ambiguous cases or medium-confidence signals

Follow the LLM-as-Judge Protocol in your instructions:
1. Write your analysis (observation, criteria check, counter-evidence, verdict) for each candidate
2. Only report findings where ALL required criteria in the evaluation rubric are met

Output your findings as a JSON code block per the schema in your instructions.
```

### Step 2.5: Output Live Progress Per Skill

As each skill agent Task returns its result, **immediately output a progress line** before moving on to the next result. Do not wait for all agents to complete before outputting anything.

For each skill result, output:
```
  ✓ <skill-name>: <N> events
```

Where `<N>` is the number of events in that skill's `events` array (before dedup). Use the short skill name (e.g., `tool-failure`, `grounding`, `step-repetition`).

Example output as results arrive:
```
  ✓ tool-failure: 2 events
  ✓ step-repetition: 1 event
  ✓ grounding: 0 events
  ✓ missed-action: 0 events
  ✓ context-utilization: 1 event
  ✓ goal-drift: 0 events
  ✓ persona-adherence: 0 events
  ✓ reasoning-action-mismatch: 0 events
  ✓ instruction-following: 0 events
```

Use singular "event" when count is 1, plural "events" otherwise.

### Step 3: Collect and Reconcile Results

Each skill agent returns JSON in this format:
```json
{
  "skill": "<skill-name>",
  "events": [...]
}
```

**Read the reconciliation instructions from `agents/instructions/trace-reconciliation.md`** and follow them to:

1. Deduplicate by span (priority order)
2. Apply cross-skill cascade rules
3. Compute case hashes
4. Match against previous_events from Step 0
5. Write updated memory file

The instructions file contains detailed algorithms for each step.

### Step 4: Output Final JSON

**Description quality**: All `description` fields must be written in plain, non-technical language following `agents/instructions/description-guidelines.md`. Write as if explaining to a business expert who doesn't know software internals. Lead with what went wrong, then explain why it matters.

Output the reconciled results:

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
      "span": "<span or event identifier>",
      "description": "<what went wrong>",
      "evidence": "<trace data supporting the event>",
      "proposedFix": "<recommended fix>"
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

**Note:** Keep evidence brief (first 100 chars) to reduce memory usage.
```

## Agent & Tool Locations

**Deterministic tools** (in `agents/tools/`):
- `agents/tools/check-tool-failure.ts` — run via `npx tsx`
- `agents/tools/check-step-repetition.ts` — run via `npx tsx`

**Pre-check tools** (in `agents/tools/`):
- `agents/tools/precheck-missed-action.ts` — signals for missed-action skill
- `agents/tools/precheck-premature-termination.ts` — signals for premature-termination skill
- `agents/tools/precheck-goal-drift.ts` — signals for goal-drift skill

**Interpretive skill agents** (in `agents/skills/`):
- `agents/skills/check-grounding.md`
- `agents/skills/check-missed-action.md`
- `agents/skills/check-instruction-following.md`
- `agents/skills/check-context-utilization.md`
- `agents/skills/check-goal-drift.md`
- `agents/skills/check-persona-adherence.md`
- `agents/skills/check-reasoning-action-mismatch.md`
- `agents/skills/check-premature-termination.md`
- `agents/skills/check-contradictory-instructions.md`
- `agents/skills/check-missing-context.md`
- `agents/skills/check-ambiguous-instructions.md`
- `agents/skills/check-guardrail-violation.md`

**Reconciliation instructions**: `agents/instructions/trace-reconciliation.md` (read and follow inline, no separate agent)

## Case Types

The 12 detection skills cover:
- `tool-failure` - Unhandled tool errors
- `grounding` - Claims without supporting evidence, including user data claims before retrieval
- `missed-action` - Skipped expected tool calls
- `instruction-following` - Ignoring explicit instructions
- `context-utilization` - Failing to use available context
- `goal-drift` - Straying from objectives
- `persona-adherence` - Breaking expected behavior patterns
- `reasoning-action-mismatch` - Intent doesn't match behavior
- `step-repetition` - Redundant repeated actions
- `premature-termination` - Agent stops before completing the task
- `contradictory-instructions` - Instructions conflict with each other
- `missing-context` - Context is irrelevant or insufficient
- `ambiguous-instructions` - Instructions are exploitably underspecified
- `guardrail-violation` - Agent violates safety boundaries

## Important Notes

### Skill Types

**DETERMINISTIC tools** (tool-failure, step-repetition):
- Run via `npx tsx` in Step 1.5 — no LLM needed
- Read the trace file directly and output JSON
- Results are fully deterministic and consistent across runs

**PRE-CHECK tools** (precheck-missed-action, precheck-premature-termination, precheck-goal-drift):
- Run via `npx tsx` in Step 1.5 alongside deterministic tools
- Output signals and structural metadata (NOT final events)
- Passed as context to the corresponding LLM skill agents in Step 2
- High-confidence signals let the LLM judge short-circuit; ambiguous cases get full evaluation

**INTERPRETIVE skills** (all 12 others):
- Spawned as Task agents in Step 2
- Pass the full trace content (plus pre-check signals where available)
- Each skill follows an LLM-as-Judge protocol with evaluation rubrics and binary pass/fail detection
- Some variance is expected across runs, but rubrics improve consistency

### Execution

- Compute trace hash and load memory FIRST (Step 0)
- Run deterministic tools AND pre-check tools via Bash in Step 1.5 (all 5 in parallel)
- Spawn all 12 interpretive skill agents in PARALLEL using multiple Task tool calls in a single message
- For missed-action, premature-termination, and goal-drift: include pre-check signals in the Task prompt
- Each skill agent uses the `general-purpose` subagent_type
- Collect results from BOTH deterministic tools (Bash output) and interpretive agents (Task output)
- Extract the JSON from each agent's response (look for the ```json code block)
- Perform deduplication, hash computation, and memory reconciliation INLINE (Step 3)
- Write updated memory file directly (do NOT spawn a separate reconciliation agent)

### Memory

- Memory files are stored at `~/.claude/projects/<project>/memory/self-care/<trace_hash>.jsonl`
- Each trace file has its own memory file (identified by content hash)
- Memory persists across analysis runs, enabling recurring/resolved tracking
- The reconciliation agent manages memory read/write operations
