---
description: Initialize Self-Care — configure trace source and credentials
argument: ""
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Glob
  - Grep
---

# Self-Care Init

Set up Self-Care for this project. Configures the trace source (LangSmith or LangFuse), validates credentials, and creates the local directory structure.

## Step 1: Determine Config Path

The config lives in the project-local `.self-care/` directory:

```
CONFIG_PATH=".self-care/config.json"
```

Store `CONFIG_PATH` for use throughout.

## Step 2: Check Existing Config

Read `$CONFIG_PATH`. If the file exists and contains valid JSON:

Output the current configuration:
```
Self-Care is already configured:
  Source: <source>
  Project: <project name if applicable>
  Initialized: <initialized_at>
```

Then ask via AskUserQuestion:
```
Would you like to reconfigure? (yes/no)
```

If "no": stop here. If "yes" or if no config exists: continue.

## Step 3: Choose Trace Source

Ask via AskUserQuestion:
```
Where are your agent traces?

1. LangSmith
2. LangFuse
```

Store the choice as `source`.

## Step 4: Validate Credentials

### If source = LangSmith:

Check that `LANGSMITH_API_KEY` is set:
```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/check-env.sh" LANGSMITH_API_KEY
```

If the output shows `LANGSMITH_API_KEY=unset`, output the following and **stop**:
```
✗ LANGSMITH_API_KEY not set.
  Add it to your .env file or export it in your shell:
  export LANGSMITH_API_KEY=lsv2_pt_...
```

If set, fetch available projects (source `.env` again since each Bash call is a fresh shell):
```bash
if [ -f .env ]; then set -a && source .env && set +a; fi
node "${CLAUDE_PLUGIN_ROOT}/lib/validate-creds.mjs" --source langsmith --list-projects
```

Parse the JSON output. The response contains `{ projects: [{ name, run_count }] }`.

If the command exits non-zero, output the stderr message and **stop**.

If projects were fetched successfully, present them via AskUserQuestion as a numbered list:
```
Select your LangSmith project:

1. <project_name> (<run_count> traces)
2. <project_name> (<run_count> traces)
...
```

Include all fetched projects as numbered options. The user selects one.

Store the selected project name as `project_name`. Then validate:
```bash
if [ -f .env ]; then set -a && source .env && set +a; fi
node "${CLAUDE_PLUGIN_ROOT}/lib/validate-creds.mjs" --source langsmith --project "$project_name"
```

If the command exits non-zero, output the stderr message and **stop**.

If successful, parse the JSON output and note the `trace_count`.

### If source = LangFuse:

Check that `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` are set:
```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/check-env.sh" LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY LANGFUSE_BASE_URL
```

If any shows `=unset`, output:
```
✗ LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL must all be set.
  Add them to your .env file or export in your shell:
  export LANGFUSE_PUBLIC_KEY=pk-lf-...
  export LANGFUSE_SECRET_KEY=sk-lf-...
  export LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

And **stop**.

If set, read the actual value of `LANGFUSE_BASE_URL` from the shell — do NOT assume or hardcode a default:
```bash
if [ -f .env ]; then set -a && source .env && set +a; fi && echo "$LANGFUSE_BASE_URL"
```

Store the printed value exactly as `host`. Then validate:
```bash
if [ -f .env ]; then set -a && source .env && set +a; fi
node "${CLAUDE_PLUGIN_ROOT}/lib/validate-creds.mjs" --source langfuse --host "$host"
```

If the command exits non-zero, output the stderr message and **stop**.

## Step 5: Create Directory Structure

```bash
mkdir -p .self-care
```

## Step 6: Analytics Consent

Check if analytics consent has already been recorded in `$CONFIG_PATH`:

- **If the file exists** and contains valid JSON with `analytics.enabled` set to `true` or `false`: consent is already recorded. Skip to Step 7.
- **Otherwise**: prompt for consent.

**Prompt for consent** using **AskUserQuestion**:
- **question**: "Self-Care can collect anonymous usage analytics to help improve the tool. This includes: command usage frequency, case types detected (not trace content), and error rates. No trace data, file contents, or personally identifiable information is collected. Would you like to enable analytics?"
- **header**: "Analytics"
- **options**:
  - `{ "label": "Enable analytics", "description": "Help improve Self-Care with anonymous usage data" }`
  - `{ "label": "Disable analytics", "description": "Opt out of usage analytics" }`

If the user provides free text or any response other than "Enable analytics": treat as **disabled**.

Store the consent decision for inclusion in the config written in Step 7:
```json
"analytics": {
  "enabled": <true if "Enable analytics", false otherwise>,
  "consentTimestamp": "<current ISO timestamp>"
}
```

## Step 7: Write Config

**Before writing**, read the existing `$CONFIG_PATH` (if it exists) and preserve the `anonymous_id` field if present. This ensures the user's anonymous telemetry identity survives reconfiguration.

Write the config JSON to `$CONFIG_PATH`:

For LangSmith:
```json
{
  "source": "langsmith",
  "langsmith": {
    "project": "<project_name>"
  },
  "analytics": {
    "enabled": <from Step 6>,
    "consentTimestamp": "<from Step 6>"
  },
  "anonymous_id": "<preserved from existing config, or omit if not present>",
  "initialized_at": "<current ISO timestamp>"
}
```

For LangFuse:
```json
{
  "source": "langfuse",
  "langfuse": {
    "host": "<host>",
    "project_id": "<project_id from validation>"
  },
  "analytics": {
    "enabled": <from Step 6>,
    "consentTimestamp": "<from Step 6>"
  },
  "anonymous_id": "<preserved from existing config, or omit if not present>",
  "initialized_at": "<current ISO timestamp>"
}
```

Use the **Write** tool to write the config JSON to `$CONFIG_PATH`.

## Step 8: Output Summary

```
✓ Self-Care initialized
  Source: <source> (<project details if applicable>)
  Config: <CONFIG_PATH>

Run /self-care:run to analyze a trace.
Run /self-care:autosync-enable to turn on scheduled autosync.
```
