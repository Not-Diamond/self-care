---
description: View or change Self-Care configuration settings
argument: "[subcommand]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Self-Care Config

View or modify Self-Care configuration settings.

## Config File Location

Settings are stored in the project-local config file: `.self-care/config.json`

## Valid Skill IDs

```
grounding, missed-action, instruction-following, context-utilization,
goal-drift, persona-adherence, reasoning-action-mismatch, step-repetition,
tool-failure, premature-termination, contradictory-instructions,
missing-context, ambiguous-instructions, guardrail-violation
```

## Instructions

### Parse Arguments

Extract the subcommand from `$ARGUMENTS`:

- If empty or whitespace-only: **show current config**
- If `analytics on` or `analytics off`: **toggle analytics**
- If `disable` (with or without a skill name): **disable a skill**
- If `enable` (with or without a skill name): **enable a skill**
- If `severity <skill> <level>`: **set severity override**
- If `severity <skill> reset`: **remove severity override**
- If `exclude <pattern>`: **add exclusion pattern**
- If `include <pattern>`: **remove exclusion pattern**
- If `autofix <value>`: **set auto-fix behavior**
- If `reset`: **reset analysis config to defaults**
- Otherwise: **show usage help**

---

### Show Current Config (no arguments)

1. **Read the config file** at `.self-care/config.json` using the **Read** tool.

2. **If the file exists** and is valid JSON:

   Display the current settings:
   ```
   Self-Care Configuration
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Analytics: <enabled|disabled, or "not configured" if no analytics key>

   Analysis Settings:
     Auto-fix: <auto|prompt|disabled>
     Disabled skills: <comma-separated list, or "none">
     Severity overrides: <skill: level pairs, or "none">
     Exclusions: <count> patterns

   Config file: .self-care/config.json

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   To change settings:
     /self-care:config analytics on|off
     /self-care:config disable [skill]
     /self-care:config enable [skill]
     /self-care:config severity <skill> high|medium|low
     /self-care:config exclude <pattern>
     /self-care:config autofix auto|prompt|disabled
   ```

