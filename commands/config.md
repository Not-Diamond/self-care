---
description: View or change Self-Care configuration settings
argument: "[analytics on|off]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Write
---

# Self-Care Config

View or modify Self-Care configuration settings.

## Config File Location

Settings are stored in the project-local config file: `.self-care/config.json`

## Instructions

### Parse Arguments

Extract the optional subcommand from `$ARGUMENTS`:

- If `$ARGUMENTS` is empty or whitespace-only: **show current config**
- If `$ARGUMENTS` is `analytics on`: **enable analytics**
- If `$ARGUMENTS` is `analytics off`: **disable analytics**
- Otherwise: show usage help

---

### Show Current Config (no arguments)

1. **Read the config file** at `.self-care/config.json` using the **Read** tool.

2. **If the file exists** and is valid JSON:

   Display the current settings:
   ```
   Self-Care Configuration
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Analytics: <enabled|disabled, or "not configured" if no analytics key>
   Consent recorded: <consentTimestamp or "not yet">

   Config file: .self-care/config.json

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   To change settings:
     /self-care:config analytics on    Enable analytics
     /self-care:config analytics off   Disable analytics
   ```

3. **If the file does not exist**:

   Display:
   ```
   Self-Care Configuration
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   No configuration file found.

   Analytics consent has not been recorded yet. You will be prompted
   on next use of /self-care:run.

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   To configure now:
     /self-care:config analytics on    Enable analytics
     /self-care:config analytics off   Disable analytics
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

5. **Write the merged config** using the **Write** tool:
   ```json
   {
     "...existing keys preserved...",
     "analytics": {
       "enabled": <true|false>,
       "consentTimestamp": "<timestamp>"
     }
   }
   ```

6. **Confirm the change**:
   ```
   Analytics <enabled|disabled>.
   ```

---

### Usage Help (invalid arguments)

If `$ARGUMENTS` doesn't match any known pattern, display:

```
Usage: /self-care:config [analytics on|off]

Commands:
  (no args)       Show current configuration
  analytics on    Enable anonymous usage analytics
  analytics off   Disable usage analytics

Examples:
  /self-care:config              View current settings
  /self-care:config analytics on Enable analytics
```
