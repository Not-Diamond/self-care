# Self-Care

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-7C3AED)](https://docs.anthropic.com/en/docs/claude-code)

Agent trace analysis and context remediation plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

**Your AI agents fail in subtle ways** — they drift from goals, ignore context, skip steps, or hallucinate mid-task. These issues hide in traces and are hard to catch manually. Self-Care scans your agent traces, detects 14 types of common quality issues, and helps you fix them.

If you would like to run Self-Care continuously or share analyses across team members in your organization, you can sign up for early access to the hosted version [here](https://forms.gle/zFMKH14FXnXo4jeY8).

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

## Auto-Remediation

After running the pipeline, Self-Care can automatically fix auto-remediable cases by editing your project files — system prompts, tool descriptions, and context documents.

The remediation flow is two-phase:

1. **Preview** — Self-Care scans your codebase, locates the relevant files, and computes exact diffs for each auto-fixable case. You review the proposed changes before anything is modified.
2. **Apply** — Once you approve, the diffs are applied to your files.

After `/self-care:run` completes, the auto-remediable report (`.self-care/reports/<date>-<id>-auto-remediable.md`) contains each case with its proposed fix. The context-refiner agent reads these cases, finds the right files in your project, and generates minimal, targeted edits.

Example remediation for a **grounding** case:

```diff
# In prompts/agent.md
- You can process refunds within 30 days of purchase.
+ Retrieve the current return policy before quoting any deadlines.
+ Do not state specific timeframes unless confirmed by a retrieved document.
```

Remediation targets the root cause in your agent's configuration — not the trace itself.

## Continuous Monitoring

Self-Care can automatically poll your trace source and analyze new traces on a schedule using Claude Code's scheduled tasks:

```bash
/self-care:autosync-enable     # Set up recurring analysis
```

You'll be asked to choose a polling interval (e.g. every 10 minutes) and a sampling rate (e.g. 5% of new traces). Self-Care then runs in the background — fetching, analyzing, and generating reports without manual intervention.

```bash
/self-care:autosync-status     # Check current monitoring state
/self-care:autosync-disable    # Stop background monitoring
```

Reports from autosync are saved to `.self-care/reports/` just like manual runs, and a notification signal is written when new cases are found.

## Commands

| Command | Description |
|---------|-------------|
| `/self-care:run` | Fetch and analyze traces, generate report |
| `/self-care:validate <file>` | Validate trace file format (OTEL or Claude Code) |
| `/self-care:review [count]` | Review unreviewed reports and categorize findings |
| `/self-care:init` | Configure trace source (LangSmith or LangFuse) |
| `/self-care:autosync-enable` | Enable background monitoring on a schedule |
| `/self-care:autosync-disable` | Stop background monitoring |
| `/self-care:autosync-status` | Show current autosync state |
| `/self-care:config` | View or update configuration |
| `/self-care:context` | Describe your agent's expected behavior |
| `/self-care:help` | Show help and usage information |

## Configuration

Self-Care uses sensible defaults out of the box. All settings can be customized after init via `/self-care:config`.

Config is stored at `.self-care/config.json`.

### Disable / enable detection skills

```bash
/self-care:config disable step-repetition    # Disable a noisy skill
/self-care:config enable step-repetition     # Re-enable it
```

### Severity overrides

Override the default severity level for a skill's findings:

```bash
/self-care:config severity tool-failure low
/self-care:config severity tool-failure reset   # remove override
```

### Trace exclusions

Skip traces that match a pattern. Supports `*` and `?` wildcards.

```bash
/self-care:config exclude "trace_name:*health*"
/self-care:config exclude "service_name:monitoring-*"
/self-care:config exclude "attribute:environment=staging"
/self-care:config include "trace_name:*health*"            # remove exclusion
```

### Auto-fix behavior

Control how Self-Care handles auto-fixable findings:

```bash
/self-care:config autofix prompt    # Ask before each fix (default)
/self-care:config autofix auto      # Apply fixes without prompting
/self-care:config autofix disabled  # Report only, never apply fixes
```

### Agent context

Describe your agent's expected behavior so Self-Care can distinguish intentional patterns from problems:

```bash
/self-care:context           # Edit agent context
/self-care:context show      # View current context
/self-care:context reset     # Reset to default template
```

### Reset to defaults

```bash
/self-care:config reset
```

### Example config

```json
{
  "source": "langsmith",
  "langsmith": {
    "project": "my-agent-prod"
  },
  "analytics": {
    "enabled": true,
    "consentTimestamp": "2026-04-07T00:00:00Z"
  },
  "analysis": {
    "disabledSkills": ["step-repetition", "ambiguous-instructions"],
    "severityOverrides": {
      "tool-failure": "low"
    },
    "exclusions": [
      { "type": "trace_name", "pattern": "*health*" },
      { "type": "attribute", "key": "environment", "pattern": "staging" }
    ],
    "autoFix": "prompt"
  },
  "initialized_at": "2026-04-07T00:00:00Z"
}
```

Fields like `initialized_at` and `anonymous_id` are managed automatically by `/self-care:init`.

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