3. **If the file does not exist**:

   Display:
   ```
   Self-Care Configuration
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   No configuration file found.
   Run /self-care:init to set up Self-Care.

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

---

### Enable/Disable Analytics

1. **Get the current UTC timestamp**:
   ```bash
   date -u +"%Y-%m-%dT%H:%M:%SZ"
   ```

2. **Read existing config** to preserve other settings:
   - Read `.self-care/config.json`
   - If valid JSON, use it as the base
   - Otherwise, start with an empty object

3. **Update the analytics setting** (merge into existing config):
   - `analytics on` → set `analytics.enabled` to `true`
   - `analytics off` → set `analytics.enabled` to `false`
   - Set `analytics.consentTimestamp` to the current timestamp

4. **Ensure the config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

5. **Write the merged config** using the **Write** tool.

6. **Confirm the change**:
   ```
   Analytics <enabled|disabled>.
   ```

---

### Disable Skill

Command: `/self-care:config disable [skill]`

1. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

2. **Read existing config** at `.self-care/config.json`.
   - If missing or invalid, start with empty `analysis` object.

3. **Determine which skill to disable**:

   - **If a skill name was provided** (e.g., `/self-care:config disable grounding`):
     - Validate the skill ID against the valid skill list above.
     - If invalid, display error and list valid skills.
     - Use this skill.

   - **If no skill name was provided** (just `/self-care:config disable`):
     - Build a list of currently **enabled** skills (all valid skills minus those already in `analysis.disabledSkills`).
     - If all skills are already disabled, display: `All skills are already disabled.` and stop.
     - Use a **two-step select** to pick a skill:

       **Step A — Pick a category.** Use **AskUserQuestion** (select) with these 4 categories.
       Only show categories that have at least one enabled skill.

       | Category | Skills |
       |----------|--------|
       | Accuracy | `grounding`, `missed-action`, `tool-failure`, `reasoning-action-mismatch` |
       | Behavior | `instruction-following`, `persona-adherence`, `goal-drift`, `guardrail-violation` |
       | Efficiency | `step-repetition`, `premature-termination`, `context-utilization` |
       | Input Quality | `contradictory-instructions`, `missing-context`, `ambiguous-instructions` |

       ```
       Which category of skill?
       ```

       **Step B — Pick a skill.** Use **AskUserQuestion** (select) showing only the enabled skills in the chosen category (max 4 per category).

       Skill descriptions for option labels:
       - `grounding` — Unsupported facts/claims
       - `missed-action` — Skipped expected tool calls
       - `tool-failure` — Failed to handle tool errors
       - `reasoning-action-mismatch` — Intent ≠ actions
       - `instruction-following` — Violated explicit instructions
       - `persona-adherence` — Broke role constraints
       - `goal-drift` — Strayed from objectives
       - `guardrail-violation` — Safety boundary breaches
       - `step-repetition` — Redundant repeated actions
       - `premature-termination` — Stopped before completing
       - `context-utilization` — Failed to use available context
       - `contradictory-instructions` — Conflicting instructions
       - `missing-context` — Insufficient context provided
       - `ambiguous-instructions` — Underspecified instructions

       ```
       Select a skill to disable:
       ```

4. **Add skill to `analysis.disabledSkills`** array (if not already present).

5. **Write the updated config**.

6. **Confirm**:
   ```
   Disabled skill: <skill>
   ```

---

### Enable Skill

Command: `/self-care:config enable [skill]`

1. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

2. **Read existing config** at `.self-care/config.json`.

3. **Determine which skill to enable**:

   - **If a skill name was provided** (e.g., `/self-care:config enable grounding`):
     - Validate the skill ID against the valid skill list above.
     - If invalid, display error and list valid skills.
     - If the skill is not in `analysis.disabledSkills`, display: `Skill already enabled: <skill>` and stop.
     - Use this skill.

   - **If no skill name was provided** (just `/self-care:config enable`):
     - Get the list of currently **disabled** skills from `analysis.disabledSkills`.
     - If no skills are disabled, display: `All skills are already enabled.` and stop.
     - **If 4 or fewer skills are disabled**: use a single **AskUserQuestion** (select) showing all disabled skills with their descriptions.
       ```
       Select a skill to re-enable:
       ```
     - **If more than 4 skills are disabled**: use the same **two-step category → skill select** as the disable command (see category table above), but only showing categories/skills that are currently disabled.

4. **Remove skill from `analysis.disabledSkills`** array.

5. **Write the updated config**.

6. **Confirm**:
   ```
   Enabled skill: <skill>
   ```

---

### Set Severity Override

Command: `/self-care:config severity <skill> <level>`

1. **Validate the skill ID** against the valid skill list.
   - If invalid, display error and list valid skills.

2. **Validate the severity level** (must be `high`, `medium`, or `low`).
   - If invalid, display error.

3. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

4. **Read existing config** at `.self-care/config.json`.

5. **Set `analysis.severityOverrides[skill]`** to the level.

6. **Write the updated config**.

7. **Confirm**:
   ```
   Severity override set: <skill> → <level>
   ```

---

### Remove Severity Override

Command: `/self-care:config severity <skill> reset`

1. **Validate the skill ID**.

2. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

3. **Read existing config** at `.self-care/config.json`.

4. **Remove the skill from `analysis.severityOverrides`** (if present).

5. **Write the updated config**.

6. **Confirm**:
   ```
   Severity override removed: <skill>
   ```

---

### Add Exclusion Pattern

Command: `/self-care:config exclude <pattern>`

Pattern formats:
- `trace_name:*health*` — Skip traces with "health" in name
- `service_name:monitoring-*` — Skip monitoring services
- `attribute:environment=staging` — Skip by attribute value

1. **Parse the pattern**:
   - Split on first `:` to get type and rest
   - For `attribute` type, split rest on `=` to get key and pattern
   - Validate type is one of: `trace_name`, `service_name`, `attribute`

2. **If pattern is invalid**, display error with examples.

3. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

4. **Read existing config** at `.self-care/config.json`.

5. **Check for duplicate**: if an exclusion with the same type, pattern, and key already exists, display: `Exclusion already exists: <pattern>` and stop.

6. **Add to `analysis.exclusions`** array:
   ```json
   { "type": "<type>", "pattern": "<pattern>", "key": "<key if attribute>" }
   ```

7. **Write the updated config**.

8. **Confirm**:
   ```
   Added exclusion: <pattern>
   ```

---

### Remove Exclusion Pattern

Command: `/self-care:config include <pattern>`

1. **Parse the pattern** (same as exclude).

2. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

3. **Read existing config** at `.self-care/config.json`.

4. **Find and remove matching exclusion** from `analysis.exclusions` array.
   - Match on type, pattern, and key (for attribute type).

5. **If not found**, display:
   ```
   Exclusion not found: <pattern>
   ```

6. **Write the updated config**.

7. **Confirm**:
   ```
   Removed exclusion: <pattern>
   ```

---

### Set Auto-Fix Behavior

Command: `/self-care:config autofix <value>`

Valid values: `auto`, `prompt`, `disabled`

1. **Validate the value**.
   - If invalid, display error with valid options.

2. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

3. **Read existing config** at `.self-care/config.json`.

4. **Set `analysis.autoFix`** to the value.

5. **Write the updated config**.

6. **Confirm**:
   ```
   Auto-fix behavior set to: <value>
   ```

---

### Reset Analysis Config

Command: `/self-care:config reset`

1. **Ensure config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

2. **Read existing config** at `.self-care/config.json`.

3. **Reset `analysis` to defaults**:
   ```json
   {
     "disabledSkills": [],
     "severityOverrides": {},
     "exclusions": [],
     "autoFix": "prompt"
   }
   ```

4. **Write the updated config** (preserving other fields like `source`, `analytics`).

5. **Confirm**:
   ```
   Analysis configuration reset to defaults.
   ```

---

### Usage Help (invalid arguments)

If `$ARGUMENTS` doesn't match any known pattern, display:

```
Usage: /self-care:config [subcommand]

Subcommands:
  (no args)                    Show current configuration
  analytics on|off             Enable/disable usage analytics
  disable [skill]              Disable a detection skill (shows select if no skill given)
  enable [skill]               Re-enable a detection skill (shows select if no skill given)
  severity <skill> <level>     Override severity (high|medium|low)
  severity <skill> reset       Remove severity override
  exclude <pattern>            Add trace exclusion pattern
  include <pattern>            Remove trace exclusion pattern
  autofix auto|prompt|disabled Set auto-fix behavior
  reset                        Reset analysis config to defaults

Exclusion pattern formats:
  trace_name:*health*          Skip traces with "health" in name
  service_name:monitoring-*    Skip monitoring services
  attribute:environment=staging Skip by attribute value

Examples:
  /self-care:config                          View current settings
  /self-care:config disable step-repetition  Disable a noisy skill
  /self-care:config severity tool-failure low Downgrade severity
  /self-care:config exclude "trace_name:*test*"
  /self-care:config autofix auto             Apply fixes without prompting
```
