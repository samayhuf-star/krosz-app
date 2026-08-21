// Langfuse Observability — a single, provider-neutral abstraction.
//
// Responsibilities:
//   - start a trace (one business/run execution)
//   - create spans (orchestrator/workflow/launch_task/tool)
//   - create generation observations (per real AI attempt)
//   - record errors / status / latency
//   - batched flush to the Langfuse HTTP ingestion API
//
// Design rules (see Phase 12.6):
//   - Observability ONLY. Never replaces AIExecution/UsageLog/CostLog.
//   - Failure isolation: every method is best-effort; flush is bounded by a
//     short timeout and never throws to the caller. Langfuse being down must
//     not break business execution.
//   - Sampling: rate-based, but errors/failed executions are always emitted.
//   - Privacy: prompt/response bodies are sent only when the capture flags are
//     on; metadata (correlation ids, provider, model, tokens, cost, latency,
//     status, error codes) is always sent. Secrets are scrubbed from any
//     metadata/input that reaches the buffer.
//   - Self-host support: LANGFUSE_BASE_URL points at any Langfuse instance.
//
// Context propagation: an obs-context ({service, traceId, parentObservationId})
// is propagated to the Provider Runtime via AsyncLocalStorage (set by
// dispatchTask around the adapter call, and by the playground around
// executeAIChat). If AsyncLocalStorage is unavailable, a module-global fallback
// is used (correct for single-task-parallel-subcall flows; best-effort under
// concurrent tasks). This avoids editing every factory adapter.

import { secrets } from "base44:runtime";

const uuid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------- AsyncLocalStorage with graceful fallback ----------------
let _ALS: any = null;
let _alsTried = false;
async function getALS(): Promise<any> {
  if (_alsTried) return _ALS;
  _alsTried = true;
  try {
    const m: any = await import("node:async_hooks");
    if (m && m.AsyncLocalStorage) _ALS = new m.AsyncLocalStorage();
  } catch {
    _ALS = null;
  }
  return _ALS;
}
let _globalObsCtx: any = null;
export async function setObsCtx<T>(ctx: any, fn: () => Promise<T>): Promise<T> {
  const als = await getALS();
  if (als) return als.run(ctx, fn);
  const prev = _globalObsCtx;
  _globalObsCtx = ctx;
  try {
    return await fn();
  } finally {
    _globalObsCtx = prev;
  }
}
export async function getObsCtx(): Promise<any> {
  const als = await getALS();
  if (als) {
    const v = als.getStore();
    return v || null;
  }
  return _globalObsCtx;
}
export async function hasAsyncLocalStorage(): Promise<boolean> {
  const als = await getALS();
  return !!als;
}

// ---------------- Config (from the secrets store = env-var equivalent) ----------------
export interface ObsConfig {
  enabled: boolean;
  configured: boolean;
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  sampleRate: number;
  captureInput: boolean;
  captureOutput: boolean;
}
export function getObsConfig(): ObsConfig {
  const g = (n: string): string | undefined => {
    try { return secrets.get(n); } catch { return undefined; }
  };
  const s = (n: string, d: string): string => {
    const v = g(n);
    return v == null || v === "" ? d : String(v);
  };
  const b = (n: string, d: boolean): boolean => {
    const v = g(n);
    if (v == null || v === "") return d;
    return String(v).toLowerCase() === "true";
  };
  const num = (n: string, d: number): number => {
    const v = g(n);
    const p = parseFloat(v == null ? "" : String(v));
    return isNaN(p) ? d : p;
  };
  const publicKey = s("LANGFUSE_PUBLIC_KEY", "");
  const secretKey = s("LANGFUSE_SECRET_KEY", "");
  const baseUrl = s("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").replace(/\/+$/, "");
  const configured = !!(publicKey && secretKey);
  return {
    configured,
    enabled: b("LANGFUSE_ENABLED", true) && configured,
    publicKey,
    secretKey,
    baseUrl,
    sampleRate: Math.min(1, Math.max(0, num("LANGFUSE_SAMPLE_RATE", 1.0))),
    captureInput: b("LANGFUSE_CAPTURE_INPUT", false),
    captureOutput: b("LANGFUSE_CAPTURE_OUTPUT", false),
  };
}

