#!/usr/bin/env bash
# generate_report.sh — Formats a Self-Care triage report from structured JSON input.
#
# Usage: bash agents/skills/scripts/generate_report.sh <input.json>
#
# Input JSON schema:
# {
#   "format": "otel" | "claude-code",
#   "metadata": {
#     // OTEL: trace_id, service_name, span_count, time_range
#     // Claude Code: session_id, message_count, event_types[], time_range
#   },
#   "cases": [{
#     "type": string, "severity": "high"|"medium"|"low",
#     "description": string, "evidence": string,
#     "classification": "auto-fixable"|"manual-review", "proposedFix": string
#   }],
#   "remediationStatus": "pending" | "complete",
#   "remediationOutcomes": {           // only if complete
#     "applied":  [{ "eventN": int, "type": string, "severity": string, "file": string, "summary": string, "diff": string }],
#     "skipped":  [{ "eventN": int, "type": string, "severity": string, "proposedFix": string }],
#     "failed":   [{ "eventN": int, "type": string, "severity": string, "file": string, "reason": string }]
#   },
#   "agentContext": string,              // optional — user-provided agent behavior summary
#   "sourceUrl": string | null,          // optional — link to trace in LangSmith/LangFuse
#   "recommendations": [string]
# }
#
# Output: writes ./.self-care/reports/YYYY-MM-DD-<id>-triage.md, prints terminal summary to stdout.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: bash agents/skills/scripts/generate_report.sh <input.json>" >&2
  exit 1
fi

input_file="$1"
if [ ! -f "$input_file" ]; then
  echo "Error: input file not found: $input_file" >&2
  exit 1
fi

input=$(cat "$input_file")

# --- Parse top-level fields ---
format=$(echo "$input" | jq -r '.format')
remediation_status=$(echo "$input" | jq -r '.remediationStatus')
source_url=$(echo "$input" | jq -r '.sourceUrl // empty')
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
today=$(date -u +"%Y-%m-%d")

# --- Derive ID and output path ---
if [ "$format" = "otel" ]; then
  id=$(echo "$input" | jq -r '.metadata.trace_id')
else
  id=$(echo "$input" | jq -r '.metadata.session_id')
fi
short_id="${id:0:8}"
output_file="./.self-care/reports/${today}-${short_id}-triage.md"
mkdir -p ./.self-care/reports

# --- Counts ---
total_cases=$(echo "$input" | jq '.cases | length')
auto_fixable_count=$(echo "$input" | jq '[.cases[] | select(.classification == "auto-fixable")] | length')
escalated_count=$(echo "$input" | jq '[.cases[] | select(.classification == "manual-review")] | length')
high_count=$(echo "$input" | jq '[.cases[] | select(.severity == "high")] | length')
medium_count=$(echo "$input" | jq '[.cases[] | select(.severity == "medium")] | length')
low_count=$(echo "$input" | jq '[.cases[] | select(.severity == "low")] | length')

if [ "$remediation_status" = "complete" ]; then
  remediated_count=$(echo "$input" | jq '(.remediationOutcomes.applied // []) | length')
  skipped_count=$(echo "$input" | jq '(.remediationOutcomes.skipped // []) | length')
else
  remediated_count=0
  skipped_count=0
fi

