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

// Phase 1.2: elevated to a full AIProviderAdapter so the runtime engine can be
// verified end-to-end with REAL LLM responses through Base44's built-in Core AI
// integration — no external API keys required. This is the canonical zero-config
// provider: it always participates in failover and lets the runtime be acceptance-
// tested immediately, independent of any third-party credentials.

const CAPS: CapabilityMatrix = { chat: true, vision: false, streaming: false, embeddings: false, function_calling: false };
const DEFAULT_MODEL = "platform-core";
const PLATFORM_MODELS: ModelInfo[] = [
  { id: "platform-core", name: "Platform Core (auto)", supports_streaming: false, supports_function_calling: false, supports_embeddings: false, pricing: { input_per_1k: 0.0001, output_per_1k: 0.0001, currency: "USD" } },
];

// Naive token estimate (~4 chars/token). InvokeLLM doesn't return usage, so we
// approximate so the cost ledger still writes a non-zero, honest "estimated_amount".
function approxTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}
function foldPrompt(req: ChatRequest): string {
  const parts: string[] = [];
  for (const m of req.messages || []) {
    if (m.role === "system") parts.push(`[System instructions]\n${m.content}`);
    else if (m.role === "assistant") parts.push(`[Assistant]\n${m.content}`);
    else parts.push(m.content);
  }
  return parts.join("\n\n");
}
function estimateCost(_model: string, usage: { prompt_tokens: number; completion_tokens: number }) {
  // nominal platform rate so the cost ledger exercises a real (non-fabricated) row
  const amount = (usage.prompt_tokens + usage.completion_tokens) * (0.0001 / 1000);
  return { estimated_amount: Math.round(amount * 1e6) / 1e6, currency: "USD" } as const;
}

const adapter: AIProviderAdapter = {
  key: "ai_core_base44",
  displayName: "Base44 Core AI (built-in)",
  category: "ai",
  capabilities: CAPS,
  defaultModel: DEFAULT_MODEL,
  credentialSchema: [],

  async chat(ctx, runtime, req): Promise<ProviderResult<ChatResponse>> {
    const op = "chat";
    const started = Date.now();
    try {
      const prompt = foldPrompt(req);
      const text = (await runtime.invokeLLM(prompt, req.extra)).toString();
      const promptTokens = approxTokens(prompt);
      const completionTokens = approxTokens(text);
      return okResult(ctx, op, {
        model: DEFAULT_MODEL,
        role: "assistant",
        content: text,
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      return failResult(ctx, op, { error_code: "AI_CALL_FAILED", error_message: (e && e.message) || "Core AI call failed.", retryable: true });
    }
  },

  // No native streaming; stream aggregates the full chat response into one chunk.
  async stream(ctx, runtime, req): Promise<ProviderResult<StreamResult>> {
    const r = await adapter.chat(ctx, runtime, req);
    if (!r.success) return r as unknown as ProviderResult<StreamResult>;
    const content = (r.data as ChatResponse).content || "";
    return okResult(ctx, "stream", { chunks: [content], response: r.data as ChatResponse });
  },

  async embeddings(_ctx, _runtime, _req): Promise<ProviderResult<EmbeddingResponse>> {
    return failResult(_ctx, "embeddings", { error_code: "NOT_SUPPORTED", error_message: "Built-in Core AI does not expose embeddings.", retryable: false });
  },

  async models(_ctx, _runtime): Promise<ProviderResult<ModelInfo[]>> {
    return okResult(_ctx, "models", PLATFORM_MODELS);
  },

  async health(ctx, runtime): Promise<ProviderResult<HealthStatus>> {
    const op = "health";
    try {
      const text = (await runtime.invokeLLM("Respond with the single word: pong")).toString().trim();
      return okResult(ctx, op, (text.length > 0 ? "healthy" : "unhealthy") as HealthStatus);
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
    if (r.data === "healthy") return okResult(ctx, "testConnection", { message: "Connected — built-in AI model returned a response.", latencyMs: Date.now() - started });
    return failResult(ctx, "testConnection", { error_code: "AI_CALL_FAILED", error_message: "Built-in AI did not respond.", retryable: true });
  },

  estimateCost,
};

registerProviderAdapter(adapter);
export default adapter;