// ---------------- Privacy: scrub secrets + cap size ----------------
const SECRET_KEY_RE = /key|secret|token|password|authorization|credential|cookie|api/i;
function scrub(v: any, depth = 0): any {
  if (v == null || typeof v !== "object") return v;
  if (depth > 5) return "[truncated]";
  const out: any = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = "[redacted]"; continue; }
    try { out[k] = scrub(v[k], depth + 1); } catch { out[k] = "[unserializable]"; }
  }
  return out;
}
function capStr(v: any, n = 4000): any {
  if (typeof v === "string" && v.length > n) return v.slice(0, n) + "…[truncated]";
  return v;
}
function safeInput(v: any, capture: boolean): any {
  if (!capture || v == null) return undefined;
  return capStr(typeof v === "string" ? v : JSON.stringify(v));
}

// ---------------- ObservabilityService ----------------
export interface SpanHandle { id: string; name: string; startTime: string; }

export class ObservabilityService {
  cfg: ObsConfig;
  traceId: string;
  startTime: string;
  meta: any;
  events: any[] = [];
  hasError = false;
  sampledOut = false;
  flushResult: any = null;

  constructor(cfg: ObsConfig, meta: any) {
    this.cfg = cfg;
    this.meta = meta || {};
    this.traceId = uuid();
    this.startTime = new Date().toISOString();
  }

  startTrace(name: string, meta?: any): void {
    this.events.push({
      id: uuid(),
      type: "trace-create",
      timestamp: new Date().toISOString(),
      body: {
        id: this.traceId,
        name,
        timestamp: this.startTime,
        sessionId: this.meta.run_id || undefined,
        userId: this.meta.tenant_id || undefined,
        metadata: scrub({ ...this.meta, ...(meta || {}) }),
        tags: [this.meta.kind || "orchestrator"],
      },
    });
  }

  startSpan(opts: { name: string; parentObservationId?: string | null; metadata?: any; startTime?: string }): SpanHandle {
    const id = uuid();
    const st = opts.startTime || new Date().toISOString();
    this.events.push({
      id: uuid(),
      type: "span-create",
      timestamp: new Date().toISOString(),
      body: {
        id,
        traceId: this.traceId,
        parentObservationId: opts.parentObservationId || null,
        name: opts.name,
        startTime: st,
        metadata: scrub(opts.metadata || {}),
      },
    });
    return { id, name: opts.name, startTime: st };
  }

  endSpan(h: SpanHandle | null, opts?: { endTime?: string; status?: string; error?: any; metadata?: any }): void {
    if (!h) return;
    if (opts?.error) this.hasError = true;
    const level = opts?.error ? "ERROR" : "DEFAULT";
    this.events.push({
      id: uuid(),
      type: "span-update",
      timestamp: new Date().toISOString(),
      body: {
        traceId: this.traceId,
        id: h.id,
        endTime: opts?.endTime || new Date().toISOString(),
        level,
        statusMessage: opts?.error ? String((opts.error as any)?.message || (opts.error as any)?.code || "failed") : undefined,
        metadata: scrub(opts?.metadata || {}) || undefined,
      },
    });
  }

  recordGeneration(opts: {
    parentObservationId?: string | null;
    name: string;
    provider?: string;
    providerId?: string;
    adapterKey?: string;
    model?: string;
    attempt: number;
    success: boolean;
    tokens?: { prompt?: number; completion?: number; total?: number };
    estimatedCost?: number;
    currency?: string;
    latencyMs?: number;
    errorCode?: string;
    errorMessage?: string;
    retryable?: boolean;
    requestId?: string;
    input?: any;
    output?: any;
    metadata?: any;
    startTime?: string;
    endTime?: string;
  }): string {
    if (!opts.success) this.hasError = true;
    const id = uuid();
    const st = opts.startTime || new Date().toISOString();
    const et = opts.endTime || new Date().toISOString();
    const usage = opts.tokens
      ? {
          promptTokens: opts.tokens.prompt || 0,
          completionTokens: opts.tokens.completion || 0,
          totalTokens: opts.tokens.total || ((opts.tokens.prompt || 0) + (opts.tokens.completion || 0)),
        }
      : undefined;
    const body: any = {
      id,
      traceId: this.traceId,
      parentObservationId: opts.parentObservationId || null,
      name: opts.name,
      startTime: st,
      endTime: et,
      model: opts.model || undefined,
      usage,
      metadata: scrub({
        provider: opts.provider,
        provider_id: opts.providerId,
        adapter_key: opts.adapterKey,
        model: opts.model,
        attempt: opts.attempt,
        success: opts.success,
        retryable: opts.retryable,
        request_id: opts.requestId,
        estimated_cost: opts.estimatedCost,
        currency: opts.currency,
        latency_ms: opts.latencyMs,
        error_code: opts.errorCode,
        ...(opts.metadata || {}),
      }) || undefined,
      level: opts.success ? "DEFAULT" : "ERROR",
      statusMessage: opts.success ? undefined : String(opts.errorMessage || opts.errorCode || "failed"),
    };
    const inp = safeInput(opts.input, this.cfg.captureInput);
    if (inp !== undefined) body.input = inp;
    const outp = safeInput(opts.output, this.cfg.captureOutput);
    if (outp !== undefined) body.output = outp;
    this.events.push({ id: uuid(), type: "generation-create", timestamp: new Date().toISOString(), body });
    return id;
  }

