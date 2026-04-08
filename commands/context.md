---
description: View or edit agent context for Self-Care analysis
argument: "[show|reset]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Self-Care Context

View or edit the agent context file that helps Self-Care understand your agent's expected behavior.

## Context File Location

Agent context is stored in: `.self-care/context.md`

This free-form description is provided to all analysis skills to help them understand what's normal vs problematic for your specific agent.

## Instructions

### Parse Arguments

Extract the subcommand from `$ARGUMENTS`:

- If empty or whitespace-only: **prompt for new context**
- If `show`: **display current context**
- If `reset`: **reset to default template**
- Otherwise: **show usage help**

---

### Prompt for New Context (no arguments)

1. **Ensure the config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

2. **Read current context** at `.self-care/context.md` if it exists.

3. **Display current context** (or note if empty/missing):
   ```
   Current Agent Context
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   <current content, or "No context configured yet.">

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

4. **Ask user for new context** using AskUserQuestion:
   - **question**: "Describe your agent's expected behavior. This helps Self-Care understand what's normal vs problematic. Include details like: what the agent does, expected tool usage patterns, intentional deviations from typical behavior."
   - **header**: "Agent Context"
   - **options**:
     - `{ "label": "Keep current", "description": "Don't change the agent context" }`
     - `{ "label": "Clear context", "description": "Remove the agent context file" }`

5. **Handle response**:
   - If user selects "Keep current": stop, no changes.
   - If user selects "Clear context": delete the file and confirm:
     ```bash
     rm -f .self-care/context.md
     ```
     Then display: `Agent context cleared.`
   - If user provides free text (via "Other"): continue to step 6.

6. **Write the new context** using the Write tool:
   ```markdown
   # Agent Context

   <user's description>
   ```

7. **Confirm**:
   ```
   Agent context updated.
   ```

---

### Show Current Context

Command: `/self-care:context show`

1. **Read context file** at `.self-care/context.md`.

2. **If file exists**, display:
   ```
   Agent Context
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   <file contents>

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   To edit: /self-care:context
   To reset: /self-care:context reset
   ```

3. **If file does not exist**, display:
   ```
   No agent context configured.

   To add context: /self-care:context
   ```

---

### Reset to Default Template

Command: `/self-care:context reset`

1. **Ensure the config directory exists**:
   ```bash
   mkdir -p .self-care/
   ```

2. **Write the default template** to `.self-care/context.md`:
   ```markdown
   # Agent Context

   <!--
   Describe your agent's expected behavior here.
   This context is provided to all analysis skills to help them
   understand what's normal vs problematic for your specific agent.

   Example:
   This is a customer service chatbot for an e-commerce platform.
   It handles order status, returns, and general inquiries.
   The agent is expected to escalate billing disputes to humans.
   It may skip personalized greetings for high-volume periods.
   -->
   ```

3. **Confirm**:
   ```
   Agent context reset to default template.
   Edit .self-care/context.md to add your agent description.
   ```

---

### Usage Help (invalid arguments)

If `$ARGUMENTS` doesn't match any known pattern, display:

```
Usage: /self-care:context [show|reset]

Subcommands:
  (no args)    Prompt to edit agent context
  show         Display current agent context
  reset        Reset to default template

The agent context helps Self-Care understand your agent's expected
behavior, so it can distinguish intentional patterns from problems.

Examples:
  /self-care:context         Edit the agent context
  /self-care:context show    View current context
  /self-care:context reset   Start fresh with template
```
