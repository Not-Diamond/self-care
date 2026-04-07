#!/usr/bin/env node

// packages/core/src/trace-importer/autosync.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join, resolve } from "node:path";

// packages/core/src/trace-importer/converters/langfuse.ts
import { createHash } from "node:crypto";

// packages/core/src/trace-importer/converters/types.ts
function strAttr(key, value) {
  return { key, value: { stringValue: value } };
}
function intAttr(key, value) {
  return { key, value: { intValue: String(value) } };
}
function toNanoTimestamp(iso) {
  const ms = new Date(iso).getTime();
  return `${ms}000000`;
}

// packages/core/src/trace-importer/converters/langfuse.ts
function toHex16(id) {
  return createHash("md5").update(id).digest("hex").slice(0, 16);
}
function toHex32(id) {
  return createHash("md5").update(id).digest("hex");
}
function computeTraceHash(traceId) {
  return createHash("sha256").update(traceId).digest("hex").slice(0, 16);
}
function inputLooksLikeMessages(input) {
  if (Array.isArray(input)) {
    return input.length > 0 && input[0] != null && typeof input[0] === "object" && "role" in input[0];
  }
  if (input != null && typeof input === "object" && "args" in input) {
    const args = input.args;
    if (Array.isArray(args) && args.length > 0 && Array.isArray(args[0])) {
      const msgs = args[0];
      return msgs.length > 0 && msgs[0] != null && typeof msgs[0] === "object" && "role" in msgs[0];
    }
  }
  return false;
}
function detectObservationSpanKind(obs) {
  if (obs.type === "GENERATION") return "llm";
  if (obs.type === "EVENT") return "event";
  if (obs.type === "SPAN") {
    if (obs.model) return "llm";
    if (inputLooksLikeMessages(obs.input)) return "llm";
    const meta = obs.metadata;
    if (meta) {
      const attrs = meta.attributes;
      if (attrs) {
        if (attrs["db.system"]) return "tool";
        if (attrs["http.method"] || attrs["http.request.method"]) return "tool";
      }
    }
    return "chain";
  }
  return "unknown";
}
function convertObservationsToOtel(traceId, traceName, observations) {
  const spans = observations.map((obs) => {
    const attributes = [
      strAttr("langfuse.observation.type", obs.type),
      strAttr("langfuse.observation.id", obs.id)
    ];
    const spanKind = detectObservationSpanKind(obs);
    attributes.push(strAttr("traceloop.span.kind", spanKind));
    if (obs.input != null) {
      attributes.push(strAttr("input.value", typeof obs.input === "string" ? obs.input : JSON.stringify(obs.input)));
    }
    if (obs.output != null) {
      attributes.push(strAttr("output.value", typeof obs.output === "string" ? obs.output : JSON.stringify(obs.output)));
    }
    if (obs.model) {
      attributes.push(strAttr("gen_ai.request.model", obs.model));
    }
    if (obs.usage?.total) {
      attributes.push(intAttr("gen_ai.usage.total_tokens", obs.usage.total));
    }
    if (obs.usage?.input) {
      attributes.push(intAttr("gen_ai.usage.input_tokens", obs.usage.input));
    }
    if (obs.usage?.output) {
      attributes.push(intAttr("gen_ai.usage.output_tokens", obs.usage.output));
    }
    if (obs.promptName) {
      attributes.push(strAttr("langfuse.prompt.name", obs.promptName));
    }
    if (obs.promptVersion != null) {
      attributes.push(strAttr("langfuse.prompt.version", String(obs.promptVersion)));
    }
    if (obs.metadata) {
      attributes.push(strAttr("langfuse.metadata", JSON.stringify(obs.metadata)));
      const meta = obs.metadata;
      if (meta.ls_provider) attributes.push(strAttr("gen_ai.system", String(meta.ls_provider)));
      if (meta.ls_model_name) attributes.push(strAttr("gen_ai.request.model", String(meta.ls_model_name)));
      if (meta.ls_model_type === "llm" || meta.ls_model_type === "chat") {
        attributes.push(strAttr("langsmith.run_type", "llm"));
      }
    }
    if (obs.name) {
      if (spanKind === "tool" || spanKind === "chain") {
        attributes.push(strAttr("tool.name", obs.name));
      }
    }
    const hasError = obs.level === "ERROR";
    return {
      traceId: toHex32(traceId),
      spanId: toHex16(obs.id),
      parentSpanId: obs.parentObservationId ? toHex16(obs.parentObservationId) : "",
      name: obs.name ?? obs.type,
      kind: 1,
      startTimeUnixNano: toNanoTimestamp(obs.startTime),
      endTimeUnixNano: obs.endTime ? toNanoTimestamp(obs.endTime) : toNanoTimestamp(obs.startTime),
      attributes,
      status: {
        code: hasError ? 2 : 1,
        message: hasError ? obs.statusMessage ?? "" : ""
      },
      events: hasError && obs.statusMessage ? [
        {
          name: "exception",
          timeUnixNano: toNanoTimestamp(obs.endTime ?? obs.startTime),
          attributes: [strAttr("exception.message", obs.statusMessage)]
        }
      ] : []
    };
  });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            strAttr("service.name", traceName ?? "langfuse-import"),
            strAttr("langfuse.trace_id", traceId)
          ]
        },
        scopeSpans: [
          {
            scope: { name: "langfuse-converter", version: "1.0.0" },
            spans
          }
        ]
      }
    ]
  };
}

// packages/core/src/trace-importer/clients/types.ts
var MAX_RETRIES = 3;
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function fetchWithRetry(input, init, maxRetries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 429) return res;
    if (attempt === maxRetries) return res;
    const retryAfter = res.headers.get("retry-after");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1e3 : 2e3 * (attempt + 1);
    await sleep(waitMs);
  }
  throw new Error("Unreachable");
}

