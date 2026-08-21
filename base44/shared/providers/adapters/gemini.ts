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
  EmbeddingRequest,
  EmbeddingResponse,
  ModelInfo,
  ProviderResult,
  TestConnectionData,
  HealthStatus,
} from "../types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const CAPS: CapabilityMatrix = { chat: true, vision: true, streaming: true, embeddings: true, function_calling: true };
const DEFAULT_MODEL = "gemini-2.0-flash";

const PRICING_PER_1M: Record<string, { in: number; out: number }> = {
  "gemini-1.5-pro": { in: 1.25, out: 5 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
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
function qx(ctx: ProviderContext): string {
  const k = key(ctx);
  return k ? `?key=${encodeURIComponent(k)}` : "";
}
function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}
function statusFromHttp(s: number, b = "") {
  if (s === 400 || s === 401) return { error_code: "INVALID_KEY", error_message: "Invalid Gemini API key.", status: "invalid_key" as HealthStatus };
  if (s === 429) return { error_code: "RATE_LIMITED", error_message: "Rate limited.", status: "rate_limited" as HealthStatus };
  if (/quota/i.test(b)) return { error_code: "QUOTA_EXCEEDED", error_message: "Quota exceeded.", status: "quota_exceeded" as HealthStatus };
  if (s >= 500) return { error_code: "PROVIDER_ERROR", error_message: `Provider ${s}`, status: "unhealthy" as HealthStatus };
  if (s >= 400) return { error_code: `HTTP_${s}`, error_message: `HTTP ${s}`, status: "unhealthy" as HealthStatus };
  return {};
}
function buildContents(req: ChatRequest) {
  let system = "";
  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const m of req.messages || []) {
    if (m.role === "system") system += (system ? "\n" : "") + m.content;
    else contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  return { system, contents };
}

const adapter: AIProviderAdapter = {
  key: "gemini",
  displayName: "Google Gemini",
  category: "ai",
  capabilities: CAPS,
  defaultModel: DEFAULT_MODEL,
  credentialSchema: [{ name: "GEMINI_API_KEY", displayName: "Google AI (Gemini) API key", required: true }],

  async chat(ctx, runtime, req): Promise<ProviderResult<ChatResponse>> {
    const op = "chat";
    const started = Date.now();
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", error_message: "No Gemini API key configured.", retryable: false });
    try {
      const model = req.model || DEFAULT_MODEL;
      const { system, contents } = buildContents(req);
      const body: any = { contents, generationConfig: { temperature: req.temperature ?? 0.7, ...(req.max_tokens ? { maxOutputTokens: req.max_tokens } : {}) } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (req.tools) body.tools = [{ functionDeclarations: req.tools }];
      const res = await runtime.fetchExternal(`${BASE}/models/${model}:generateContent${qx(ctx)}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const data = await res.json();
      const cand = data.candidates?.[0] || {};
      const content = (cand.content?.parts || []).map((p: any) => p.text || "").join("");
      const usage = { prompt_tokens: data.usageMetadata?.promptTokenCount || 0, completion_tokens: data.usageMetadata?.candidatesTokenCount || 0, total_tokens: data.usageMetadata?.totalTokenCount || ((data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0)) };
      return okResult(ctx, op, { model, role: "assistant", content, finish_reason: cand.finishReason, usage, latency_ms: Date.now() - started, raw: data });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Gemini call failed.", retryable: true });
    }
  },

  async stream(ctx, runtime, req): Promise<ProviderResult<StreamResult>> {
    const op = "stream";
    const started = Date.now();
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
    try {
      const model = req.model || DEFAULT_MODEL;
      const { system, contents } = buildContents(req);
      const body: any = { contents, generationConfig: { temperature: req.temperature ?? 0.7 } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const k = key(ctx);
      const sep = `alt=sse${k ? `&key=${encodeURIComponent(k)}` : ""}`;
      const res = await runtime.fetchExternal(`${BASE}/models/${model}:streamGenerateContent?${sep}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const chunks: string[] = [];
      let content = "";
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
              const txt = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
              if (txt) { content += txt; chunks.push(txt); }
            } catch {}
          }
        }
      } else {
        content = await res.text();
        chunks.push(content);
      }
      return okResult(ctx, op, { chunks, response: { model, role: "assistant", content, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, latency_ms: Date.now() - started } });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Gemini stream failed.", retryable: true });
    }
  },

  async embeddings(ctx, runtime, req): Promise<ProviderResult<EmbeddingResponse>> {
    const op = "embeddings";
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
    try {
      const model = req.model || "text-embedding-004";
      const input = Array.isArray(req.input) ? req.input : [req.input];
      const embeds: number[][] = [];
      for (const txt of input) {
        const res = await runtime.fetchExternal(`${BASE}/models/${model}:embedContent${qx(ctx)}`, { method: "POST", headers: headers(), body: JSON.stringify({ content: { parts: [{ text: txt }] }, taskType: "RETRIEVAL_DOCUMENT" }) });
        if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
        const d = await res.json();
        embeds.push(d.embedding?.values || []);
      }
      return okResult(ctx, op, { model, embeddings: embeds, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Gemini embeddings failed.", retryable: true });
    }
  },

  async models(ctx, runtime): Promise<ProviderResult<ModelInfo[]>> {
    const op = "models";
    if (!key(ctx)) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
    try {
      const res = await runtime.fetchExternal(`${BASE}/models${qx(ctx)}`, { method: "GET", headers: headers() });
      if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
      const data = await res.json();
      const items: ModelInfo[] = (data.models || [])
        .map((m: any) => {
          const id = (m.name || "").replace(/^models\//, "");
          const methods = m.supportedGenerationMethods || [];
          return { id, supports_streaming: true, supports_function_calling: methods.includes("generateContent"), supports_embeddings: methods.includes("embedContent") } as ModelInfo;
        })
        .filter((m) => m.id);
      return okResult(ctx, op, items);
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Gemini model list failed.", retryable: true });
    }
  },

  async health(ctx, runtime): Promise<ProviderResult<HealthStatus>> {
    const op = "health";
    if (!key(ctx)) return okResult(ctx, op, "unconfigured" as HealthStatus);
    try {
      const res = await runtime.fetchExternal(`${BASE}/models${qx(ctx)}`, { method: "GET", headers: headers() });
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
    if (r.data === "healthy") return okResult(ctx, "testConnection", { message: "Gemini reports healthy.", latencyMs: Date.now() - started });
    return failResult(ctx, "testConnection", { error_code: String(r.data || "unhealthy").toUpperCase(), error_message: `Gemini status: ${r.data}`, retryable: r.data === "rate_limited" || r.data === "unhealthy" });
  },

  estimateCost,
};

registerProviderAdapter(adapter);