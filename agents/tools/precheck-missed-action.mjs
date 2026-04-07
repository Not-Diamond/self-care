#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/precheck-missed-action.ts
import { readFileSync } from "node:fs";
var ACTION_PATTERNS = [
  // File operations
  {
    pattern: /\b(save|write)\s+(the\s+)?(file|changes|code|content|data)/i,
    category: "file-write",
    expectedTools: ["Write", "Edit"]
  },
  {
    pattern: /\bcreate\s+(a\s+)?(new\s+)?(file|directory|folder)/i,
    category: "file-create",
    expectedTools: ["Write", "Bash"]
  },
  {
    pattern: /\bdelete\s+(the\s+)?(file|directory|folder)/i,
    category: "file-delete",
    expectedTools: ["Bash"]
  },
  // Git operations
  {
    pattern: /\bcommit\b/i,
    category: "git-commit",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\bpush\b(?!\s+back)/i,
    category: "git-push",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\bcreate\s+(a\s+)?(new\s+)?branch/i,
    category: "git-branch",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\bcreate\s+(a\s+)?(pull\s+request|PR)\b/i,
    category: "git-pr",
    expectedTools: ["Bash"]
  },
  // Communication
  {
    pattern: /\bsend\s+(an?\s+)?(email|message|notification)/i,
    category: "communication",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\bnotify\b/i,
    category: "communication",
    expectedTools: ["Bash"]
  },
  // Search
  {
    pattern: /\b(search|grep|find|look)\s+(for|in|through)/i,
    category: "search",
    expectedTools: ["Grep", "Glob", "Bash"]
  },
  // Execution
  {
    pattern: /\brun\s+(the\s+)?(tests?|test\s+suite|specs?)/i,
    category: "test-run",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\b(execute|run)\s+(the\s+)?(command|script|build|program)/i,
    category: "execute",
    expectedTools: ["Bash"]
  },
  {
    pattern: /\bbuild\b/i,
    category: "build",
    expectedTools: ["Bash"]
  },
  // Install
  {
    pattern: /\binstall\s+(the\s+)?(package|dependency|dependencies|module)/i,
    category: "install",
    expectedTools: ["Bash"]
  }
];
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
      if (nameMatch) {
        turns.push({
          role: "tool_use",
          lineNumber: i + 1,
          content: "",
          toolName: nameMatch[1]
        });
      }
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
      const content = extractContentText(obj);
      turns.push({ role: "user", lineNumber: i + 1, content });
    } else if (type === "assistant") {
      const content = extractContentText(obj);
      turns.push({ role: "assistant", lineNumber: i + 1, content });
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
  if (isOtelFormat(content)) {
    return extractTurnsOtel(content, lines);
  }
  return extractTurnsCCJsonl(lines);
}
function extractActions(text) {
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { pattern, category, expectedTools } of ACTION_PATTERNS) {
    const m = text.match(pattern);
    if (m && !seen.has(category)) {
      seen.add(category);
      matches.push({ verb: m[0], category, expectedTools });
    }
  }
  return matches;
}
function toolMatchesExpected(toolName, expectedTools, category) {
  const normalised = toolName.toLowerCase();
  for (const expected of expectedTools) {
    if (normalised.includes(expected.toLowerCase())) return true;
  }
  if (normalised === "bash" || normalised === "execute") {
    return true;
  }
  if ((category === "file-write" || category === "file-create") && (normalised === "edit" || normalised === "write")) {
    return true;
  }
  return false;
}
function analyze(filePath2) {
  const content = readFileSync(filePath2, "utf-8");
  const lines = content.split("\n");
  const turns = extractTurns(content, lines);
  const userMessages = turns.filter((t) => t.role === "user");
  const toolCalls = turns.filter((t) => t.role === "tool_use");
  const totalEvents = turns.length;
  const structural = {
    event_count: totalEvents,
    user_message_count: userMessages.length,
    tool_call_count: toolCalls.length,
    meets_minimum_evidence: totalEvents >= 4
  };
  const signals = [];
  if (!structural.meets_minimum_evidence) {
    return { skill: "missed-action", precheck: true, signals, structural };
  }
  for (let idx = 0; idx < userMessages.length; idx++) {
    const userTurn = userMessages[idx];
    const actions = extractActions(userTurn.content);
    if (actions.length === 0) continue;
    const isFirst = idx === 0;
    if (isFirst && actions.length === 1) continue;
    const nextUserLine = idx + 1 < userMessages.length ? userMessages[idx + 1].lineNumber : Infinity;
    const toolsBetween = turns.filter(
      (t) => t.role === "tool_use" && t.lineNumber > userTurn.lineNumber && t.lineNumber < nextUserLine
    );
    const toolNamesBetween = toolsBetween.map((t) => t.toolName ?? "");
    for (const action of actions) {
      const matched = toolsBetween.some(
        (t) => toolMatchesExpected(
          t.toolName ?? "",
          action.expectedTools,
          action.category
        )
      );
      if (!matched) {
        const confidence = toolsBetween.length === 0 ? "high" : "medium";
        signals.push({
          type: "unmatched_action_request",
          confidence,
          line: userTurn.lineNumber,
          user_text: userTurn.content.slice(0, 200),
          action_verb: action.verb,
          action_category: action.category,
          expected_tools: action.expectedTools,
          actual_tools_before_next_user: toolNamesBetween,
          is_first_user_message: isFirst,
          action_count_in_message: actions.length
        });
      }
    }
  }
  return { skill: "missed-action", precheck: true, signals, structural };
}
var filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npx tsx precheck-missed-action.ts <trace-file>"
  );
  process.exit(1);
}
var result = analyze(filePath);
console.log(JSON.stringify(result, null, 2));
