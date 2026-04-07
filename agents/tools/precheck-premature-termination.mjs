#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/precheck-premature-termination.ts
import { readFileSync } from "node:fs";
var GIVE_UP_PATTERNS = [
  { pattern: /I'll stop here/i, label: "I'll stop here" },
  { pattern: /I wasn't able to finish/i, label: "I wasn't able to finish" },
  {
    pattern: /you'll need to manually/i,
    label: "you'll need to manually"
  },
  { pattern: /beyond my ability/i, label: "beyond my ability" },
  { pattern: /I'll leave the rest/i, label: "I'll leave the rest" },
  { pattern: /I can't finish/i, label: "I can't finish" },
  { pattern: /due to limitations/i, label: "due to limitations" },
  {
    pattern: /I'm unable to complete/i,
    label: "I'm unable to complete"
  },
  { pattern: /I cannot complete/i, label: "I cannot complete" },
  {
    pattern: /unfortunately.*(?:cannot|can't|unable)/i,
    label: "unable/cannot"
  },
  {
    pattern: /I've done .{3,40} but not .{3,40} yet/i,
    label: "partial completion acknowledged"
  },
  {
    pattern: /I wasn't able to/i,
    label: "I wasn't able to"
  }
];
var USER_STOP_PATTERNS = [
  /\b(stop|cancel|abort|never\s*mind|that'?s\s+enough)\b/i,
  /\bdon'?t\s+(bother|worry|continue)\b/i,
  /\bforget\s+(it|about\s+it)\b/i
];
var PLAN_STEP_PATTERN = /^\s*(?:\d+[\.\)]\s+|[-*]\s+(?:Step\s+\d+|First|Second|Third|Then|Next|Finally))/gim;
var INLINE_PLAN_PATTERN = /(?:first|1st).+(?:then|next|second|2nd).+/i;
function detectTruncation(text) {
  if (!text || text.length < 10) return null;
  const trimmed = text.trimEnd();
  if (/\w$/.test(trimmed) && trimmed.length > 50) {
    const lastSentence = trimmed.split(/[.!?]\s+/).pop() ?? "";
    if (lastSentence.length > 80) {
      return "ends mid-sentence";
    }
  }
  const codeBlockOpens = (trimmed.match(/```/g) ?? []).length;
  if (codeBlockOpens % 2 !== 0) {
    return "unclosed code block";
  }
  const openBraces = (trimmed.match(/\{/g) ?? []).length;
  const closeBraces = (trimmed.match(/\}/g) ?? []).length;
  if (openBraces > closeBraces + 2) {
    return "unclosed braces";
  }
  const openBrackets = (trimmed.match(/\[/g) ?? []).length;
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length;
  if (openBrackets > closeBrackets + 2) {
    return "unclosed brackets";
  }
  if (/\.{3}\s*$/.test(trimmed) && !/etc\.{3}/.test(trimmed)) {
    return "ends with ellipsis";
  }
  return null;
}
function countPlanSteps(text) {
  const matches = text.match(PLAN_STEP_PATTERN);
  if (matches && matches.length >= 2) return matches.length;
  if (INLINE_PLAN_PATTERN.test(text)) {
    const parts = text.split(/,\s*(?:and\s+)?(?:then\s+)?|;\s*(?:then\s+)?|\.\s+(?:Then|Next)\s+/i);
    if (parts.length >= 2) return parts.length;
  }
  return 0;
}
function isOtelFormat(content) {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") && /\"resourceSpans\"/.test(trimmed.slice(0, 500));
}
function extractTurnsOtel(content, lines) {
  const turns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/"gen_ai\.user\.message"/.test(line)) {
      const text = extractNearbyContent(lines, i, "gen_ai.user.message.content");
      turns.push({ role: "user", lineNumber: i + 1, content: text });
    } else if (/"gen_ai\.assistant\.message"/.test(line)) {
      const text = extractNearbyContent(lines, i, "gen_ai.assistant.message.content");
      turns.push({ role: "assistant", lineNumber: i + 1, content: text });
    } else if (/"tool\.call\./.test(line)) {
      const nameMatch = line.match(/"tool\.call\.([^"]+)"/);
      turns.push({
        role: "tool_use",
        lineNumber: i + 1,
        content: "",
        toolName: nameMatch?.[1] ?? ""
      });
    } else if (/"tool\.result"/.test(line) || /"tool_result"/.test(line)) {
      turns.push({ role: "tool_result", lineNumber: i + 1, content: "" });
    }
  }
  if (!turns.some((t) => t.role === "user" || t.role === "assistant")) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/"llm\.user_input"|"llm\.prompt"|"llm\.input"/.test(line)) {
        const text = extractNearbyStringValue(lines, i);
        if (text) turns.push({ role: "user", lineNumber: i + 1, content: text });
      } else if (/"llm\.response"|"llm\.output"|"llm\.completion"/.test(line)) {
        const text = extractNearbyStringValue(lines, i);
        if (text) turns.push({ role: "assistant", lineNumber: i + 1, content: text });
      }
    }
  }
  return turns;
}
function extractNearbyContent(lines, startIdx, contentKey) {
  const limit = Math.min(startIdx + 20, lines.length);
  const keyPattern = new RegExp(`"${contentKey.replace(/\./g, "\\.")}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  for (let i = startIdx; i < limit; i++) {
    const m = lines[i].match(keyPattern);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  for (let i = startIdx; i < limit; i++) {
    const m = lines[i].match(/"stringValue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  return "";
}
function extractNearbyStringValue(lines, startIdx) {
  const limit = Math.min(startIdx + 5, lines.length);
  for (let i = startIdx; i < limit; i++) {
    const m = lines[i].match(/"stringValue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  return "";
}
function extractTurnsCCJsonl(lines) {
  const turns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const type = obj.type;
    if (type === "user") {
      turns.push({
        role: "user",
        lineNumber: i + 1,
        content: extractContentText(obj)
      });
    } else if (type === "assistant") {
      turns.push({
        role: "assistant",
        lineNumber: i + 1,
        content: extractContentText(obj)
      });
    } else if (type === "tool_use") {
      const tool = obj.tool;
      const toolName = tool?.name ?? obj.name ?? "";
      turns.push({
        role: "tool_use",
        lineNumber: i + 1,
        content: "",
        toolName
      });
    } else if (type === "tool_result") {
      turns.push({ role: "tool_result", lineNumber: i + 1, content: "" });
    }
  }
  return turns;
}
function extractContentText(obj) {
  const msg = obj.message;
  if (msg) {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.filter(
        (c) => c && typeof c === "object" && c.type === "text"
      ).map((c) => c.text ?? "").join("\n");
    }
  }
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.content)) {
    return obj.content.filter(
      (c) => c && typeof c === "object" && c.type === "text"
    ).map((c) => c.text ?? "").join("\n");
  }
  return "";
}
function extractTurns(content, lines) {
  if (isOtelFormat(content)) return extractTurnsOtel(content, lines);
  return extractTurnsCCJsonl(lines);
}
function analyze(filePath2) {
  const content = readFileSync(filePath2, "utf-8");
  const lines = content.split("\n");
  const turns = extractTurns(content, lines);
  const signals = [];
  const eventCount = turns.length;
  const meetsMinimum = eventCount >= 4;
  const finalTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const finalRole = finalTurn?.role ?? "none";
  const finalLine = finalTurn?.lineNumber ?? 0;
  const assistantTurns = turns.filter((t) => t.role === "assistant");
  const lastAssistant = assistantTurns.length > 0 ? assistantTurns[assistantTurns.length - 1] : null;
  const userTurns = turns.filter((t) => t.role === "user");
  let hasUserStop = false;
  for (const ut of userTurns) {
    for (const pat of USER_STOP_PATTERNS) {
      if (pat.test(ut.content)) {
        hasUserStop = true;
        signals.push({
          type: "user_initiated_stop",
          confidence: "high",
          line: ut.lineNumber,
          detail: `User stop detected: "${ut.content.slice(0, 100)}"`
        });
        break;
      }
    }
  }
  let hasGiveUp = false;
  if (lastAssistant) {
    for (const { pattern, label } of GIVE_UP_PATTERNS) {
      if (pattern.test(lastAssistant.content)) {
        hasGiveUp = true;
        signals.push({
          type: "give_up_language",
          confidence: "high",
          line: lastAssistant.lineNumber,
          detail: `Give-up pattern: "${label}"`
        });
        break;
      }
    }
  }
  let hasTruncation = false;
  if (lastAssistant) {
    const truncDetail = detectTruncation(lastAssistant.content);
    if (truncDetail) {
      hasTruncation = true;
      signals.push({
        type: "truncated_output",
        confidence: "high",
        line: lastAssistant.lineNumber,
        detail: `Truncation detected: ${truncDetail}`
      });
    }
  }
  if (finalTurn && (finalTurn.role === "tool_result" || finalTurn.role === "tool_use") && !turns.some(
    (t) => t.role === "assistant" && t.lineNumber > finalTurn.lineNumber
  )) {
    signals.push({
      type: "final_event_is_tool_result",
      confidence: "high",
      line: finalLine,
      detail: `Final event is ${finalRole} at line ${finalLine} with no subsequent assistant message`
    });
  }
  const toolResultTurns = turns.filter((t) => t.role === "tool_result");
  if (toolResultTurns.length > 0) {
    const lastToolResult = toolResultTurns[toolResultTurns.length - 1];
    const nearbyLines = lines.slice(
      Math.max(0, lastToolResult.lineNumber - 1),
      Math.min(lines.length, lastToolResult.lineNumber + 5)
    );
    const hasError = nearbyLines.some(
      (l) => /"is_error"\s*:\s*true/i.test(l) || /error|Error|ERROR/.test(l)
    );
    if (hasError) {
      const followingActions = turns.filter(
        (t) => t.lineNumber > lastToolResult.lineNumber && (t.role === "tool_use" || t.role === "assistant")
      );
      if (followingActions.length === 0) {
        signals.push({
          type: "abandoned_after_error",
          confidence: "high",
          line: lastToolResult.lineNumber,
          detail: "Agent stopped after tool error with no recovery attempt"
        });
      }
    }
  }
  let planStepsStated = 0;
  let toolCallsAfterPlan = 0;
  for (const at of assistantTurns) {
    const steps = countPlanSteps(at.content);
    if (steps >= 2) {
      planStepsStated = steps;
      toolCallsAfterPlan = turns.filter(
        (t) => t.role === "tool_use" && t.lineNumber > at.lineNumber
      ).length;
      if (toolCallsAfterPlan < planStepsStated) {
        signals.push({
          type: "incomplete_plan",
          confidence: toolCallsAfterPlan < planStepsStated * 0.5 ? "high" : "medium",
          line: at.lineNumber,
          detail: `Plan stated ${planStepsStated} steps but only ${toolCallsAfterPlan} tool calls followed`
        });
      }
      break;
    }
  }
  return {
    skill: "premature-termination",
    precheck: true,
    signals,
    structural: {
      event_count: eventCount,
      meets_minimum_evidence: meetsMinimum,
      final_event_role: finalRole,
      final_event_line: finalLine,
      has_user_stop: hasUserStop,
      has_give_up_language: hasGiveUp,
      has_truncation: hasTruncation,
      plan_steps_stated: planStepsStated,
      tool_calls_after_plan: toolCallsAfterPlan
    }
  };
}
var filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npx tsx precheck-premature-termination.ts <trace-file>"
  );
  process.exit(1);
}
var result = analyze(filePath);
console.log(JSON.stringify(result, null, 2));
