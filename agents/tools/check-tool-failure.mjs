#!/usr/bin/env node

// packages/self-care-plugin/agents/tools/check-tool-failure.ts
import { readFileSync } from "node:fs";
var ERROR_MATCHERS = [
  { test: /Sibling tool call errored/i, errorType: "sibling_error" },
  { test: /ReferenceError|is not defined/, errorType: "reference_error" },
  { test: /ModuleNotFoundError|ImportError/, errorType: "import_error" },
  { test: /TypeError/, errorType: "type_error" },
  { test: /SyntaxError/, errorType: "syntax_error" },
  { test: /ValueError/, errorType: "value_error" },
  { test: /Traceback \(most recent/, errorType: "traceback" },
  { test: /EISDIR/, errorType: "eisdir" },
  { test: /ENOENT/i, errorType: "enoent" },
  { test: /EACCES|EPERM/i, errorType: "permission" },
  { test: /permission denied|access denied/i, errorType: "permission" },
  { test: /no such file or directory/i, errorType: "file_not_found" },
  { test: /file not found/i, errorType: "file_not_found" },
  { test: /command not found/i, errorType: "command_not_found" },
  { test: /is not recognized as/i, errorType: "command_not_found" },
  { test: /connection refused|ECONNREFUSED/i, errorType: "connection" },
  { test: /connection timed out/i, errorType: "timeout" },
  { test: /\btimeout\b|\btimed out\b/i, errorType: "timeout" },
  {
    test: /[Ee]xit code [1-9]|exited with code [1-9]/,
    errorType: "exit_code"
  },
  { test: /"is_error"\s*:\s*true/i, errorType: "is_error" },
  {
    test: /"error"\s*:\s*true|"success"\s*:\s*false/i,
    errorType: "generic_error"
  }
];
var SKIP_RULES = [
  /"is_error"\s*:\s*false/i,
  /"success"\s*:\s*true/i,
  /user doesn't want to proceed/i,
  /tool use was rejected/i,
  /user rejected/i,
  /Permission for this tool use was denied/i,
  /No matches found/i,
  /0 results found/i,
  /error[\s_-]?handling/i,
  /\.error\.ts|\.error\.js/i,
  /ErrorBoundary/i,
  /handleError|catchError|onError/i,
  /error\.log\b/i,
  /\bif\s+(failed|error)\b/i,
  /check\s+if\s+failed/i,
  /"name"\s*:\s*"[^"]*[Ee]rror[^"]*"/
  // tool named "…Error…"
];
var SEVERITY = {
  reference_error: "high",
  type_error: "high",
  syntax_error: "high",
  value_error: "high",
  import_error: "high",
  traceback: "high",
  connection: "high",
  enoent: "high",
  file_not_found: "high",
  permission: "high",
  exit_code: "high",
  command_not_found: "high",
  is_error: "high",
  generic_error: "medium",
  timeout: "medium",
  eisdir: "medium",
  sibling_error: "low"
};
var MANUAL_REVIEW_TYPES = /* @__PURE__ */ new Set([
  "reference_error",
  "type_error",
  "syntax_error",
  "import_error",
  "permission"
]);
var FIX_TEMPLATE = {
  exit_code: "Check command output for specific error details",
  eisdir: "Check if path is file vs directory before reading",
  enoent: "Verify file exists before accessing",
  file_not_found: "Verify file exists before accessing",
  permission: "Check file permissions or use appropriate tool",
  reference_error: "Ensure required variable/function is defined (SME review needed)",
  type_error: "Fix code bug \u2014 type mismatch or syntax error (SME review needed)",
  syntax_error: "Fix code bug \u2014 syntax error (SME review needed)",
  value_error: "Fix value error (SME review needed)",
  import_error: "Install missing dependency or fix import path (SME review needed)",
  connection: "Verify server is running and accessible on expected port",
  timeout: "Increase timeout or check for slow/unresponsive service",
  command_not_found: "Install missing command or use alternative",
  traceback: "Handle exception appropriately or fix underlying bug (SME review needed)",
  is_error: "Investigate and handle the tool error",
  generic_error: "Investigate the error condition",
  sibling_error: "Handle parallel tool failures gracefully"
};
var ERROR_LABEL = {
  is_error: "tool execution error",
  exit_code: "non-zero exit code",
  eisdir: "attempted to read directory as file",
  enoent: "file or directory not found (ENOENT)",
  file_not_found: "file not found",
  permission: "permission denied",
  command_not_found: "command not found",
  connection: "connection refused",
  timeout: "operation timed out",
  type_error: "TypeError",
  syntax_error: "SyntaxError",
  value_error: "ValueError",
  reference_error: "ReferenceError",
  import_error: "module/import not found",
  traceback: "unhandled exception",
  sibling_error: "sibling tool call errored",
  generic_error: "error flag set"
};
function classifyLine(line) {
  for (const skip of SKIP_RULES) {
    if (skip.test(line)) return null;
  }
  for (const { test, errorType } of ERROR_MATCHERS) {
    if (test.test(line)) return errorType;
  }
  return null;
}
function hasRetrySuccess(lines, fromIdx) {
  const limit = Math.min(fromIdx + 20, lines.length);
  for (let i = fromIdx + 1; i < limit; i++) {
    if (/"is_error"\s*:\s*false/i.test(lines[i]) || /"success"\s*:\s*true/i.test(lines[i])) {
      return true;
    }
  }
  return false;
}
function extractToolName(lines, lineIdx) {
  for (let offset = 0; offset <= 5; offset++) {
    for (const idx of [lineIdx, lineIdx - offset, lineIdx + offset]) {
      if (idx >= 0 && idx < lines.length) {
        const m = lines[idx].match(/"name"\s*:\s*"([^"]+)"/);
        if (m) return m[1];
      }
    }
  }
  return "";
}
function aggregate(matches) {
  if (matches.length === 0) return [];
  const out = [];
  let cur = {
    ...matches[0],
    count: 1,
    lastLine: matches[0].lineNumber
  };
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i];
    if (m.errorType === cur.errorType && m.lineNumber - cur.lastLine <= 10) {
      cur.count++;
      cur.lastLine = m.lineNumber;
    } else {
      out.push(cur);
      cur = { ...m, count: 1, lastLine: m.lineNumber };
    }
  }
  out.push(cur);
  return out;
}
function analyze(filePath2, previousEvents2) {
  const content = readFileSync(filePath2, "utf-8");
  const lines = content.split("\n");
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < lines.length; i++) {
    if (seen.has(i)) continue;
    const errorType = classifyLine(lines[i]);
    if (errorType === null) continue;
    if (hasRetrySuccess(lines, i)) continue;
    seen.add(i);
    matches.push({ lineNumber: i + 1, content: lines[i], errorType });
  }
  const groups = aggregate(matches);
  const events = groups.map((g) => {
    const toolName = extractToolName(lines, g.lineNumber - 1);
    const prefix = toolName ? `${toolName}: ` : "";
    const suffix = g.count > 1 ? ` (${g.count} consecutive failures)` : "";
    const event = {
      type: "tool-failure",
      severity: SEVERITY[g.errorType],
      classification: MANUAL_REVIEW_TYPES.has(g.errorType) ? "manual-review" : "auto-fixable",
      span: `line ${g.lineNumber}`,
      description: `${prefix}${ERROR_LABEL[g.errorType]}${suffix}`,
      evidence: g.content.trim().slice(0, 200),
      proposedFix: FIX_TEMPLATE[g.errorType]
    };
    const prev = previousEvents2.find((p) => p.span === event.span);
    if (prev) event.previous_case_hash = prev.case_hash;
    return event;
  });
  const resolved_previous = previousEvents2.filter((p) => !events.some((e) => e.span === p.span)).map((p) => p.case_hash);
  return { skill: "tool-failure", events, resolved_previous };
}
var filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npx tsx check-tool-failure.ts <trace-file> [--previous '<json>']"
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