  recordError(opts: { parentObservationId?: string | null; name?: string; code?: string; message?: string; component?: string; metadata?: any }): void {
    this.hasError = true;
    this.events.push({
      id: uuid(),
      type: "span-create",
      timestamp: new Date().toISOString(),
      body: {
        id: uuid(),
        traceId: this.traceId,
        parentObservationId: opts.parentObservationId || null,
        name: opts.name || "error",
        startTime: new Date().toISOString(),
        level: "ERROR",
        statusMessage: String(opts.message || opts.code || "error"),
        metadata: scrub({ error_code: opts.code, component: opts.component, ...(opts.metadata || {}) }) || undefined,
      },
    });
  }

  // Error-preserving sampling: failures always flush.
  shouldFlush(): boolean {
    if (!this.cfg.enabled) return false;
    if (this.hasError) return true;
    return Math.random() < this.cfg.sampleRate;
  }

  async flush(): Promise<{ ok: boolean; status: number; events: number; error?: string; response?: any }> {
    if (!this.events.length) {
      this.flushResult = { ok: true, status: 0, events: 0 };
      return this.flushResult;
    }
    if (!this.shouldFlush()) {
      this.sampledOut = true;
      this.flushResult = { ok: true, status: 0, events: this.events.length, error: "sampled_out" };
      return this.flushResult;
    }
    const cfg = this.cfg;
    const url = `${cfg.baseUrl}/api/public/ingestion`;
    let auth: string;
    try {
      auth = btoa(`${cfg.publicKey}:${cfg.secretKey}`);
    } catch {
      auth = `${cfg.publicKey}:${cfg.secretKey}`;
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
        body: JSON.stringify({ batch: this.events }),
        signal: controller.signal,
      });
      let data: any = null;
      try { data = await res.json(); } catch {}
      this.flushResult = { ok: res.ok, status: res.status, events: this.events.length, response: data };
      return this.flushResult;
    } catch (e: any) {
      this.flushResult = { ok: false, status: 0, events: this.events.length, error: String(e?.message || e) };
      return this.flushResult;
    } finally {
      clearTimeout(to);
    }
  }

  summary(): any {
    return {
      enabled: this.cfg.enabled,
      configured: this.cfg.configured,
      events: this.events.length,
      hasError: this.hasError,
      sampleRate: this.cfg.sampleRate,
      captureInput: this.cfg.captureInput,
      captureOutput: this.cfg.captureOutput,
      sampledOut: this.sampledOut,
      flush: this.flushResult,
    };
  }
}

// ---------------- Health (non-blocking, never affects app health) ----------------
export async function checkLangfuseHealth(cfg?: ObsConfig): Promise<{ state: "connected" | "not_configured" | "connection_failed"; detail?: string; latencyMs?: number }> {
  const c = cfg || getObsConfig();
  if (!c.configured) return { state: "not_configured" };
  const url = `${c.baseUrl}/api/public/health`;
  let auth: string;
  try { auth = btoa(`${c.publicKey}:${c.secretKey}`); } catch { auth = `${c.publicKey}:${c.secretKey}`; }
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 2500);
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { "Authorization": `Basic ${auth}` }, signal: controller.signal });
    return { state: res.ok ? "connected" : "connection_failed", detail: `HTTP ${res.status}`, latencyMs: Date.now() - t };
  } catch (e: any) {
    return { state: "connection_failed", detail: String(e?.message || e), latencyMs: Date.now() - t };
  } finally {
    clearTimeout(to);
  }
}