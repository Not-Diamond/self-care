# Self-Care

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-7C3AED)](https://docs.anthropic.com/en/docs/claude-code)

Agent trace analysis and context remediation plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

**Your AI agents fail in subtle ways** — they drift from goals, ignore context, skip steps, or hallucinate mid-task. These issues hide in traces and are hard to catch manually. Self-Care scans your agent traces, detects 14 types of quality issues, and helps you fix them.

## Quick Start

```bash
# Add the marketplace
/plugin marketplace add Not-Diamond/self-care

# Install the plugin
/plugin install self-care@self-care
```

Analyze traces from a connected source:

```bash
/self-care:init    # Configure LangSmith or LangFuse
/self-care:run     # Fetch and analyze traces
```

Or analyze a local trace file directly:

```bash
/self-care:run path/to/trace.json
```

## Example Output

Running `/self-care:run` on a trace produces a triage report like this:

```
Trace: customer-support-agent (abc123def456)
Cases: 3 (2 auto-fixable, 1 manual-review)
Report saved to: .self-care/reports/2026-04-06-a1b2c3d4-triage.md
```

The report contains detailed findings:

```markdown
## Cases

### Event 1: goal-drift (high)

**Description**: Agent was asked to update shipping address but pivoted to
processing a refund after the customer mentioned a late delivery.
**Evidence**: Turn 4 initiates refund flow without completing address update.
**Classification**: auto-fixable
**Proposed Fix**: Add instruction anchoring — "Complete the current task before
addressing new requests."

---

### Event 2: missed-action (medium)

**Description**: Customer asked for email confirmation. Agent acknowledged
but never triggered the send-email tool.
**Evidence**: Turn 7 says "I'll send that right away" but no tool call follows.
**Classification**: auto-fixable
**Proposed Fix**: Add explicit action verification step after acknowledgment.

---

### Event 3: grounding (medium)

**Description**: Agent cited a "30-day return policy" but the retrieved policy
document specifies 14 days.
**Evidence**: Turn 5 states "30 days" vs knowledge base showing "14 days".
**Classification**: manual-review
**Recommendation**: Review system prompt for hardcoded policy references that
may conflict with retrieved documents.
```

Auto-fixable cases can be applied directly. Manual-review cases are escalated for human judgment.

## Commands

| Command | Description |
|---------|-------------|
| `/self-care:run` | Fetch and analyze traces, generate report |
| `/self-care:validate <file>` | Validate trace file format (OTEL or Claude Code) |
| `/self-care:init` | Configure trace source (LangSmith or LangFuse) |
| `/self-care:config` | View or update configuration |
| `/self-care:help` | Show help and usage information |

## What It Detects

Self-Care runs 14 specialized detection skills on your traces:

| Skill | What it finds |
|-------|---------------|
| Context Utilization | Agent ignores relevant context from previous turns |
| Reasoning-Action Mismatch | Agent's reasoning contradicts its actions |
| Instruction Following | Agent violates explicit instructions |
| Step Repetition | Agent repeats the same step unnecessarily |
| Goal Drift | Agent gradually drifts from the original objective |
| Missing Context | Agent lacks critical context to complete the task |
| Tool Failure | Agent fails to handle tool errors appropriately |
| Missed Action | Agent skips a required action |
| Ambiguous Instructions | Agent receives unclear instructions and guesses wrong |
| Contradictory Instructions | Agent receives conflicting instructions |
| Grounding | Agent hallucinates or makes ungrounded claims |
| Persona Adherence | Agent breaks character or role boundaries |
| Premature Termination | Agent stops before completing the task |
| Guardrail Violation | Agent violates safety or policy guardrails |

## Trace Sources

Self-Care supports importing traces from:

- **[LangSmith](https://www.langchain.com/langsmith)** — Set `LANGSMITH_API_KEY` env var
- **[LangFuse](https://langfuse.com/)** — Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` env vars
- **Local files** — Any OTEL-format or Claude Code trace JSON file

## Contributing

We welcome bug reports, feature requests, and pull requests! See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

[MIT](./LICENSE)
