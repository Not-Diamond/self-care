#!/usr/bin/env node

// packages/core/src/trace-importer/converters/langsmith.ts
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

// packages/core/src/trace-importer/converters/langsmith.ts
function uuidToHex16(uuid) {
  return uuid.replace(/-/g, "").slice(0, 16);
}
function uuidToHex32(uuid) {
  const hex = uuid.replace(/-/g, "");
  return hex.padEnd(32, "0");
}
function computeTraceHash(rootRunId) {
  return createHash("sha256").update(rootRunId).digest("hex").slice(0, 16);
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

// packages/core/src/trace-importer/clients/types.ts
var MAX_RETRIES = 3;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// packages/core/src/trace-importer/clients/langsmith.ts
var LANGSMITH_API = "https://api.smith.langchain.com";
var REQUEST_DELAY_MS = 1e3;
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
      if (traces.length > 0) await sleep(REQUEST_DELAY_MS);
      const allRuns = await this.fetchTraceRuns(apiKey, rootRun.trace_id);
      const otelJson = convertRunsToOtel(allRuns);
      const traceHash = computeTraceHash(rootRun.id);
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
      if (traces.length > 0) await sleep(REQUEST_DELAY_MS);
      const allRuns = await this.fetchTraceRuns(apiKey, rootRun.trace_id);
      const otelJson = convertRunsToOtel(allRuns);
      const traceHash = computeTraceHash(rootRun.id);
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
      if (!isFirstPage) await sleep(REQUEST_DELAY_MS);
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
      if (allRuns.length > 0) await sleep(REQUEST_DELAY_MS);
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
      if (allRuns.length > 0) await sleep(REQUEST_DELAY_MS);
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

// packages/core/src/trace-importer/converters/langfuse.ts
import { createHash as createHash2 } from "node:crypto";
function toHex16(id) {
  return createHash2("md5").update(id).digest("hex").slice(0, 16);
}
function toHex32(id) {
  return createHash2("md5").update(id).digest("hex");
}
function computeTraceHash2(traceId) {
  return createHash2("sha256").update(traceId).digest("hex").slice(0, 16);
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

// packages/core/src/trace-importer/clients/langfuse.ts
var DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";
var REQUEST_DELAY_MS2 = 500;
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
      if (page > 1) await sleep(REQUEST_DELAY_MS2);
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
      if (page > 1) await sleep(REQUEST_DELAY_MS2);
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
      if (i > 0) await sleep(REQUEST_DELAY_MS2);
      const summary = listResult.traces[i];
      const trace = await this.fetchTrace(publicKey, secretKey, summary.trace_id, host);
      const observations = trace.observations ?? [];
      if (observations.length === 0) {
        skippedTraceIds.push(summary.trace_id);
        continue;
      }
      const otelJson = convertObservationsToOtel(trace.id, trace.name, observations);
      const traceHash = computeTraceHash2(trace.id);
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
      if (!isFirstPage) await sleep(REQUEST_DELAY_MS2);
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
      if (i > 0) await sleep(REQUEST_DELAY_MS2);
      const traceId = selectedTraceIds[i];
      const trace = await this.fetchTrace(publicKey, secretKey, traceId, host);
      const observations = trace.observations ?? [];
      if (observations.length === 0) {
        skippedTraceIds.push(traceId);
        continue;
      }
      const otelJson = convertObservationsToOtel(trace.id, trace.name, observations);
      const traceHash = computeTraceHash2(trace.id);
      importData.push({ trace, otelJson, traceHash });
    }
    return { traces: importData, langfuse_url_base: langfuseUrlBase, skipped_trace_ids: skippedTraceIds };
  }
};

// packages/core/src/trace-importer/cli/validate-creds.ts
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = "";
      }
    }
  }
  return args;
}
async function main() {
  const args = parseArgs(process.argv);
  const source = args.source;
  if (!source || !["langsmith", "langfuse"].includes(source)) {
    console.error("Usage: validate-creds.ts --source langsmith|langfuse [--project <name>] [--list-projects] [--host <url>]");
    process.exit(1);
  }
  if (source === "langsmith") {
    const apiKey = process.env.LANGSMITH_API_KEY;
    if (!apiKey) {
      console.error("LANGSMITH_API_KEY not set.");
      process.exit(1);
    }
    if ("list-projects" in args) {
      const client2 = new LangSmithClient();
      const projects = await client2.listProjects(apiKey);
      console.log(JSON.stringify({
        source: "langsmith",
        projects: projects.map((p) => ({
          name: p.name,
          run_count: p.run_count ?? null
        }))
      }));
      return;
    }
    const project = args.project;
    if (!project) {
      console.error("--project is required for langsmith (or use --list-projects).");
      process.exit(1);
    }
    const client = new LangSmithClient();
    const result = await client.validate(apiKey, project);
    console.log(JSON.stringify({
      valid: true,
      source: "langsmith",
      project: result.name,
      trace_count: result.run_count ?? null
    }));
  }
  if (source === "langfuse") {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) {
      console.error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must both be set.");
      process.exit(1);
    }
    const host = args.host || process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASE_URL;
    const client = new LangfuseClient();
    const result = await client.validate(publicKey, secretKey, host);
    console.log(JSON.stringify({
      valid: true,
      source: "langfuse",
      project_id: result.projectId
    }));
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
