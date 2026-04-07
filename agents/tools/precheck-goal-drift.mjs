#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/precheck-goal-drift.ts
import { readFileSync } from "node:fs";
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "can",
  "could",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "they",
  "them",
  "their",
  "he",
  "she",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "where",
  "when",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "don",
  "now",
  "also",
  "but",
  "and",
  "or",
  "if",
  "then",
  "else",
  "for",
  "with",
  "about",
  "against",
  "between",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "once",
  "here",
  "there",
  "any",
  "of",
  "at",
  "by",
  "as",
  "into",
  "like",
  "need",
  "want",
  "please",
  "help",
  "let",
  "make",
  "sure",
  "know",
  "think",
  "use",
  "get",
  "take",
  "look",
  "see",
  "go",
  "come",
  "try",
  "give",
  "tell",
  "say",
  "thing",
  "things",
  "way",
  "something",
  "anything",
  "nothing",
  "everything",
  "much",
  "many",
  "well",
  "still",
  "right",
  "even",
  "new",
  "first",
  "last",
  "one",
  "two",
  "three"
]);
var SCOPE_CHANGE_PATTERNS = [
  /\byes,?\s+(do\s+that|that\s+instead|go\s+ahead|switch|change)\b/i,
  /\blet'?s\s+(focus\s+on|switch\s+to|do|change\s+to|pivot)\b/i,
  /\bactually,?\s+(let'?s|can\s+you|instead)\b/i,
  /\binstead,?\s+(can\s+you|let'?s|do|please)\b/i,
  /\bforget\s+(about\s+)?(that|the\s+previous)\b/i,
  /\bnew\s+plan\b/i,
  /\bchange\s+of\s+plan\b/i,
  /\bscratch\s+that\b/i
];
function extractKeywords(text) {
  if (!text) return [];
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s_.-]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  return unique;
}
function computeOverlap(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return 0;
  const bSet = new Set(setB);
  let matches = 0;
  for (const word of setA) {
    if (bSet.has(word)) matches++;
  }
  const aSet = new Set(setA);
  const unionSize = (/* @__PURE__ */ new Set([...aSet, ...bSet])).size;
  return unionSize > 0 ? matches / unionSize : 0;
}
function extractToolTopics(turns) {
  const topics = [];
  for (const t of turns) {
    if (t.role !== "tool_use") continue;
    const arg = t.toolArg ?? "";
    if (!arg) continue;
    const segments = arg.replace(/[/\\]/g, " ").replace(/\.[a-z]{1,5}$/i, "").split(/[\s._-]+/).filter((s) => s.length >= 3 && !STOP_WORDS.has(s.toLowerCase())).map((s) => s.toLowerCase());
    if (segments.length > 0) {
      topics.push({ line: t.lineNumber, topic: segments.join(" ") });
    }
  }
  return topics;
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
      const argMatch = extractToolArgNearby(lines, i);
      turns.push({
        role: "tool_use",
        lineNumber: i + 1,
        content: "",
        toolName: nameMatch?.[1] ?? "",
        toolArg: argMatch
      });
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
function extractToolArgNearby(lines, startIdx) {
  const limit = Math.min(startIdx + 15, lines.length);
  for (let i = startIdx; i < limit; i++) {
    const m = lines[i].match(
      /"(?:tool\.result|file_path|path|pattern|command)"\s*:\s*"((?:[^"\\]|\\.)*)"/
    );
    if (m) return m[1];
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
      const arg = extractToolArgFromInput(obj);
      turns.push({
        role: "tool_use",
        lineNumber: i + 1,
        content: "",
        toolName,
        toolArg: arg
      });
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
function extractToolArgFromInput(obj) {
  const tool = obj.tool;
  const input = tool?.input ?? obj.input;
  if (!input) return "";
  return input.file_path ?? input.path ?? input.pattern ?? input.command ?? "";
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
  const assistantTurns = turns.filter(
    (t) => t.role === "assistant" && t.content.trim().length > 10
  );
  const substantiveCount = assistantTurns.length;
  const meetsMinimum = substantiveCount >= 3;
  if (!meetsMinimum) {
    signals.push({
      type: "insufficient_assistant_messages",
      confidence: "high",
      line: 0,
      detail: `Only ${substantiveCount} substantive assistant messages (need >= 3)`
    });
  }
  const userTurns = turns.filter((t) => t.role === "user" && t.content.trim().length > 0);
  const firstUser = userTurns.length > 0 ? userTurns[0] : null;
  const initialKeywords = firstUser ? extractKeywords(firstUser.content) : [];
  const lastAssistant = assistantTurns.length > 0 ? assistantTurns[assistantTurns.length - 1] : null;
  const finalKeywords = lastAssistant ? extractKeywords(lastAssistant.content) : [];
  const overlapRatio = computeOverlap(initialKeywords, finalKeywords);
  if (meetsMinimum && overlapRatio < 0.05 && initialKeywords.length >= 3 && finalKeywords.length >= 3) {
    signals.push({
      type: "low_keyword_overlap",
      confidence: "high",
      line: lastAssistant?.lineNumber ?? 0,
      detail: `Keyword overlap between initial goal and final response is ${(overlapRatio * 100).toFixed(1)}% \u2014 initial: [${initialKeywords.slice(0, 8).join(", ")}] vs final: [${finalKeywords.slice(0, 8).join(", ")}]`
    });
  } else if (meetsMinimum && overlapRatio < 0.15 && initialKeywords.length >= 3 && finalKeywords.length >= 3) {
    signals.push({
      type: "low_keyword_overlap",
      confidence: "medium",
      line: lastAssistant?.lineNumber ?? 0,
      detail: `Low keyword overlap (${(overlapRatio * 100).toFixed(1)}%) between initial goal and final response \u2014 initial: [${initialKeywords.slice(0, 8).join(", ")}] vs final: [${finalKeywords.slice(0, 8).join(", ")}]`
    });
  }
  let scopeChangeDetected = false;
  for (const ut of userTurns) {
    if (ut === firstUser) continue;
    for (const pat of SCOPE_CHANGE_PATTERNS) {
      if (pat.test(ut.content)) {
        scopeChangeDetected = true;
        signals.push({
          type: "scope_change_detected",
          confidence: "high",
          line: ut.lineNumber,
          detail: `User-approved scope change: "${ut.content.slice(0, 100)}"`
        });
        break;
      }
    }
  }
  const toolTopics = extractToolTopics(turns);
  if (toolTopics.length >= 4 && initialKeywords.length >= 3) {
    const initialSet = new Set(initialKeywords);
    const midpoint = Math.floor(toolTopics.length / 2);
    const firstHalfTopics = toolTopics.slice(0, midpoint);
    const secondHalfTopics = toolTopics.slice(midpoint);
    const firstHalfRelevance = computeTopicRelevance(firstHalfTopics, initialSet);
    const secondHalfRelevance = computeTopicRelevance(secondHalfTopics, initialSet);
    if (firstHalfRelevance > 0.3 && secondHalfRelevance < 0.1 && firstHalfRelevance - secondHalfRelevance > 0.2) {
      signals.push({
        type: "tool_topic_shift",
        confidence: "medium",
        line: secondHalfTopics[0]?.line ?? 0,
        detail: `Tool usage topic relevance dropped from ${(firstHalfRelevance * 100).toFixed(0)}% to ${(secondHalfRelevance * 100).toFixed(0)}% in second half of trace`
      });
    }
  }
  return {
    skill: "goal-drift",
    precheck: true,
    signals,
    structural: {
      event_count: turns.length,
      substantive_assistant_count: substantiveCount,
      meets_minimum_evidence: meetsMinimum,
      initial_goal_keywords: initialKeywords.slice(0, 15),
      final_response_keywords: finalKeywords.slice(0, 15),
      keyword_overlap_ratio: Math.round(overlapRatio * 1e3) / 1e3,
      scope_change_detected: scopeChangeDetected
    }
  };
}
function computeTopicRelevance(topics, goalKeywords) {
  if (topics.length === 0) return 0;
  let matches = 0;
  for (const t of topics) {
    const words = t.topic.split(" ");
    if (words.some((w) => goalKeywords.has(w))) matches++;
  }
  return matches / topics.length;
}
var filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx precheck-goal-drift.ts <trace-file>");
  process.exit(1);
}
var result = analyze(filePath);
console.log(JSON.stringify(result, null, 2));
