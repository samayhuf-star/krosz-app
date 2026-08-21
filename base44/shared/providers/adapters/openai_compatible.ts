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

// Known per-1M-token pricing used to estimate cost from token usage. Best-effort;
// unknown models estimate $0 rather than fabricating numbers.
const PRICING_PER_1M: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 5, out: 15 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "gpt-5": { in: 1.25, out: 10 },
  "o3": { in: 2, out: 8 },
  "o4-mini": { in: 1.1, out: 4.4 },
  "llama-3.3-70b": { in: 0.59, out: 0.79 },
  "claude-3-5-sonnet": { in: 3, out: 15 },
  "claude-3-5-haiku": { in: 0.8, out: 4 },
  "gemini-1.5-pro": { in: 1.25, out: 5 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
};

function priceFor(model: string) {
  const m = (model || "").toLowerCase();
  for (const k of Object.keys(PRICING_PER_1M)) {
    if (m.includes(k)) {
      const r = PRICING_PER_1M[k];
      return { input_per_1k: r.in / 1000, output_per_1k: r.out / 1000, currency: "USD" };
    }
  }
  return undefined;
}

function estimateCost(model: string, usage: { prompt_tokens: number; completion_tokens: number }) {
  const r = priceFor(model ? `${model}` : "");
  if (!r) return { estimated_amount: 0, currency: "USD" } as const;
  const amount = (usage.prompt_tokens * r.input_per_1k + usage.completion_tokens * r.output_per_1k) / 1000;
  return { estimated_amount: Math.round(amount * 1e6) / 1e6, currency: "USD" } as const;
}

function statusFromHttp(status: number, body = ""): {
  error_code?: string;
  error_message?: string;
  status?: HealthStatus;
} {
  if (status === 401 || status === 403) return { error_code: "INVALID_KEY", error_message: "Authentication failed (invalid API key).", status: "invalid_key" };
  if (status === 429) return { error_code: "RATE_LIMITED", error_message: "Rate limited by provider.", status: "rate_limited" };
  if (status === 402 || /quota|insufficient/i.test(body)) return { error_code: "QUOTA_EXCEEDED", error_message: "Quota exceeded.", status: "quota_exceeded" };
  if (status >= 500) return { error_code: "PROVIDER_ERROR", error_message: `Provider error ${status}.`, status: "unhealthy" };
  if (status === 400) return { error_code: "BAD_REQUEST", error_message: "Bad request rejected by provider.", status: "unhealthy" };
  if (status >= 404) return { error_code: `HTTP_${status}`, error_message: `HTTP ${status}`, status: "unhealthy" };
  return {};
}

interface Spec {
  key: string;
  displayName: string;
  default_base_url: string;
  api_key_secret_name: string;
  default_model: string;
  capabilities: CapabilityMatrix;
  is_ollama?: boolean;
}

function firstCred(ctx: ProviderContext): string | undefined {
  const vals = Object.values(ctx.credentials || {});
  return vals.find((v) => Boolean(v));
}

