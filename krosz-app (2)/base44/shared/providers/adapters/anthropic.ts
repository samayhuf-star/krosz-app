import { registerProviderAdapter } from "../registry.ts";
import { okResult, failResult } from "../results.ts";
import type {
  ProviderContext,
  AdapterRuntime,
  AIProviderAdapter,
  CapabilityMatrix,
  ChatRequest,
  ChatResponse,
  StreamResult,
  ModelInfo,
  ProviderResult,
  TestConnectionData,
  HealthStatus,
} from "../types.ts";

const BASE = "https://api.anthropic.com/v1";
const CAPS: CapabilityMatrix = { chat: true, vision: true, streaming: true, embeddings: false, function_calling: true };
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";

const PRICING_PER_1M: Record<string, { in: number; out: number }> = {
  "claude-3-5-sonnet": { in: 3, out: 15 },
  "claude-3-5-haiku": { in: 0.8, out: 4 },
  "claude-3-opus": { in: 15, out: 75 },
  "claude-3-haiku": { in: 0.25, out: 1.25 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-opus-4": { in: 15, out: 75 },
};

function estimateCost(model: string, usage: { prompt_tokens: number; completion_tokens: number }) {
  const m = (model || "").toLowerCase();
  const k = Object.keys(PRICING_PER_1M).find((x) => m.includes(x));
  const r = k ? PRICING_PER_1M[k] : null;
  if (!r) return { estimated_amount: 0, currency: "USD" } as const;
  const amount = (usage.prompt_tokens * r.in + usage.completion_tokens * r.out) / 1_000_000;
  return { estimated_amount: Math.round(amount * 1e6) / 1e6, currency: "USD" } as const;
}

function key(ctx: ProviderContext): string | undefined {
  return Object.values(ctx.credentials || {}).find((v) => Boolean(v));
}
function headers(ctx: ProviderContext): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
  const k = key(ctx);
  if (k) h["x-api-key"] = k;
  return h;
}
function statusFromHttp(s: number, b = "") {
  if (s === 401 || s === 403) return { error_code: "INVALID_KEY", error_message: "Invalid Anthropic API key.", status: "invalid_key" as HealthStatus };
  if (s === 429) return { error_code: "RATE_LIMITED", error_message: "Rate limited.", status: "rate_limited" as HealthStatus };
  if (/quota/i.test(b)) return { error_code: "QUOTA_EXCEEDED", error_message: "Quota exceeded.", status: "quota_exceeded" as HealthStatus };
  if (s >= 500) return { error_code: "PROVIDER_ERROR", error_message: `Provider ${s}`, status: "unhealthy" as HealthStatus };
  if (s >= 400) return { error_code: `HTTP_${s}`, error_message: `HTTP ${s}`, status: "unhealthy" as HealthStatus };
  return {};
}
function buildMessages(req: ChatRequest) {
  let system = "";
  const msgs: { role: string; content: string }[] = [];
  for (const m of req.messages || []) {
    if (m.role === "system") system += (system ? "\n" : "") + m.content;
    else msgs.push({ role: m.role === "tool" ? "user" : m.role, content: m.content });
  }
  return { system, msgs };
}

