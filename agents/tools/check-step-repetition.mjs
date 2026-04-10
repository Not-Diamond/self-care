#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/check-step-repetition.ts
import { readFileSync } from "node:fs";
function isOtelFormat(content) {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") && /\"resourceSpans\"/.test(trimmed.slice(0, 500));
}
function getAttr(span, key) {
  return span.attributes?.find((a) => a.key === key)?.value?.stringValue;
}
function extractOtelToolCalls(content) {
  const calls = [];
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return calls;
  }
  const lines = content.split("\n");
  const spanLineCache = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/"name"\s*:\s*"(tool\.call\.[^"]+)"/);
    if (m) {
      const key = `${m[1]}@${i}`;
      spanLineCache.set(key, i + 1);
    }
  }
  const toolCallLines = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/"name"\s*:\s*"(tool\.call\.[^"]+)"/);
    if (m) toolCallLines.push({ line: i + 1, spanName: m[1] });
  }
  let lineIdx = 0;
  for (const rs of parsed.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        if (!span.name.startsWith("tool.call.")) continue;
        const toolName = getAttr(span, "tool.name") ?? span.name.replace("tool.call.", "");
        const toolResult = getAttr(span, "tool.result") ?? "";
        const toolStatus = getAttr(span, "tool.status") ?? "";
        const isError = toolStatus === "error" || span.status?.code === 2;
        let arg = "";
        try {
          const resultObj = JSON.parse(toolResult);
          arg = resultObj.path ?? resultObj.file_path ?? resultObj.pattern ?? resultObj.command ?? "";
        } catch {
          arg = "";
        }
        const lineInfo = toolCallLines[lineIdx];
        const lineNumber = lineInfo?.line ?? 0;
        lineIdx++;
        calls.push({ lineNumber, name: toolName, arg, isError });
      }
    }
  }
  return calls;
}
function extractCCToolCalls(lines) {
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/"tool_use"|"type"\s*:\s*"tool_use"/i.test(line)) continue;
    const nameMatch = line.match(/"name"\s*:\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    let arg = "";
    if (name === "Read" || name === "Edit" || name === "Write") {
      const m = line.match(/"file_path"\s*:\s*"([^"]+)"/);
      arg = m ? m[1] : "";
    } else if (name === "Grep" || name === "Glob") {
      const m = line.match(/"pattern"\s*:\s*"([^"]+)"/);
      arg = m ? m[1] : "";
    } else if (name === "Bash") {
      const m = line.match(/"command"\s*:\s*"([^"]+)"/);
      arg = m ? m[1] : "";
    } else {
      const m = line.match(/"input"\s*:\s*\{[^}]*"([^"]+)"\s*:\s*"([^"]+)"/);
      arg = m ? `${m[1]}:${m[2]}` : "";
    }
    let isError = false;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (/"is_error"\s*:\s*true/i.test(lines[j])) {
        isError = true;
        break;
      }
      if (j !== i && /"tool_use"/i.test(lines[j])) break;
    }
    calls.push({ lineNumber: i + 1, name, arg, isError });
  }
  return calls;
}
function extractToolCalls(content, lines) {
  if (isOtelFormat(content)) {
    return extractOtelToolCalls(content);
  }
  return extractCCToolCalls(lines);
}
function findIdenticalCalls(toolCalls) {
  const groups = /* @__PURE__ */ new Map();
  for (const call of toolCalls) {
    const key = `${call.name}::${call.arg}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  return Array.from(groups.entries()).filter(([, calls]) => calls.length >= 3).map(([key, calls]) => {
    const [name, arg] = key.split("::");
    return { name, arg, calls };
  }).sort((a, b) => b.calls.length - a.calls.length);
}
function findCircularPatterns(toolCalls) {
  const patterns = [];
  if (toolCalls.length < 4) return patterns;
  for (let i = 0; i < toolCalls.length - 3; i++) {
    const a = toolCalls[i].name;
    const b = toolCalls[i + 1]?.name;
    if (!b || a === b) continue;
    let cycles = 0;
    const cycleLines = [toolCalls[i].lineNumber];
    let j = i + 1;
    while (j < toolCalls.length - 1) {
      if (toolCalls[j].name === b && toolCalls[j + 1]?.name === a) {
        cycles++;
        cycleLines.push(
          toolCalls[j].lineNumber,
          toolCalls[j + 1].lineNumber
        );
        j += 2;
      } else {
        break;
      }
    }
    if (cycles >= 2) {
      patterns.push({
        tools: [a, b],
        cycles,
        firstLine: toolCalls[i].lineNumber,
        lastLine: cycleLines[cycleLines.length - 1],
        lines: cycleLines
      });
      i = j - 1;
    }
  }
  return patterns;
}
function identicalSeverity(count) {
  if (count >= 7) return "high";
  if (count >= 4) return "medium";
  return "low";
}
function identicalClassification(count) {
  return count >= 7 ? "manual-review" : "auto-fixable";
}
function circularSeverity(cycles) {
  return cycles >= 3 ? "high" : "medium";
}
function circularClassification(cycles) {
  return cycles >= 3 ? "manual-review" : "auto-fixable";
}
function analyze(filePath2, previousEvents2) {
  const content = readFileSync(filePath2, "utf-8");
  const lines = content.split("\n");
  const toolCalls = extractToolCalls(content, lines);
  const events = [];
  for (const group of findIdenticalCalls(toolCalls)) {
    const count = group.calls.length;
    const firstLine = group.calls[0].lineNumber;
    const lastLine = group.calls[count - 1].lineNumber;
    const argSummary = group.arg ? `(${group.arg.length > 50 ? group.arg.slice(0, 50) + "..." : group.arg})` : "";
    const event = {
      type: "step-repetition",
      severity: identicalSeverity(count),
      classification: identicalClassification(count),
      span: `lines ${firstLine}-${lastLine}`,
      description: `${group.name}${argSummary} repeated ${count} times`,
      evidence: `Identical calls at lines: ${group.calls.map((c) => c.lineNumber).join(", ")}`,
      evidence_examined: `${count} identical ${group.name} tool calls between lines ${firstLine} and ${lastLine}`,
      evidence_reasoning: `The same tool was called ${count} times with identical arguments, indicating a retry loop without variation`,
      evidence_turn_ref: `lines ${firstLine}-${lastLine}`,
      proposedFix: "Add 'try different approach after 3 failed attempts' instruction"
    };
    const prev = previousEvents2.find((p) => p.span === event.span);
    if (prev) event.previous_case_hash = prev.case_hash;
    events.push(event);
  }
  for (const pattern of findCircularPatterns(toolCalls)) {
    const event = {
      type: "step-repetition",
      severity: circularSeverity(pattern.cycles),
      classification: circularClassification(pattern.cycles),
      span: `lines ${pattern.firstLine}-${pattern.lastLine}`,
      description: `Circular pattern: ${pattern.tools.join(" \u2192 ")} (${pattern.cycles} cycles)`,
      evidence: `Pattern at lines: ${pattern.lines.join(", ")}`,
      evidence_examined: `Tool call sequence ${pattern.tools.join(" \u2192 ")} repeating ${pattern.cycles} times between lines ${pattern.firstLine} and ${pattern.lastLine}`,
      evidence_reasoning: `The agent entered a circular loop calling the same sequence of tools ${pattern.cycles} times without progressing`,
      evidence_turn_ref: `lines ${pattern.firstLine}-${pattern.lastLine}`,
      proposedFix: "Add loop detection instruction to break circular tool usage patterns"
    };
    const prev = previousEvents2.find((p) => p.span === event.span);
    if (prev) event.previous_case_hash = prev.case_hash;
    events.push(event);
  }
  const resolved_previous = previousEvents2.filter((p) => !events.some((e) => e.span === p.span)).map((p) => p.case_hash);
  return { skill: "step-repetition", events, resolved_previous };
}
var filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npx tsx check-step-repetition.ts <trace-file> [--previous '<json>']"
  );
  process.exit(1);
}
var previousEvents = [];
var prevIdx = process.argv.indexOf("--previous");
if (prevIdx !== -1 && process.argv[prevIdx + 1]) {
  try {
    previousEvents = JSON.parse(process.argv[prevIdx + 1]);
  } catch {
  }
}
var result = analyze(filePath, previousEvents);
console.log(JSON.stringify(result, null, 2));