function makeAdapter(spec: Spec): AIProviderAdapter {
  const baseUrl = (ctx: ProviderContext) => ((ctx.adapterConfig?.base_url as string) || spec.default_base_url);
  const headers = (ctx: ProviderContext) => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const k = firstCred(ctx);
    if (k) h["Authorization"] = `Bearer ${k}`;
    if (ctx.adapterConfig?.api_version) h["api-version"] = ctx.adapterConfig.api_version as string;
    return h;
  };

  const adapter: AIProviderAdapter = {
    key: spec.key,
    displayName: spec.displayName,
    category: "ai",
    capabilities: spec.capabilities,
    defaultModel: spec.default_model,
    credentialSchema: spec.is_ollama
      ? []
      : [{ name: spec.api_key_secret_name, displayName: `${spec.displayName} API key`, required: true }],

    async chat(ctx, runtime, req): Promise<ProviderResult<ChatResponse>> {
      const started = Date.now();
      const op = "chat";
      if (!firstCred(ctx) && !spec.is_ollama) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", error_message: "No API key configured for this provider.", retryable: false });
      try {
        const body: any = {
          model: req.model || spec.default_model,
          messages: (req.messages || []).map((m) => ({ role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) })),
          temperature: req.temperature ?? 0.7,
          stream: false,
        };
        if (req.max_tokens) body.max_tokens = req.max_tokens;
        if (req.tools) { body.tools = req.tools; body.tool_choice = req.tool_choice || "auto"; }
        const res = await runtime.fetchExternal(`${baseUrl(ctx)}/chat/completions`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) });
        if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
        const data = await res.json();
        const choice = data.choices?.[0] || {};
        const usage = {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? ((data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0)),
        };
        const resp: ChatResponse = {
          model: data.model || req.model || spec.default_model,
          role: "assistant",
          content: choice.message?.content || "",
          tool_calls: choice.message?.tool_calls,
          finish_reason: choice.finish_reason,
          usage,
          latency_ms: Date.now() - started,
          raw: data,
        };
        return okResult(ctx, op, resp);
      } catch (e) {
        return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Provider request failed.", retryable: true });
      }
    },

    async stream(ctx, runtime, req): Promise<ProviderResult<StreamResult>> {
      const started = Date.now();
      const op = "stream";
      if (!firstCred(ctx) && !spec.is_ollama) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
      try {
        const body: any = {
          model: req.model || spec.default_model,
          messages: (req.messages || []).map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature ?? 0.7,
          stream: true,
        };
        if (req.max_tokens) body.max_tokens = req.max_tokens;
        const res = await runtime.fetchExternal(`${baseUrl(ctx)}/chat/completions`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) });
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
              const txt = line.slice(5).trim();
              if (txt === "[DONE]") continue;
              try {
                const j = JSON.parse(txt);
                const d = j.choices?.[0]?.delta?.content;
                if (d) { content += d; chunks.push(d); }
                if (j.usage) usage = { prompt_tokens: j.usage.prompt_tokens ?? usage.prompt_tokens, completion_tokens: j.usage.completion_tokens ?? usage.completion_tokens, total_tokens: j.usage.total_tokens ?? (usage.prompt_tokens + usage.completion_tokens) };
              } catch {}
            }
          }
        } else {
          const fallback = await res.text();
          content = fallback; chunks.push(fallback);
        }
        return okResult(ctx, op, { chunks, response: { model: req.model || spec.default_model, role: "assistant", content, usage, latency_ms: Date.now() - started } });
      } catch (e) {
        return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Stream failed.", retryable: true });
      }
    },

    async embeddings(ctx, runtime, req): Promise<ProviderResult<EmbeddingResponse>> {
      const op = "embeddings";
      if (!firstCred(ctx) && !spec.is_ollama) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
      if (!spec.capabilities.embeddings) return failResult(ctx, op, { error_code: "NOT_SUPPORTED", error_message: "This adapter does not support embeddings.", retryable: false });
      try {
        const body: any = { model: req.model, input: req.input };
        if (req.dimensions) body.dimensions = req.dimensions;
        const res = await runtime.fetchExternal(`${baseUrl(ctx)}/embeddings`, { method: "POST", headers: headers(ctx), body: JSON.stringify(body) });
        if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
        const data = await res.json();
        const out: number[][] = (data.data || []).map((d: any) => d.embedding);
        return okResult(ctx, op, { model: data.model || req.model, embeddings: out, usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: 0, total_tokens: data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) } });
      } catch (e) {
        return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Embeddings failed.", retryable: true });
      }
    },

    async models(ctx, runtime): Promise<ProviderResult<ModelInfo[]>> {
      const op = "models";
      if (!firstCred(ctx) && !spec.is_ollama) return failResult(ctx, op, { error_code: "NO_CREDENTIALS", retryable: false });
      try {
        const res = await runtime.fetchExternal(`${baseUrl(ctx)}/models`, { method: "GET", headers: headers(ctx) });
        if (!res.ok) { const e = statusFromHttp(res.status, await res.text().catch(() => "")); return failResult(ctx, op, e); }
        const data = await res.json();
        const items: ModelInfo[] = (data.data || data.models || [])
          .map((m: any) => {
            const id = m.id || m.name || "";
            return {
              id,
              supports_streaming: spec.capabilities.streaming,
              supports_function_calling: spec.capabilities.function_calling,
              supports_embeddings: /embed|bge|nomic/i.test(id) || spec.capabilities.embeddings,
              pricing: id ? priceFor(id) : undefined,
            } as ModelInfo;
          })
          .filter((m) => m.id);
        return okResult(ctx, op, items);
      } catch (e) {
        return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Model list failed.", retryable: true });
      }
    },

    async health(ctx, runtime): Promise<ProviderResult<HealthStatus>> {
      const op = "health";
      if (!firstCred(ctx) && !spec.is_ollama) return okResult(ctx, op, "unconfigured" as HealthStatus);
      try {
        const res = await runtime.fetchExternal(`${baseUrl(ctx)}/models`, { method: "GET", headers: headers(ctx) });
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
      if (r.data === "healthy") return okResult(ctx, "testConnection", { message: `${spec.displayName} reports healthy.`, latencyMs: Date.now() - started });
      return failResult(ctx, "testConnection", { error_code: (String(r.data || "unhealthy")).toUpperCase(), error_message: `${spec.displayName} status: ${r.data}`, retryable: r.data === "rate_limited" || r.data === "unhealthy" });
    },

    estimateCost,
  };

  return adapter;
}

const FULL: CapabilityMatrix = { chat: true, vision: true, streaming: true, embeddings: true, function_calling: true };

registerProviderAdapter(makeAdapter({ key: "openai_compatible", displayName: "OpenAI", default_base_url: "https://api.openai.com/v1", api_key_secret_name: "OPENAI_API_KEY", default_model: "gpt-4o-mini", capabilities: FULL }));
registerProviderAdapter(makeAdapter({ key: "openai_compatible_groq", displayName: "Groq", default_base_url: "https://api.groq.com/openai/v1", api_key_secret_name: "GROQ_API_KEY", default_model: "llama-3.3-70b-versatile", capabilities: { chat: true, vision: false, streaming: true, embeddings: false, function_calling: true } }));
registerProviderAdapter(makeAdapter({ key: "openai_compatible_openrouter", displayName: "OpenRouter", default_base_url: "https://openrouter.ai/api/v1", api_key_secret_name: "OPENROUTER_API_KEY", default_model: "openai/gpt-4o-mini", capabilities: { chat: true, vision: true, streaming: true, embeddings: false, function_calling: true } }));
registerProviderAdapter(makeAdapter({ key: "openai_compatible_ollama", displayName: "Ollama (local)", default_base_url: "http://localhost:11434/v1", api_key_secret_name: "OLLAMA_API_KEY", default_model: "llama3.1", capabilities: { chat: true, vision: false, streaming: true, embeddings: true, function_calling: false }, is_ollama: true }));
registerProviderAdapter(makeAdapter({ key: "openai_compatible_azure", displayName: "Azure OpenAI", default_base_url: "https://your-resource.openai.azure.com/openai", api_key_secret_name: "AZURE_OPENAI_API_KEY", default_model: "gpt-4o-mini", capabilities: FULL }));