// packages/core/src/trace-importer/clients/langfuse.ts
var DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";
var REQUEST_DELAY_MS = 500;
var LangfuseClient = class {
  /** Build Basic Auth header from public key + secret key */
  authHeader(publicKey, secretKey) {
    return "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  }
  baseUrl(host) {
    return (host || DEFAULT_LANGFUSE_HOST).replace(/\/+$/, "");
  }
  /** Validate credentials by fetching projects */
  async validate(publicKey, secretKey, host) {
    const base = this.baseUrl(host);
    const res = await fetchWithRetry(`${base}/api/public/projects`, {
      headers: {
        Authorization: this.authHeader(publicKey, secretKey),
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid Langfuse credentials");
      }
      throw new Error(`Langfuse API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const projects = data.data ?? [data];
    if (!projects.length) {
      throw new Error("No project found for these Langfuse credentials");
    }
    return { projectId: projects[0].id ?? projects[0].name ?? "default" };
  }
  /** Parse raw Langfuse trace data into a summary */
  parseTraceSummary(t) {
    const observations = t.observations ?? [];
    const durationMs = typeof t.latency === "number" ? Math.round(t.latency * 1e3) : null;
    return {
      trace_id: t.id,
      name: t.name ?? `Trace ${t.id.slice(0, 8)}`,
      timestamp: t.timestamp,
      tags: t.tags ?? [],
      total_tokens: -1,
      // Not available from the list endpoint
      duration_ms: durationMs,
      observation_count: observations.length,
      user_id: t.userId ?? null
    };
  }
  /** List a single page of traces from Langfuse */
  async listTraces(publicKey, secretKey, host, page = 1, limit = 10, projectId) {
    const base = this.baseUrl(host);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });
    const res = await fetchWithRetry(`${base}/api/public/traces?${params}`, {
      headers: {
        Authorization: this.authHeader(publicKey, secretKey),
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to list traces: ${res.status} ${res.statusText} \u2014 ${text}`);
    }
    const data = await res.json();
    const pageTraces = data.data ?? [];
    const total = data.meta?.totalItems ?? pageTraces.length;
    const traces = pageTraces.map((t) => this.parseTraceSummary(t));
    let langfuseUrlBase = projectId ? `${base}/project/${projectId}` : null;
    if (pageTraces.length > 0 && pageTraces[0].htmlPath) {
      const htmlPath = pageTraces[0].htmlPath;
      const projectMatch = htmlPath.match(/^\/project\/([^/]+)/);
      if (projectMatch) {
        langfuseUrlBase = `${base}/project/${projectMatch[1]}`;
      }
    }
    return { traces, total, page, langfuse_url_base: langfuseUrlBase };
  }
  /** Fetch a single trace with all observations */
  async fetchTrace(publicKey, secretKey, traceId, host) {
    const base = this.baseUrl(host);
    const res = await fetchWithRetry(`${base}/api/public/traces/${encodeURIComponent(traceId)}`, {
      headers: {
        Authorization: this.authHeader(publicKey, secretKey),
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to fetch trace: ${res.status} ${res.statusText} \u2014 ${text}`);
    }
    const data = await res.json();
    const inlineObs = Array.isArray(data.observations) ? data.observations : [];
    const observations = inlineObs.length > 0 ? inlineObs.map((o) => this.parseObservation(o)) : await this.fetchObservations(publicKey, secretKey, traceId, host);
    return {
      id: data.id,
      name: data.name,
      input: data.input,
      output: data.output,
      userId: data.userId,
      sessionId: data.sessionId,
      metadata: data.metadata,
      tags: data.tags,
      timestamp: data.timestamp,
      observations
    };
  }
  /** Parse a raw observation object into a LangfuseObservation */
  parseObservation(o) {
    return {
      id: o.id,
      traceId: o.traceId,
      type: o.type,
      name: o.name,
      startTime: o.startTime,
      endTime: o.endTime,
      model: o.model,
      modelParameters: o.modelParameters,
      input: o.input,
      output: o.output,
      metadata: o.metadata,
      level: o.level,
      statusMessage: o.statusMessage,
      parentObservationId: o.parentObservationId,
      usage: o.usage ? {
        input: o.usage.input ?? o.usage.promptTokens,
        output: o.usage.output ?? o.usage.completionTokens,
        total: o.usage.total ?? o.usage.totalTokens,
        unit: o.usage.unit
      } : void 0,
      promptId: o.promptId,
      promptName: o.promptName,
      promptVersion: o.promptVersion
    };
  }
  /** Fetch all observations for a trace */
  async fetchObservations(publicKey, secretKey, traceId, host) {
    const base = this.baseUrl(host);
    const observations = [];
    let page = 1;
    const limit = 100;
    do {
      if (page > 1) await sleep(REQUEST_DELAY_MS);
      const params = new URLSearchParams({
        traceId,
        page: String(page),
        limit: String(limit)
      });
      const res = await fetchWithRetry(`${base}/api/public/observations?${params}`, {
        headers: {
          Authorization: this.authHeader(publicKey, secretKey),
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to fetch observations: ${res.status} ${res.statusText} \u2014 ${text}`);
      }
      const data = await res.json();
      const pageObs = data.data ?? [];
      for (const o of pageObs) {
        observations.push(this.parseObservation(o));
      }
      if (pageObs.length < limit) break;
      page++;
    } while (true);
    return observations;
  }
  /** Fetch all traces and convert to OTEL format */
  async fetchAllTraces(publicKey, secretKey, host) {
    const allSummaries = [];
    let page = 1;
    const pageSize = 100;
    let langfuseUrlBase = null;
    do {
      if (page > 1) await sleep(REQUEST_DELAY_MS);
      const result = await this.listTraces(publicKey, secretKey, host, page, pageSize);
      allSummaries.push(...result.traces);
      langfuseUrlBase = result.langfuse_url_base;
      if (allSummaries.length >= result.total || result.traces.length < pageSize) break;
      page++;
    } while (true);
    const listResult = { traces: allSummaries, langfuse_url_base: langfuseUrlBase };
    const importData = [];
    const skippedTraceIds = [];
    for (let i = 0; i < listResult.traces.length; i++) {
      if (i > 0) await sleep(REQUEST_DELAY_MS);
      const summary = listResult.traces[i];
      const trace = await this.fetchTrace(publicKey, secretKey, summary.trace_id, host);
      const observations = trace.observations ?? [];
      if (observations.length === 0) {
        skippedTraceIds.push(summary.trace_id);
        continue;
      }
      const otelJson = convertObservationsToOtel(trace.id, trace.name, observations);
      const traceHash = computeTraceHash(trace.id);
      importData.push({ trace, otelJson, traceHash });
    }
    return { traces: importData, langfuse_url_base: listResult.langfuse_url_base, skipped_trace_ids: skippedTraceIds };
  }
  /**
   * Paginated time-filtered fetch for incremental auto-sync.
   * Pages through traces created after `fromTimestamp`, calling `onPage`
   * per page. Stops if `onPage` returns `false`.
   */
  async fetchTracesPaginated(publicKey, secretKey, host, fromTimestamp, onPage) {
    const base = this.baseUrl(host ?? void 0);
    let page = 1;
    const limit = 100;
    let isFirstPage = true;
    do {
      if (!isFirstPage) await sleep(REQUEST_DELAY_MS);
      isFirstPage = false;
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
      });
      if (fromTimestamp) {
        params.set("fromTimestamp", new Date(fromTimestamp).toISOString());
      }
      const res = await fetchWithRetry(`${base}/api/public/traces?${params}`, {
        headers: {
          Authorization: this.authHeader(publicKey, secretKey),
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to list traces: ${res.status} ${res.statusText} \u2014 ${text}`);
      }
      const data = await res.json();
      const pageTraces = data.data ?? [];
      if (pageTraces.length === 0) break;
      const mapped = pageTraces.map((t) => ({
        id: t.id,
        name: t.name ?? `Trace ${t.id.slice(0, 8)}`,
        timestamp: t.timestamp
      }));
      const shouldContinue = await onPage(mapped);
      if (!shouldContinue) break;
      if (pageTraces.length < limit) break;
      page++;
    } while (true);
  }
  /** Fetch selected traces and convert to OTEL format */
  async fetchSelectedTraces(publicKey, secretKey, selectedTraceIds, host) {
    const base = this.baseUrl(host);
    const { projectId } = await this.validate(publicKey, secretKey, host);
    const langfuseUrlBase = `${base}/project/${projectId}`;
    const importData = [];
    const skippedTraceIds = [];
    for (let i = 0; i < selectedTraceIds.length; i++) {
      if (i > 0) await sleep(REQUEST_DELAY_MS);
      const traceId = selectedTraceIds[i];
      const trace = await this.fetchTrace(publicKey, secretKey, traceId, host);
      const observations = trace.observations ?? [];
      if (observations.length === 0) {
        skippedTraceIds.push(traceId);
        continue;
      }
      const otelJson = convertObservationsToOtel(trace.id, trace.name, observations);
      const traceHash = computeTraceHash(trace.id);
      importData.push({ trace, otelJson, traceHash });
    }
    return { traces: importData, langfuse_url_base: langfuseUrlBase, skipped_trace_ids: skippedTraceIds };
  }
};

// packages/core/src/trace-importer/converters/langsmith.ts
import { createHash as createHash2 } from "node:crypto";
function uuidToHex16(uuid) {
  return uuid.replace(/-/g, "").slice(0, 16);
}
function uuidToHex32(uuid) {
  const hex = uuid.replace(/-/g, "");
  return hex.padEnd(32, "0");
}
function computeTraceHash2(rootRunId) {
  return createHash2("sha256").update(rootRunId).digest("hex").slice(0, 16);
}
function convertRunsToOtel(runs) {
  const spans = runs.map((run) => {
    const attributes = [
      strAttr("langsmith.run_type", run.run_type),
      strAttr("langsmith.run.id", run.id)
    ];
    if (run.inputs) {
      attributes.push(strAttr("input.value", JSON.stringify(run.inputs)));
    }
    if (run.outputs) {
      attributes.push(strAttr("output.value", JSON.stringify(run.outputs)));
    }
    if (run.total_tokens) {
      attributes.push(intAttr("gen_ai.usage.total_tokens", run.total_tokens));
    }
    if (run.prompt_tokens) {
      attributes.push(intAttr("gen_ai.usage.input_tokens", run.prompt_tokens));
    }
    if (run.completion_tokens) {
      attributes.push(intAttr("gen_ai.usage.output_tokens", run.completion_tokens));
    }
    if (run.tags?.length) {
      attributes.push(strAttr("langsmith.tags", JSON.stringify(run.tags)));
    }
    if (run.extra?.invocation_params) {
      const params = run.extra.invocation_params;
      if (params.model) {
        attributes.push(strAttr("gen_ai.request.model", String(params.model)));
      }
    }
    if (run.extra?.metadata) {
      const meta = run.extra.metadata;
      if (typeof meta.ls_prompt_name === "string") {
        attributes.push(strAttr("langsmith.prompt.name", meta.ls_prompt_name));
      }
      if (typeof meta.ls_prompt_version === "string") {
        attributes.push(strAttr("langsmith.prompt.version", meta.ls_prompt_version));
      }
      if (typeof meta.ls_hub_repo === "string") {
        attributes.push(strAttr("langsmith.prompt.repo_handle", meta.ls_hub_repo));
      }
    }
    const hasError = !!run.error;
    return {
      traceId: uuidToHex32(run.trace_id),
      spanId: uuidToHex16(run.id),
      parentSpanId: run.parent_run_id ? uuidToHex16(run.parent_run_id) : "",
      name: run.name,
      kind: 1,
      // INTERNAL
      startTimeUnixNano: toNanoTimestamp(run.start_time),
      endTimeUnixNano: run.end_time ? toNanoTimestamp(run.end_time) : toNanoTimestamp(run.start_time),
      attributes,
      status: {
        code: hasError ? 2 : 1,
        message: hasError ? run.error : ""
      },
      events: hasError ? [
        {
          name: "exception",
          timeUnixNano: run.end_time ? toNanoTimestamp(run.end_time) : toNanoTimestamp(run.start_time),
          attributes: [strAttr("exception.message", run.error)]
        }
      ] : []
    };
  });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            strAttr("service.name", (runs.find((r) => !r.parent_run_id) ?? runs[0])?.name ?? "langsmith-import"),
            strAttr("langsmith.trace_id", runs[0]?.trace_id ?? "")
          ]
        },
        scopeSpans: [
          {
            scope: { name: "langsmith-converter", version: "1.0.0" },
            spans
          }
        ]
      }
    ]
  };
}

// packages/core/src/trace-importer/clients/langsmith.ts
var LANGSMITH_API = "https://api.smith.langchain.com";
var REQUEST_DELAY_MS2 = 1e3;
var LangSmithClient = class {
  constructor() {
  }
  async listProjects(apiKey) {
    const res = await fetch(`${LANGSMITH_API}/sessions`, {
      headers: { "x-api-key": apiKey, "Accept": "application/json" }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error("Invalid LangSmith API key");
      throw new Error(`LangSmith API error: ${res.status} ${res.statusText}`);
    }
    const projects = await res.json();
    return projects.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      run_count: typeof p.run_count === "number" ? p.run_count : void 0,
      tenant_id: typeof p.tenant_id === "string" ? p.tenant_id : void 0
    }));
  }
  async validate(apiKey, projectName) {
    const res = await fetch(`${LANGSMITH_API}/sessions?name=${encodeURIComponent(projectName)}`, {
      headers: { "x-api-key": apiKey, "Accept": "application/json" }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error("Invalid LangSmith API key");
      throw new Error(`LangSmith API error: ${res.status} ${res.statusText}`);
    }
    const raw = await res.json();
    const projects = raw.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      run_count: typeof p.run_count === "number" ? p.run_count : void 0,
      tenant_id: typeof p.tenant_id === "string" ? p.tenant_id : void 0
    }));
    const project = projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project "${projectName}" not found in LangSmith`);
    return project;
  }
  async fetchAllTraces(apiKey, projectName) {
    const project = await this.validate(apiKey, projectName);
    const langsmithUrlBase = project.tenant_id ? `https://smith.langchain.com/o/${project.tenant_id}/projects/p/${project.id}` : null;
    const rootRuns = await this.fetchRootRuns(apiKey, project.id);
    const traces = [];
    for (const rootRun of rootRuns) {
      if (traces.length > 0) await sleep(REQUEST_DELAY_MS2);
      const allRuns = await this.fetchTraceRuns(apiKey, rootRun.trace_id);
      const otelJson = convertRunsToOtel(allRuns);
      const traceHash = computeTraceHash2(rootRun.id);
      traces.push({ rootRun, otelJson, traceHash });
    }
    return { traces, langsmith_url_base: langsmithUrlBase };
  }
  async listRuns(apiKey, projectName, limit = 50, cursor, filters) {
    const project = await this.validate(apiKey, projectName);
    const page = await this.fetchRootRunsPage(apiKey, project.id, limit, cursor, filters);
    const langsmithUrlBase = project.tenant_id ? `https://smith.langchain.com/o/${project.tenant_id}/projects/p/${project.id}` : null;
    const traces = page.runs.map((run) => {
      const startMs = new Date(run.start_time).getTime();
      const endMs = run.end_time ? new Date(run.end_time).getTime() : NaN;
      const durationMs = Number.isFinite(endMs) ? endMs - startMs : null;
      return {
        run_id: run.id,
        name: run.name ?? `Run ${run.id.slice(0, 8)}`,
        start_time: run.start_time,
        end_time: run.end_time ?? null,
        status: run.status ?? "unknown",
        tags: run.tags ?? [],
        total_tokens: run.total_tokens ?? 0,
        duration_ms: durationMs,
        run_type: run.run_type ?? "unknown",
        error: run.error ?? null
      };
    });
    return { traces, langsmith_url_base: langsmithUrlBase, next_cursor: page.nextCursor };
  }
  async fetchSelectedTraces(apiKey, projectName, selectedRunIds) {
    const project = await this.validate(apiKey, projectName);
    const langsmithUrlBase = project.tenant_id ? `https://smith.langchain.com/o/${project.tenant_id}/projects/p/${project.id}` : null;
    const rootRuns = await this.fetchRunsByIds(apiKey, selectedRunIds);
    const traces = [];
    for (const rootRun of rootRuns) {
      if (traces.length > 0) await sleep(REQUEST_DELAY_MS2);
      const allRuns = await this.fetchTraceRuns(apiKey, rootRun.trace_id);
      const otelJson = convertRunsToOtel(allRuns);
      const traceHash = computeTraceHash2(rootRun.id);
      traces.push({ rootRun, otelJson, traceHash });
    }
    return { traces, langsmith_url_base: langsmithUrlBase };
  }
  async getPrompt(apiKey, promptIdentifier) {
    const res = await fetchWithRetry(`${LANGSMITH_API}/commits/-/${encodeURIComponent(promptIdentifier)}/?limit=1&include_model=false`, {
      method: "GET",
      headers: { "x-api-key": apiKey, "Accept": "application/json" }
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Prompt "${promptIdentifier}" not found in LangSmith`);
      throw new Error(`Failed to fetch prompt: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const manifest = data.manifest ?? data;
    const content = typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2);
    return { name: promptIdentifier, content, commitHash: data.commit_hash ?? data.id ?? "unknown" };
  }
  async pushPromptVersion(apiKey, promptIdentifier, content, commitMessage) {
    let manifest;
    try {
      manifest = JSON.parse(content);
    } catch {
      manifest = { messages: [{ role: "system", content }] };
    }
    const res = await fetchWithRetry(`${LANGSMITH_API}/commits/-/${encodeURIComponent(promptIdentifier)}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, ...commitMessage && { message: commitMessage } })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to push prompt version: ${res.status} ${res.statusText} \u2014 ${text}`);
    }
    const data = await res.json();
    return { commitHash: data.commit_hash ?? data.id ?? "unknown" };
  }
  async fetchRootRunsPage(apiKey, projectId, limit, cursor, filters) {
    const body = {
      session: [projectId],
      is_root: true,
      limit,
      select: ["id", "name", "run_type", "start_time", "end_time", "inputs", "outputs", "error", "status", "trace_id", "parent_run_id", "tags", "extra", "total_tokens", "prompt_tokens", "completion_tokens"]
    };
    if (cursor) body.cursor = cursor;
    if (filters?.status === "error") body.error = true;
    if (filters?.name) body.filter = `eq(name, "${filters.name}")`;
    if (filters?.tag) body.filter = body.filter ? `and(${body.filter}, has(tags, "${filters.tag}"))` : `has(tags, "${filters.tag}")`;
    const res = await fetchWithRetry(`${LANGSMITH_API}/runs/query`, { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to fetch runs: ${res.status} ${res.statusText} \u2014 ${text}`);
    }
    const data = await res.json();
    return { runs: data.runs ?? [], nextCursor: data.cursors?.next ?? null };
  }
  async fetchRootRunsPaginated(apiKey, projectName, lastSyncAt, onPage) {
    const project = await this.validate(apiKey, projectName);
    const langsmithUrlBase = project.tenant_id ? `https://smith.langchain.com/o/${project.tenant_id}/projects/p/${project.id}` : null;
    let cursor;
    let isFirstPage = true;
    do {
      if (!isFirstPage) await sleep(REQUEST_DELAY_MS2);
      isFirstPage = false;
      const body = {
        session: [project.id],
        is_root: true,
        limit: 100,
        select: ["id", "name", "run_type", "start_time", "end_time", "inputs", "outputs", "error", "status", "trace_id", "parent_run_id", "tags", "extra", "total_tokens", "prompt_tokens", "completion_tokens"]
      };
      if (lastSyncAt) body.start_time = lastSyncAt;
      if (cursor) body.cursor = cursor;
      const res = await fetchWithRetry(`${LANGSMITH_API}/runs/query`, { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to fetch runs: ${res.status} ${res.statusText} \u2014 ${text}`);
      }
      const data = await res.json();
      const pageRuns = data.runs ?? [];
      if (onPage) {
        const shouldContinue = await onPage(pageRuns);
        if (!shouldContinue) return { langsmith_url_base: langsmithUrlBase };
      }
      cursor = data.cursors?.next ?? void 0;
    } while (cursor);
    return { langsmith_url_base: langsmithUrlBase };
  }
  async fetchRunsByIds(apiKey, runIds) {
    const body = {
      id: runIds,
      limit: runIds.length,
      select: ["id", "name", "run_type", "start_time", "end_time", "inputs", "outputs", "error", "status", "trace_id", "parent_run_id", "tags", "extra", "total_tokens", "prompt_tokens", "completion_tokens"]
    };
    const res = await fetchWithRetry(`${LANGSMITH_API}/runs/query`, { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to fetch runs by ID: ${res.status} ${res.statusText} \u2014 ${text}`);
    }
    const data = await res.json();
    return data.runs ?? [];
  }
  async fetchRootRuns(apiKey, projectId) {
    const allRuns = [];
    let cursor;
    do {
      if (allRuns.length > 0) await sleep(REQUEST_DELAY_MS2);
      const page = await this.fetchRootRunsPage(apiKey, projectId, 100, cursor);
      allRuns.push(...page.runs);
      cursor = page.nextCursor ?? void 0;
    } while (cursor);
    return allRuns;
  }
  async fetchTraceRuns(apiKey, traceId) {
    const allRuns = [];
    let cursor;
    do {
      if (allRuns.length > 0) await sleep(REQUEST_DELAY_MS2);
      const body = {
        trace: traceId,
        limit: 100,
        select: ["id", "name", "run_type", "start_time", "end_time", "inputs", "outputs", "error", "status", "trace_id", "parent_run_id", "dotted_order", "tags", "extra", "total_tokens", "prompt_tokens", "completion_tokens", "events"]
      };
      if (cursor) body.cursor = cursor;
      const res = await fetchWithRetry(`${LANGSMITH_API}/runs/query`, { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to fetch trace runs: ${res.status} ${res.statusText} \u2014 ${text}`);
      }
      const data = await res.json();
      allRuns.push(...data.runs ?? []);
      cursor = data.cursors?.next ?? void 0;
    } while (cursor);
    return allRuns;
  }
};

// packages/core/src/trace-importer/config/loader.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
function loadConfig(configPath) {
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// packages/core/src/trace-importer/autosync.ts
var DEFAULT_POLL_INTERVAL_MINUTES = 10;
var DEFAULT_SAMPLING_RATE = 0.01;
var BACKOFF_MS_PER_ERROR = 6e4;
var MAX_FETCH_PER_TICK = 100;
var LOCK_STALE_MS = 30 * 60 * 1e3;
function defaultState() {
  return {
    enabled: false,
    enabled_at: null,
    poll_interval_minutes: DEFAULT_POLL_INTERVAL_MINUTES,
    sampling_rate: DEFAULT_SAMPLING_RATE,
    last_sync_at: null,
    last_sync_count: 0,
    last_error: null,
    last_error_at: null,
    consecutive_errors: 0,
    loop_task_id: null,
    scope: null
  };
}
function defaultAutoSyncRuntimeDir(projectDir = process.cwd()) {
  return join(resolve(projectDir), ".self-care", "autosync");
}
function ensureParentDir(filePath) {
  mkdirSync2(dirname(filePath), { recursive: true });
}
function writeJson(filePath, value) {
  ensureParentDir(filePath);
  writeFileSync2(filePath, JSON.stringify(value, null, 2) + "\n");
}
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync2(filePath, "utf8"));
  } catch {
    return null;
  }
}
function runtimeStatePath(runtimeDir) {
  return join(runtimeDir, "state.json");
}
function pendingDir(runtimeDir) {
  return join(runtimeDir, "pending");
}
function tracesDir(runtimeDir) {
  return join(runtimeDir, "traces");
}
function processedDir(runtimeDir) {
  return join(runtimeDir, "processed");
}
function lockDir(runtimeDir) {
  return join(runtimeDir, ".lock");
}
function pendingEntryPath(runtimeDir, traceHash) {
  return join(pendingDir(runtimeDir), `${traceHash}.json`);
}
function stagedTracePath(runtimeDir, traceHash) {
  return join(tracesDir(runtimeDir), `${traceHash}.json`);
}
function processedMarkerPath(runtimeDir, traceHash) {
  return join(processedDir(runtimeDir), `${traceHash}.json`);
}
function pickConfigState(state) {
  return {
    enabled: state.enabled,
    poll_interval_minutes: state.poll_interval_minutes,
    sampling_rate: state.sampling_rate
  };
}
function pickRuntimeState(state) {
  return {
    enabled_at: state.enabled_at,
    last_sync_at: state.last_sync_at,
    last_sync_count: state.last_sync_count,
    last_error: state.last_error,
    last_error_at: state.last_error_at,
    consecutive_errors: state.consecutive_errors,
    loop_task_id: state.loop_task_id,
    scope: state.scope
  };
}
function scopesEqual(a, b) {
  if (!a || !b) return a === b;
  return a.source === b.source && a.project === b.project && a.host === b.host;
}
function deriveScopeFromConfig(config, persistedScope = null) {
  if (!config) return null;
  if (config.source === "langsmith") {
    return {
      source: "langsmith",
      project: config.langsmith?.project ?? null,
      host: null
    };
  }
  return {
    source: "langfuse",
    project: config.langfuse?.project_id ?? (persistedScope?.source === "langfuse" ? persistedScope.project : null),
    host: config.langfuse?.host ?? null
  };
}
function validateSamplingRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new Error("sampling_rate must be between 0 (exclusive) and 1 (inclusive)");
  }
  return rate;
}
function validatePollIntervalMinutes(interval) {
  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error("poll_interval_minutes must be at least 1");
  }
  return interval;
}
function loadAutoSyncState(statePath, runtimeDir = defaultAutoSyncRuntimeDir()) {
  const configState = readJson(statePath);
  const runtimeState = readJson(runtimeStatePath(runtimeDir));
  return {
    ...defaultState(),
    ...configState,
    ...runtimeState
  };
}
function saveAutoSyncState(statePath, runtimeDir = defaultAutoSyncRuntimeDir(), state) {
  writeJson(statePath, pickConfigState(state));
  writeJson(runtimeStatePath(runtimeDir), pickRuntimeState(state));
}
function effectiveSyncFloor(lastSyncAt, enabledAt) {
  if (!lastSyncAt) return enabledAt ?? null;
  if (!enabledAt) return lastSyncAt;
  return new Date(lastSyncAt).getTime() >= new Date(enabledAt).getTime() ? lastSyncAt : enabledAt;
}
function nextSyncAt(state) {
  const anchor = effectiveSyncFloor(state.last_sync_at, state.enabled_at);
  if (!anchor) return null;
  const next = new Date(anchor).getTime() + state.poll_interval_minutes * 6e4 + state.consecutive_errors * BACKOFF_MS_PER_ERROR;
  return new Date(next).toISOString();
}
function readPendingEntries(runtimeDir) {
  try {
    return readdirSync(pendingDir(runtimeDir)).filter((entry) => entry.endsWith(".json")).map((entry) => readJson(join(pendingDir(runtimeDir), entry))).filter((entry) => entry !== null).sort((a, b) => a.source_timestamp.localeCompare(b.source_timestamp));
  } catch {
    return [];
  }
}
function clearRuntimeWork(runtimeDir) {
  rmSync(pendingDir(runtimeDir), { recursive: true, force: true });
  rmSync(tracesDir(runtimeDir), { recursive: true, force: true });
  rmSync(processedDir(runtimeDir), { recursive: true, force: true });
}
function writePendingEntry(runtimeDir, entry, content) {
  writeJson(stagedTracePath(runtimeDir, entry.trace_hash), content);
  writeJson(pendingEntryPath(runtimeDir, entry.trace_hash), entry);
}
function removePendingEntry(runtimeDir, traceHash) {
  rmSync(pendingEntryPath(runtimeDir, traceHash), { force: true });
  rmSync(stagedTracePath(runtimeDir, traceHash), { force: true });
}
function isProcessed(runtimeDir, traceHash) {
  return existsSync(processedMarkerPath(runtimeDir, traceHash));
}
function markProcessed(runtimeDir, traceHash) {
  writeJson(processedMarkerPath(runtimeDir, traceHash), {
    trace_hash: traceHash,
    completed_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function tryAcquireLock(runtimeDir) {
  const dir = lockDir(runtimeDir);
  mkdirSync2(dirname(dir), { recursive: true });
  try {
    mkdirSync2(dir);
    writeJson(join(dir, "metadata.json"), { acquired_at: (/* @__PURE__ */ new Date()).toISOString(), pid: process.pid });
    return true;
  } catch {
  }
  try {
    const ageMs = Date.now() - statSync(dir).mtimeMs;
    if (ageMs <= LOCK_STALE_MS) return false;
  } catch {
    try {
      mkdirSync2(dir);
      writeJson(join(dir, "metadata.json"), { acquired_at: (/* @__PURE__ */ new Date()).toISOString(), pid: process.pid });
      return true;
    } catch {
      return false;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  try {
    mkdirSync2(dir);
    writeJson(join(dir, "metadata.json"), {
      acquired_at: (/* @__PURE__ */ new Date()).toISOString(),
      pid: process.pid,
      stale_recovered: true
    });
    return true;
  } catch {
    return false;
  }
}
function releaseLock(runtimeDir) {
  rmSync(lockDir(runtimeDir), { recursive: true, force: true });
}
function applySampling(items, rate) {
  if (items.length === 0) return [];
  if (rate >= 1) return items;
  const hashed = [...items].sort((a, b) => {
    const aHash = createHash3("md5").update(a.id).digest("hex");
    const bHash = createHash3("md5").update(b.id).digest("hex");
    return aHash.localeCompare(bHash);
  });
  return hashed.slice(0, Math.max(1, Math.ceil(items.length * rate)));
}
async function resolveSourceForPolling(configPath) {
  const config = loadConfig(configPath);
  if (!config) {
    throw new Error(`Invalid or missing config: ${configPath}`);
  }
  if (config.source === "langsmith") {
    const projectName = config.langsmith?.project;
    if (!projectName) {
      throw new Error("langsmith.project is required in .self-care/config.json");
    }
    const apiKey = process.env.LANGSMITH_API_KEY;
    if (!apiKey) {
      throw new Error("LANGSMITH_API_KEY not set. Add it to your .env or shell before running autosync.");
    }
    const client2 = new LangSmithClient();
    const project = await client2.validate(apiKey, projectName);
    return {
      source: "langsmith",
      scope: {
        source: "langsmith",
        project: project.name,
        host: null
      },
      apiKey,
      projectName: project.name,
      projectId: project.id,
      tenantId: project.tenant_id ?? null
    };
  }
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must both be set before running autosync.");
  }
  const host = config.langfuse?.host ?? null;
  const client = new LangfuseClient();
  const validation = await client.validate(publicKey, secretKey, host ?? void 0);
  const projectId = config.langfuse?.project_id ?? validation.projectId ?? null;
  return {
    source: "langfuse",
    scope: {
      source: "langfuse",
      project: projectId,
      host
    },
    publicKey,
    secretKey,
    host,
    projectId
  };
}
function configMissingResult(statePath, runtimeDir) {
  const state = loadAutoSyncState(statePath, runtimeDir);
  return {
    status: "config_missing",
    message: "Run /self-care:init before enabling autosync.",
    state,
    current_scope: null,
    effective_sync_floor: effectiveSyncFloor(state.last_sync_at, state.enabled_at),
    next_sync_at: nextSyncAt(state),
    pending_count: readPendingEntries(runtimeDir).length,
    traces: [],
    reused_pending: false
  };
}
function errorTickResult(state, currentScope, runtimeDir, message) {
  return {
    status: "error",
    message,
    state,
    current_scope: currentScope,
    effective_sync_floor: effectiveSyncFloor(state.last_sync_at, state.enabled_at),
    next_sync_at: nextSyncAt(state),
    pending_count: readPendingEntries(runtimeDir).length,
    traces: [],
    reused_pending: false
  };
}
function okTickResult(status, state, currentScope, runtimeDir, traces = [], reusedPending = false) {
  return {
    status,
    state,
    current_scope: currentScope,
    effective_sync_floor: effectiveSyncFloor(state.last_sync_at, state.enabled_at),
    next_sync_at: nextSyncAt(state),
    pending_count: readPendingEntries(runtimeDir).length,
    traces,
    reused_pending: reusedPending
  };
}
function resetForScopeChange(state, currentScope) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...state,
    enabled_at: now,
    last_sync_at: null,
    last_sync_count: 0,
    scope: currentScope
  };
}
function getAutoSyncStatus(configPath, statePath, runtimeDir = defaultAutoSyncRuntimeDir()) {
  const state = loadAutoSyncState(statePath, runtimeDir);
  const currentScope = deriveScopeFromConfig(loadConfig(configPath), state.scope);
  return {
    status: "ok",
    state,
    current_scope: currentScope,
    scope_changed: !scopesEqual(state.scope, currentScope),
    effective_sync_floor: effectiveSyncFloor(state.last_sync_at, state.enabled_at),
    next_sync_at: nextSyncAt(state),
    pending_count: readPendingEntries(runtimeDir).length
  };
}
async function enableAutoSync(configPath, statePath, options, runtimeDir = defaultAutoSyncRuntimeDir()) {
  const source = await resolveSourceForPolling(configPath);
  const current = loadAutoSyncState(statePath, runtimeDir);
  const scopeChanged = !scopesEqual(current.scope, source.scope);
  const next = {
    ...current,
    enabled: true,
    poll_interval_minutes: options.poll_interval_minutes !== void 0 ? validatePollIntervalMinutes(options.poll_interval_minutes) : current.poll_interval_minutes,
    sampling_rate: options.sampling_rate !== void 0 ? validateSamplingRate(options.sampling_rate) : current.sampling_rate,
    last_error: null,
    last_error_at: null,
    consecutive_errors: 0,
    loop_task_id: options.loop_task_id ?? current.loop_task_id,
    scope: source.scope
  };
  next.enabled_at = (/* @__PURE__ */ new Date()).toISOString();
  if (!current.enabled || scopeChanged) {
    clearRuntimeWork(runtimeDir);
    next.last_sync_at = null;
    next.last_sync_count = 0;
  }
  saveAutoSyncState(statePath, runtimeDir, next);
  return {
    status: "ok",
    state: next,
    current_scope: source.scope,
    scope_changed: scopeChanged
  };
}
function disableAutoSync(statePath, runtimeDir = defaultAutoSyncRuntimeDir()) {
  clearRuntimeWork(runtimeDir);
  const next = {
    ...loadAutoSyncState(statePath, runtimeDir),
    enabled: false,
    enabled_at: null,
    last_sync_at: null,
    last_sync_count: 0,
    last_error: null,
    last_error_at: null,
    consecutive_errors: 0,
    loop_task_id: null,
    scope: null
  };
  saveAutoSyncState(statePath, runtimeDir, next);
  return { status: "ok", state: next };
}
function completeAutoSyncTrace(runtimeDir, traceHash) {
  markProcessed(runtimeDir, traceHash);
  removePendingEntry(runtimeDir, traceHash);
  return {
    status: "ok",
    trace_hash: traceHash,
    pending_count: readPendingEntries(runtimeDir).length
  };
}
function baseLangfuseUrl(host) {
  return (host || "https://cloud.langfuse.com").replace(/\/+$/, "");
}
function appendUnprocessedCandidates(pageItems, candidates, runtimeDir, getTraceHash) {
  for (const item of pageItems) {
    if (isProcessed(runtimeDir, getTraceHash(item))) continue;
    candidates.push(item);
    if (candidates.length >= MAX_FETCH_PER_TICK) return false;
  }
  return true;
}
async function fetchAndStageLangsmith(source, state, runtimeDir) {
  const client = new LangSmithClient();
  const syncStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  const syncFloor = effectiveSyncFloor(state.last_sync_at, state.enabled_at);
  const candidates = [];
  await client.fetchRootRunsPaginated(source.apiKey, source.projectName, syncFloor, async (pageRuns) => {
    return appendUnprocessedCandidates(pageRuns, candidates, runtimeDir, (run) => computeTraceHash2(run.id));
  });
  if (candidates.length === 0) {
    return { staged: [], earliestSkippedTimestamp: null, syncStartedAt, fetchedCount: 0, firstError: null };
  }
  const sampled = applySampling(candidates, state.sampling_rate);
  const staged = [];
  let earliestSkippedTimestamp = null;
  let retryableFailureCount = 0;
  let firstError = null;
  const sourceBaseUrl = source.tenantId ? `https://smith.langchain.com/o/${source.tenantId}/projects/p/${source.projectId}` : null;
  for (const run of sampled) {
    try {
      const traceHash = computeTraceHash2(run.id);
      const allRuns = await client.fetchTraceRuns(source.apiKey, run.trace_id);
      const otel = convertRunsToOtel(allRuns);
      const filePath = stagedTracePath(runtimeDir, traceHash);
      const entry = {
        trace_hash: traceHash,
        source: "langsmith",
        source_id: run.id,
        display_name: run.name ?? null,
        source_timestamp: run.start_time,
        source_url: sourceBaseUrl ? `${sourceBaseUrl}/r/${run.id}` : null,
        file_path: filePath,
        staged_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      writePendingEntry(runtimeDir, entry, otel);
      staged.push(entry);
    } catch (err) {
      retryableFailureCount += 1;
      if (!firstError) firstError = err?.message ?? "Unknown staging error";
      if (!earliestSkippedTimestamp || run.start_time < earliestSkippedTimestamp) {
        earliestSkippedTimestamp = run.start_time;
      }
    }
  }
  return {
    staged,
    earliestSkippedTimestamp,
    syncStartedAt,
    fetchedCount: staged.length + retryableFailureCount,
    firstError
  };
}
async function fetchAndStageLangfuse(source, state, runtimeDir) {
  const client = new LangfuseClient();
  const syncStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  const syncFloor = effectiveSyncFloor(state.last_sync_at, state.enabled_at);
  const candidates = [];
  await client.fetchTracesPaginated(source.publicKey, source.secretKey, source.host, syncFloor, async (pageTraces) => {
    return appendUnprocessedCandidates(pageTraces, candidates, runtimeDir, (trace) => computeTraceHash(trace.id));
  });
  if (candidates.length === 0) {
    return { staged: [], earliestSkippedTimestamp: null, syncStartedAt, fetchedCount: 0, firstError: null };
  }
  const sampled = applySampling(candidates, state.sampling_rate);
  const staged = [];
  let earliestSkippedTimestamp = null;
  let retryableFailureCount = 0;
  let firstError = null;
  const baseUrl = baseLangfuseUrl(source.host);
  for (const summary of sampled) {
    try {
      const traceHash = computeTraceHash(summary.id);
      const trace = await client.fetchTrace(source.publicKey, source.secretKey, summary.id, source.host ?? void 0);
      const observations = trace.observations ?? [];
      if (observations.length === 0) {
        markProcessed(runtimeDir, traceHash);
        continue;
      }
      const otel = convertObservationsToOtel(trace.id, trace.name, observations);
      const filePath = stagedTracePath(runtimeDir, traceHash);
      const entry = {
        trace_hash: traceHash,
        source: "langfuse",
        source_id: trace.id,
        display_name: trace.name ?? null,
        source_timestamp: trace.timestamp,
        source_url: source.projectId ? `${baseUrl}/project/${source.projectId}/traces/${trace.id}` : `${baseUrl}/traces/${trace.id}`,
        file_path: filePath,
        staged_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      writePendingEntry(runtimeDir, entry, otel);
      staged.push(entry);
    } catch (err) {
      retryableFailureCount += 1;
      if (!firstError) firstError = err?.message ?? "Unknown staging error";
      if (!earliestSkippedTimestamp || summary.timestamp < earliestSkippedTimestamp) {
        earliestSkippedTimestamp = summary.timestamp;
      }
    }
  }
  return {
    staged,
    earliestSkippedTimestamp,
    syncStartedAt,
    fetchedCount: staged.length + retryableFailureCount,
    firstError
  };
}
async function runAutoSyncTick(configPath, statePath, runtimeDir = defaultAutoSyncRuntimeDir()) {
  const config = loadConfig(configPath);
  if (!config) {
    return configMissingResult(statePath, runtimeDir);
  }
  let state = loadAutoSyncState(statePath, runtimeDir);
  let currentScope = deriveScopeFromConfig(config, state.scope);
  if (!state.enabled) {
    return okTickResult("disabled", state, currentScope, runtimeDir);
  }
  if (!tryAcquireLock(runtimeDir)) {
    return okTickResult("locked", state, currentScope, runtimeDir);
  }
  try {
    if (currentScope && !scopesEqual(state.scope, currentScope)) {
      clearRuntimeWork(runtimeDir);
      state = resetForScopeChange(state, currentScope);
      saveAutoSyncState(statePath, runtimeDir, state);
    }
    const pending = readPendingEntries(runtimeDir);
    if (pending.length > 0) {
      state = {
        ...state,
        last_sync_count: pending.length,
        last_error: null,
        last_error_at: null,
        consecutive_errors: 0
      };
      saveAutoSyncState(statePath, runtimeDir, state);
      return okTickResult("traces_ready", state, currentScope, runtimeDir, pending, true);
    }
    const nextAt = nextSyncAt(state);
    if (nextAt && Date.now() < new Date(nextAt).getTime()) {
      return okTickResult("not_due", state, currentScope, runtimeDir);
    }
    const source = await resolveSourceForPolling(configPath);
    currentScope = source.scope;
    if (!scopesEqual(state.scope, currentScope)) {
      clearRuntimeWork(runtimeDir);
      state = resetForScopeChange(state, currentScope);
      saveAutoSyncState(statePath, runtimeDir, state);
    }
    const result = source.source === "langsmith" ? await fetchAndStageLangsmith(source, state, runtimeDir) : await fetchAndStageLangfuse(source, state, runtimeDir);
    if (result.fetchedCount === 0) {
      state = {
        ...state,
        scope: currentScope,
        last_sync_at: result.syncStartedAt,
        last_sync_count: 0,
        last_error: null,
        last_error_at: null,
        consecutive_errors: 0
      };
      saveAutoSyncState(statePath, runtimeDir, state);
      return okTickResult("no_new_traces", state, currentScope, runtimeDir);
    }
    if (result.staged.length === 0) {
      const message = result.firstError ? `All autosync trace fetches failed: ${result.firstError}` : "All autosync trace fetches failed";
      const errored = {
        ...state,
        scope: currentScope,
        last_error: message,
        last_error_at: (/* @__PURE__ */ new Date()).toISOString(),
        consecutive_errors: state.consecutive_errors + 1
      };
      saveAutoSyncState(statePath, runtimeDir, errored);
      return errorTickResult(errored, currentScope, runtimeDir, message);
    }
    state = {
      ...state,
      scope: currentScope,
      last_sync_at: result.earliestSkippedTimestamp ?? result.syncStartedAt,
      last_sync_count: result.staged.length,
      last_error: null,
      last_error_at: null,
      consecutive_errors: 0
    };
    saveAutoSyncState(statePath, runtimeDir, state);
    return okTickResult("traces_ready", state, currentScope, runtimeDir, result.staged, false);
  } catch (err) {
    const current = loadAutoSyncState(statePath, runtimeDir);
    const errored = {
      ...current,
      scope: currentScope,
      last_error: err.message ?? "Unknown autosync error",
      last_error_at: (/* @__PURE__ */ new Date()).toISOString(),
      consecutive_errors: current.consecutive_errors + 1
    };
    saveAutoSyncState(statePath, runtimeDir, errored);
    return errorTickResult(errored, currentScope, runtimeDir, errored.last_error ?? "Unknown autosync error");
  } finally {
    releaseLock(runtimeDir);
  }
}

// packages/core/src/trace-importer/cli/autosync.ts
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = "";
    }
  }
  return args;
}
function required(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`--${key} is required`);
  }
  return value;
}
async function main() {
  const [, , subcommand] = process.argv;
  const args = parseArgs(process.argv);
  const configPath = args.config || ".self-care/config.json";
  const statePath = args.state || ".self-care/autosync.json";
  const runtimeDir = args["runtime-dir"] || defaultAutoSyncRuntimeDir();
  if (!subcommand || !["status", "enable", "disable", "tick", "complete"].includes(subcommand)) {
    console.error("Usage: autosync.ts <status|enable|disable|tick|complete> [--config path] [--state path] [--runtime-dir path]");
    process.exit(1);
  }
  if (subcommand === "status") {
    console.log(JSON.stringify(getAutoSyncStatus(configPath, statePath, runtimeDir), null, 2));
    return;
  }
  if (subcommand === "enable") {
    const result = await enableAutoSync(
      configPath,
      statePath,
      {
        poll_interval_minutes: args["poll-interval-minutes"] ? Number(args["poll-interval-minutes"]) : void 0,
        sampling_rate: args["sampling-rate"] ? Number(args["sampling-rate"]) : void 0,
        loop_task_id: args["loop-task-id"] || null
      },
      runtimeDir
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subcommand === "disable") {
    console.log(JSON.stringify(disableAutoSync(statePath, runtimeDir), null, 2));
    return;
  }
  if (subcommand === "complete") {
    const traceHash = required(args, "trace-hash");
    console.log(JSON.stringify(completeAutoSyncTrace(runtimeDir, traceHash), null, 2));
    return;
  }
  console.log(JSON.stringify(await runAutoSyncTick(configPath, statePath, runtimeDir), null, 2));
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