const adapter: AIProviderAdapter = {
  key: "anthropic",
  displayName: "Anthropic Claude",
  category: "ai",
  capabilities: CAPS,
  defaultModel: DEFAULT_MODEL,
  credentialSchema: [{ name: "ANTHROPIC_API_KEY", displayName: "Anthropic API key", required: true }],

  async chat(ctx, runtime, req): Promise<ProviderResult<ChatResponse>> {
    const op = "chat";
    const started = Date.now();
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", error_message: "No Anthropic API key configured.", retryable: false });
    try {
      const { system, msgs } = buildMessages(req);
      const body: any = { model: req.model || DEFAULT_MODEL, max_tokens: req.max_tokens || 1024, messages: msgs, stream: false };
      if (system) body.system = system;
      if (req.temperature != null) body.temperature = req.temperature;
      if (req.tools) { body.tools = req.tools; if (req.tool_choice) body.tool_choice = req.tool_choice; }
      const res = await runtime.fetchExternal(`${BASE}/messages`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const data = await res.json();
      const content = (data.content || []).map((c: any) => c.text || "").join("");
      const usage = { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0, total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) };
      return okResult(ctx, op, { model: data.model || req.model || DEFAULT_MODEL, role: "assistant", content, finish_reason: data.stop_reason, usage, latency_ms: Date.now() - started, raw: data });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Anthropic call failed.", retryable: true });
    }
  },

  async stream(ctx, runtime, req): Promise<ProviderResult<StreamResult>> {
    const op = "stream";
    const started = Date.now();
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
    try {
      const { system, msgs } = buildMessages(req);
      const body: any = { model: req.model || DEFAULT_MODEL, max_tokens: req.max_tokens || 1024, messages: msgs, stream: true };
      if (system) body.system = system;
      if (req.temperature != null) body.temperature = req.temperature;
      const res = await runtime.fetchExternal(`${BASE}/messages`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const chunks: string[] = [];
      let content = "";
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const reader = (res.body as any)?.getReader?.();
      if (reader) {
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const j = JSON.parse(line.slice(5).trim());
              if (j.type === "content_block_delta" && j.delta?.text) { content += j.delta.text; chunks.push(j.delta.text); }
              if (j.message?.usage) usage = { prompt_tokens: j.message.usage.input_tokens || 0, completion_tokens: j.message.usage.output_tokens || usage.completion_tokens, total_tokens: (j.message.usage.input_tokens || 0) + (j.message.usage.output_tokens || 0) };
              if (j.usage) usage = { prompt_tokens: j.usage.input_tokens ?? usage.prompt_tokens, completion_tokens: j.usage.output_tokens ?? usage.completion_tokens, total_tokens: (j.usage.input_tokens || 0) + (j.usage.output_tokens || 0) };
            } catch {}
          }
        }
      } else {
        content = await res.text();
        chunks.push(content);
      }
      return okResult(ctx, op, { chunks, response: { model: req.model || DEFAULT_MODEL, role: "assistant", content, usage, latency_ms: Date.now() - started } });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Anthropic stream failed.", retryable: true });
    }
  },

  async models(ctx, runtime): Promise<ProviderResult<ModelInfo[]>> {
    const op = "models";
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
    try {
      const res = await runtime.fetchExternal(`${BASE}/models`, { method: "GET", headers: headers(ctx) });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const data = await res.json();
      const items = (data.data || []).map((m: any) => ({ id: m.id, supports_streaming: true, supports_function_calling: true })).filter((m: ModelInfo) => m.id);
      return okResult(ctx, op, items);
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Anthropic model list failed.", retryable: true });
    }
  },

  async health(ctx, runtime): Promise<ProviderResult<HealthStatus>> {
    const op = "health";
    if (!key(ctx)) return okResult(ctx, op, "unconfigured" as HealthStatus);
    try {
      const res = await runtime.fetchExternal(`${BASE}/models`, { method: "GET", headers: headers(ctx) });
      if (res.ok) return okResult(ctx, op, "healthy" as HealthStatus);
      const e = statusFromHttp(res.status, await res.text().catch(() => ""));
      return okResult(ctx, op, (e.status || "unhealthy") as HealthStatus);
    } catch {
      return okResult(ctx, op, "unhealthy" as HealthStatus);
    }
  },

  async validateKey(ctx, runtime): Promise<ProviderResult<boolean>> {
    const r = await adapter.health(ctx, runtime);
    return { success: true, provider: { providerId: ctx.providerId, key: ctx.providerKey, category: ctx.category }, operation: "validateKey", request_id: ctx.requestId, data: r.data === "healthy" };
  },

  async testConnection(ctx, runtime): Promise<ProviderResult<TestConnectionData>> {
    const started = Date.now();
    const r = await adapter.health(ctx, runtime);
    if (r.data === "healthy") return okResult(ctx, "testConnection", { message: "Anthropic reports healthy.", latencyMs: Date.now() - started });
    return failResult(ctx, "testConnection", { error_code: String(r.data || "unhealthy").toUpperCase(), error_message: `Anthropic status: ${r.data}`, retryable: r.data === "rate_limited" || r.data === "unhealthy" });
  },

  estimateCost,
};

registerProviderAdapter(adapter);