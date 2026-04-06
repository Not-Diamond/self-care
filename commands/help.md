---
description: Display help information about Self-Care commands and skills
argument: ""
allowed-tools: []
---

# Self-Care Help

Display help information about Self-Care commands, available detection skills, and usage examples.

## Output

Display the following help text to the user:

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                              Self-Care — Help                                ║
╚══════════════════════════════════════════════════════════════════════════════╝

Self-Care is an agent-based trace analysis tool that validates agent execution
traces and detects quality issues using 14 specialized detection skills.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMANDS

  /self-care:init
    Initialize Self-Care for this project.

    Configures trace source (LangSmith, LangFuse, or local files),
    validates credentials, and sets up the .self-care/ directory.

    Required env vars (depending on source):
      LANGSMITH_API_KEY           For LangSmith
      LANGFUSE_PUBLIC_KEY         For LangFuse
      LANGFUSE_SECRET_KEY         For LangFuse


  /self-care:analyze <trace-file> [--hash <hash>] [--skip-validation]
    Validate and analyze a trace file for cases.

    Outputs: Detection results in JSON format. Results are persisted per
    trace file for tracking new vs. recurring issues.

    Options:
      --hash <hash>         Pre-computed trace hash (16-char hex string).
                            Skips re-hashing and uses for memory lookup.
      --skip-validation     Skip format validation. Auto-detects format directly.


  /self-care:run [trace-file] [details]
    Run the full Self-Care pipeline on a trace.

    If a trace file is provided, analyzes it directly.
    If no file is provided, connects to the configured trace source
    (from /self-care:init) and presents an interactive trace picker.

    Orchestrates 5 sequential stages:
      1. Validation       — Verify trace format (OTEL or Claude Code)
      2. Analysis         — Detect cases using skill agents
      3. Reporting        — Generate triage report
      4. Review & Apply   — Show proposed fixes for user approval
      5. Summary          — Display applied changes

    Supports both OTEL (JSON) and Claude Code (JSONL) formats.


  /self-care:autosync-enable
    Enable scheduled autosync for the configured remote trace source.

    Reuses .self-care/config.json, creates or updates
    .self-care/autosync.json, and schedules /self-care:autosync-tick.


  /self-care:autosync-disable
    Disable scheduled autosync and cancel the scheduled tick task.


  /self-care:autosync-status
    Show current autosync settings, pending traces, and last sync state.


  /self-care:autosync-tick
    Run one non-interactive autosync cycle.

    This is intended for Claude Code scheduled tasks and should not be run
    manually unless you want to force one background-style pass.


  /self-care:validate <trace-file>
    Validate a trace file and extract metadata.

    Detects trace format and reports:
      • For OTEL: trace ID, service name, span count, time range
      • For Claude Code: session ID, message count, event types, time range


  /self-care:help
    Display this help information.


  /self-care:config [analytics on|off]
    View or change Self-Care configuration settings.

    Subcommands:
      (no args)         Show current configuration
      analytics on      Enable anonymous usage analytics
      analytics off     Disable usage analytics

    Config is stored at: .self-care/config.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DETECTION SKILLS (14 case types)

Self-Care detects the following quality issues in agent execution traces:

  • ambiguous-instructions     — Unclear or conflicting instructions to agent
  • context-utilization        — Failure to use available context effectively
  • contradictory-instructions — Instructions that conflict with each other
  • goal-drift                  — Agent deviates from stated goal
  • grounding                   — Loss of reference to base context/facts
  • guardrail-violation         — Breach of safety constraints
  • instruction-following      — Failure to follow explicit instructions
  • missed-action              — Task or action not performed when required
  • missing-context            — Insufficient context for task execution
  • persona-adherence          — Agent deviates from expected persona/role
  • premature-termination      — Task ends before completion
  • reasoning-action-mismatch  — Reasoning doesn't match taken actions
  • step-repetition            — Repeated steps without progress
  • tool-failure               — Tool execution failure or misuse

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUICK START

  1. Set up a trace source:
     /self-care:init

  2. Enable background autosync:
     /self-care:autosync-enable

  3. Analyze a trace (interactive picker):
     /self-care:run

  4. Analyze a specific file:
     /self-care:run ./trace.json

  5. Check autosync status:
     /self-care:autosync-status

  6. Validate trace format:
     /self-care:validate ./trace.json


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TRACE FORMATS

Self-Care supports:
  • OTEL (OpenTelemetry)     — JSON traces with span-based analysis
  • Claude Code (JSONL)       — Message-based traces from Claude Code sessions

Both formats are auto-detected. Use /self-care:validate to check format.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For more information, visit the documentation at:
  https://github.com/notdiamond/self-care
```
