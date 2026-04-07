#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/validate-trace.ts
import { readFileSync } from "node:fs";

// packages/core/src/shared/trace-validator.ts
function getAttr(attrs, key) {
  if (!attrs) return "";
  const attr = attrs.find((a) => a.key === key);
  return attr?.value?.stringValue ?? (attr?.value?.intValue != null ? String(attr.value.intValue) : "");
}
function flattenSpans(otel) {
  const spans = [];
  const resourceSpans = otel.resourceSpans ?? [];
  for (const rs of resourceSpans) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        spans.push(span);
      }
    }
  }
  return spans;
}
function detectFormat(content2) {
  if (typeof content2 === "object" && content2 !== null) {
    if ("resourceSpans" in content2 && Array.isArray(content2.resourceSpans)) {
      return "otel";
    }
  }
  if (Array.isArray(content2) && content2.length > 0) {
    const sample = content2.slice(0, 5);
    if (sample.some((entry) => typeof entry?.type === "string" && (entry.message || entry.tool || entry.result || entry.sessionId || entry.timestamp))) {
      return "claude-code";
    }
  }
  return "unknown";
}
function detectSystemPrompt(content2, format) {
  const text = JSON.stringify(content2);
  if (format === "otel") {
    const spans = flattenSpans(content2);
    for (const span of spans) {
      if (span.name === "system-prompt" || getAttr(span.attributes, "tool.name") === "system-prompt") {
        return { found: true, method: "system-prompt span (span name or tool.name)" };
      }
    }
  }
  if (format === "otel" && text.includes("llm.system_prompt")) {
    return { found: true, method: "llm.system_prompt span attribute" };
  }
  if (text.includes('"role":"system"') || text.includes('"role": "system"') || text.includes('\\"role\\":\\"system\\"') || text.includes('\\"role\\": \\"system\\"')) {
    return { found: true, method: "OpenAI messages (role: system)" };
  }
  if (text.includes('"instructions"')) {
    return { found: true, method: "OpenAI Responses API (instructions field)" };
  }
  if (text.includes('"type":"system"') || text.includes('"type": "system"') || text.includes('\\"type\\":\\"system\\"') || text.includes('\\"type\\": \\"system\\"')) {
    return { found: true, method: "LangChain messages (type: system)" };
  }
  const fallbacks = [
    ["base_instructions", "base_instructions (Codex format)"],
    ['"system_prompt"', "system_prompt field"],
    ['"systemPrompt"', "systemPrompt field"],
    ['"role":"developer"', "developer message"],
    ['"system_instruction"', "system_instruction field"]
  ];
  for (const [pattern, method] of fallbacks) {
    if (text.includes(pattern)) {
      return { found: true, method };
    }
  }
  return { found: false, method: null };
}
function extractServiceName(resourceSpans) {
  for (const rs of resourceSpans) {
    const attrs = rs?.resource?.attributes ?? [];
    const serviceName = attrs.find((a) => a.key === "service.name");
    const value = serviceName?.value?.stringValue;
    if (value && value !== "langsmith-import" && value !== "langfuse-import") return value;
  }
  return null;
}
function validateOtel(content2) {
  const resourceSpans = content2?.resourceSpans;
  if (!Array.isArray(resourceSpans) || resourceSpans.length === 0) {
    return {
      valid: false,
      format: "otel",
      errors: ["Missing resourceSpans \u2014 not a valid OTEL trace"],
      warnings: [],
      metadata: null
    };
  }
  const spans = flattenSpans(content2);
  if (spans.length === 0) {
    return {
      valid: false,
      format: "otel",
      errors: ["No spans found in trace"],
      warnings: [],
      metadata: null
    };
  }
  const traceId = spans[0]?.traceId;
  const serviceName = extractServiceName(resourceSpans);
  const systemPrompt = detectSystemPrompt(content2, "otel");
  const warnings = [];
  if (!systemPrompt.found) {
    warnings.push("No system prompt found \u2014 analysis may be limited");
  }
  return {
    valid: true,
    format: "otel",
    errors: [],
    warnings,
    metadata: {
      format: "otel",
      systemPromptDetected: systemPrompt.found,
      systemPromptMethod: systemPrompt.method,
      traceId,
      serviceName: serviceName ?? void 0,
      spanCount: spans.length
    }
  };
}
function validateClaudeCode(content2) {
  if (!Array.isArray(content2) || content2.length === 0) {
    return {
      valid: false,
      format: "claude-code",
      errors: ["Empty Claude Code trace"],
      warnings: [],
      metadata: null
    };
  }
  const invalidEvents = content2.filter((entry) => {
    return typeof entry?.type !== "string";
  });
  if (invalidEvents.length > 0) {
    return {
      valid: false,
      format: "claude-code",
      errors: ['Invalid Claude Code event structure \u2014 events must have a "type" field'],
      warnings: [],
      metadata: null
    };
  }
  const first = content2[0];
  const sessionId = first?.sessionId;
  const eventTypes = [...new Set(content2.map((e) => e.type))];
  const systemPrompt = detectSystemPrompt(content2, "claude-code");
  const warnings = [];
  if (!systemPrompt.found) {
    warnings.push("No system prompt found \u2014 analysis may be limited");
  }
  return {
    valid: true,
    format: "claude-code",
    errors: [],
    warnings,
    metadata: {
      format: "claude-code",
      systemPromptDetected: systemPrompt.found,
      systemPromptMethod: systemPrompt.method,
      sessionId,
      eventTypes
    }
  };
}
function validateTrace(content2) {
  const format = detectFormat(content2);
  switch (format) {
    case "otel":
      return validateOtel(content2);
    case "claude-code":
      return validateClaudeCode(content2);
    case "unknown":
    default:
      return {
        valid: false,
        format: "unknown",
        errors: ["Unknown trace format \u2014 expected OTEL or Claude Code"],
        warnings: [],
        metadata: null
      };
  }
}

// packages/self-care-plugin/agents/tools/validate-trace.ts
var traceFile = process.argv[2];
if (!traceFile) {
  console.error("Usage: npx tsx agents/tools/validate-trace.ts <trace-file>");
  process.exit(2);
}
var raw;
try {
  raw = readFileSync(traceFile, "utf-8");
} catch {
  const result2 = {
    valid: false,
    format: "unknown",
    errors: [`File not found: ${traceFile}`],
    warnings: [],
    metadata: null
  };
  console.log(JSON.stringify(result2, null, 2));
  process.exit(1);
}
var content;
try {
  content = JSON.parse(raw);
} catch {
  const lines = raw.split("\n").filter((l) => l.trim());
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
    }
  }
  if (parsed.length > 0) {
    content = parsed;
  } else {
    const result2 = {
      valid: false,
      format: "unknown",
      errors: ["File is not valid JSON or JSONL"],
      warnings: [],
      metadata: null
    };
    console.log(JSON.stringify(result2, null, 2));
    process.exit(1);
  }
}
var result = validateTrace(content);
if (result.valid && result.metadata && !result.metadata.systemPromptDetected) {
  result.valid = false;
  result.errors.push(
    "No system prompt found \u2014 Self-Care requires a system prompt in the trace to evaluate cases"
  );
  result.warnings = result.warnings.filter(
    (w) => !w.includes("No system prompt found")
  );
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