# --- Build report ---
{
  # YAML frontmatter
  echo "---"
  if [ "$format" = "otel" ]; then
    echo "format: otel"
    echo "trace_id: $(echo "$input" | jq -r '.metadata.trace_id | @json')"
    echo "service_name: $(echo "$input" | jq -r '.metadata.service_name | @json')"
    echo "span_count: $(echo "$input" | jq -r '.metadata.span_count')"
  else
    echo "format: claude-code"
    echo "session_id: $(echo "$input" | jq -r '.metadata.session_id | @json')"
    echo "message_count: $(echo "$input" | jq -r '.metadata.message_count')"
    echo "event_types:"
    echo "$input" | jq -r '.metadata.event_types[] | @json' | sed 's/^/  - /'
  fi
  echo "timestamp: $timestamp"
  if [ -n "$source_url" ]; then
    echo "source_url: \"$source_url\""
  fi
  echo "total_cases: $total_cases"
  echo "remediation_status: $remediation_status"
  echo "auto_fixable_count: $auto_fixable_count"
  echo "remediated_count: $remediated_count"
  echo "skipped_count: $skipped_count"
  echo "escalated_count: $escalated_count"
  echo "severity_breakdown:"
  echo "  high: $high_count"
  echo "  medium: $medium_count"
  echo "  low: $low_count"
  echo "---"
  echo ""

  # Heading
  echo "# Triage Report"
  echo ""

  # Agent Context (optional — only when user-provided details were supplied)
  agent_context=$(echo "$input" | jq -r '.agentContext // empty')
  if [ -n "$agent_context" ]; then
    echo "## Agent Context"
    echo ""
    echo "$agent_context"
    echo ""
  fi

  # Trace summary
  echo "## Trace Summary"
  echo ""
  time_range=$(echo "$input" | jq -r '.metadata.time_range // "N/A"')
  if [ "$format" = "otel" ]; then
    echo "- **Format**: OTEL"
    echo "- **Trace ID**: $(echo "$input" | jq -r '.metadata.trace_id')"
    echo "- **Service**: $(echo "$input" | jq -r '.metadata.service_name')"
    echo "- **Span Count**: $(echo "$input" | jq -r '.metadata.span_count')"
    echo "- **Time Range**: $time_range"
  else
    echo "- **Format**: Claude Code"
    echo "- **Session ID**: $(echo "$input" | jq -r '.metadata.session_id')"
    echo "- **Message Count**: $(echo "$input" | jq -r '.metadata.message_count')"
    event_types=$(echo "$input" | jq -r '.metadata.event_types | join(", ")')
    echo "- **Event Types**: $event_types"
    echo "- **Time Range**: $time_range"
  fi
  echo "- **Analysis Date**: $today"
  if [ -n "$source_url" ]; then
    echo "- **Source**: $source_url"
  fi
  echo ""

  # Cases
  echo "## Cases"
  echo ""
  echo "$input" | jq -c '.cases | to_entries[]' | while IFS= read -r entry; do
    n=$(echo "$entry" | jq -r '.key + 1')
    case_obj=$(echo "$entry" | jq -r '.value')
    type=$(echo "$case_obj" | jq -r '.type')
    severity=$(echo "$case_obj" | jq -r '.severity')
    description=$(echo "$case_obj" | jq -r '.description')
    evidence=$(echo "$case_obj" | jq -r '.evidence')
    classification=$(echo "$case_obj" | jq -r '.classification')
    proposed_fix=$(echo "$case_obj" | jq -r '.proposedFix')
    echo "### Event $n: $type ($severity)"
    echo ""
    echo "**Description**: $description"
    echo "**Evidence**: $evidence"
    echo "**Classification**: $classification"
    echo "**Proposed Fix**: $proposed_fix"
    echo ""
    echo "---"
    echo ""
  done

  # Remediations
  if [ "$remediation_status" = "pending" ]; then
    echo "## Proposed Remediations"
    echo ""
    echo "The following auto-fixable events are pending user review:"
    echo ""
    echo "$input" | jq -c '.cases | to_entries[] | select(.value.classification == "auto-fixable")' | while IFS= read -r entry; do
      n=$(echo "$entry" | jq -r '.key + 1')
      case_obj=$(echo "$entry" | jq -r '.value')
      type=$(echo "$case_obj" | jq -r '.type')
      severity=$(echo "$case_obj" | jq -r '.severity')
      proposed_fix=$(echo "$case_obj" | jq -r '.proposedFix')
      echo "### Event $n: $type ($severity)"
      echo "**Proposed Fix**: $proposed_fix"
      echo ""
    done
  else
    echo "## Remediation Outcomes"
    echo ""
    echo "### Applied Fixes"
    echo ""
    echo "$input" | jq -c '(.remediationOutcomes.applied // [])[]' | while IFS= read -r item; do
      n=$(echo "$item" | jq -r '.eventN')
      type=$(echo "$item" | jq -r '.type')
      severity=$(echo "$item" | jq -r '.severity')
      file=$(echo "$item" | jq -r '.file // "N/A"')
      summary=$(echo "$item" | jq -r '.summary')
      diff=$(echo "$item" | jq -r '.diff // ""')
      echo "- **Event $n** ($type, $severity): $summary"
      echo "  - File: $file"
      if [ -n "$diff" ]; then
        echo "  - Change:"
        echo '    ```diff'
        echo "$diff" | sed 's/^/    /'
        echo '    ```'
      fi
    done
    echo ""

    echo "### Skipped Fixes"
    echo ""
    echo "$input" | jq -c '(.remediationOutcomes.skipped // [])[]' | while IFS= read -r item; do
      n=$(echo "$item" | jq -r '.eventN')
      type=$(echo "$item" | jq -r '.type')
      severity=$(echo "$item" | jq -r '.severity')
      proposed_fix=$(echo "$item" | jq -r '.proposedFix')
      echo "- **Event $n** ($type, $severity): $proposed_fix"
    done
    echo ""

    echo "### Failed Fixes"
    echo ""
    echo "$input" | jq -c '(.remediationOutcomes.failed // [])[]' | while IFS= read -r item; do
      n=$(echo "$item" | jq -r '.eventN')
      type=$(echo "$item" | jq -r '.type')
      severity=$(echo "$item" | jq -r '.severity')
      file=$(echo "$item" | jq -r '.file // "N/A"')
      reason=$(echo "$item" | jq -r '.reason')
      echo "- **Event $n** ($type, $severity): $reason"
      echo "  - File: $file"
    done
    echo ""
  fi

  # Escalations
  echo "## Escalations"
  echo ""
  if [ "$escalated_count" -eq 0 ]; then
    echo "No escalations."
  else
    echo "$input" | jq -c '[.cases[] | select(.classification == "manual-review")] | to_entries[]' | while IFS= read -r entry; do
      n=$(echo "$entry" | jq -r '.key + 1')
      case_obj=$(echo "$entry" | jq -r '.value')
      type=$(echo "$case_obj" | jq -r '.type')
      severity=$(echo "$case_obj" | jq -r '.severity')
      description=$(echo "$case_obj" | jq -r '.description')
      proposed_fix=$(echo "$case_obj" | jq -r '.proposedFix')
      echo "### Escalation $n: $type ($severity)"
      echo ""
      echo "**Description**: $description"
      echo "**Reason**: Manual review required"
      echo "**Recommendation**: $proposed_fix"
      echo ""
    done
  fi
  echo ""

  # Recommendations
  echo "## Recommendations"
  echo ""
  rec_count=$(echo "$input" | jq '(.recommendations // []) | length')
  if [ "$rec_count" -gt 0 ]; then
    echo "$input" | jq -r '(.recommendations // [])[]' | while IFS= read -r rec; do
      echo "- $rec"
    done
  else
    echo "- Review flagged cases and apply recommended fixes where appropriate."
    echo "- Consider updating system prompts to address detected patterns."
  fi

} > "$output_file"

# --- Terminal summary ---
if [ "$format" = "otel" ]; then
  service=$(echo "$input" | jq -r '.metadata.service_name')
  echo "Trace: $service ($id)"
else
  msg_count=$(echo "$input" | jq -r '.metadata.message_count')
  echo "Session: $id"
  echo "Messages: $msg_count"
fi
if [ -n "$source_url" ]; then
  echo "Source: $source_url"
fi

if [ "$remediation_status" = "pending" ]; then
  echo "Cases: $total_cases ($auto_fixable_count auto-fixable, $escalated_count manual-review)"
  echo "Status: Pending user approval"
else
  echo "Cases: $total_cases"
  echo "Summary: $remediated_count applied, $skipped_count skipped, $escalated_count escalated"
fi

echo "Report saved to: $output_file"
