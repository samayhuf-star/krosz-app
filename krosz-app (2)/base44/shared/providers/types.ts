export type ProviderCategory = "domain" | "email" | "phone" | "ai" | "payment" | "storage" | "other";
export type ProviderEnvironment = "sandbox" | "production";

export interface CredentialField {
  name: string;
  displayName: string;
  required: boolean;
}

export interface AdapterRuntime {
  invokeLLM(prompt: string, opts?: Record<string, unknown>): Promise<string>;
  fetchExternal(url: string, init?: RequestInit): Promise<Response>;
}

export interface ProviderContext {
  providerId: string;
  providerKey: string;
  category: ProviderCategory;
  environment: ProviderEnvironment;
  adapterConfig: Record<string, unknown>;
  credentials: Record<string, string | undefined>;
  requestId: string;
}

// The single predictable structure every adapter returns. The browser sees this only;
// secrets and raw provider payloads never leave the server.
export interface ProviderResult<T = unknown> {
  success: boolean;
  provider: { providerId: string; key: string; category: string };
  operation: string;
  request_id: string;
  data?: T;
  error_code?: string;
  error_message?: string;
  retryable?: boolean;
}

export interface TestConnectionData {
  message: string;
  latencyMs?: number;
}

export interface ProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly category: ProviderCategory;
  readonly credentialSchema: CredentialField[];
  testConnection(ctx: ProviderContext, runtime: AdapterRuntime): Promise<ProviderResult<TestConnectionData>>;
}

// ---------- Phase 1.2: Provider Runtime Engine (AI) ----------

export type HealthStatus =
  | "healthy"
  | "unhealthy"
  | "disabled"
  | "rate_limited"
  | "invalid_key"
  | "quota_exceeded"
  | "unconfigured"
  | "unknown";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: string;
  stream?: boolean;
  extra?: Record<string, unknown>;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  model: string;
  role: "assistant";
  content: string;
  tool_calls?: unknown[];
  finish_reason?: string;
  usage: TokenUsage;
  latency_ms: number;
  raw?: unknown;
}

export interface StreamResult {
  chunks: string[];
  response: ChatResponse;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
  usage: TokenUsage;
  raw?: unknown;
}

export interface ModelInfo {
  id: string;
  name?: string;
  context_window?: number;
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_streaming?: boolean;
  supports_embeddings?: boolean;
  pricing?: { input_per_1k?: number; output_per_1k?: number; currency?: string };
}

export interface CapabilityMatrix {
  chat: boolean;
  vision: boolean;
  streaming: boolean;
  embeddings: boolean;
  function_calling: boolean;
}

export interface RetryPolicy {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  retryable: (error_code?: string) => boolean;
}

export interface EstimateCostInput {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface EstimatedCost {
  estimated_amount: number;
  currency: string;
}

// A single AI runtime contract every AI provider adapter implements. Non-AI adapters
// (domain/email/phone) stay as plain ProviderAdapter and are simply ignored by the
// AI runtime — adding these members is additive and does not change Phase 1.1.
export interface AIProviderAdapter extends ProviderAdapter {
  readonly capabilities: CapabilityMatrix;
  readonly defaultModel?: string;
  chat(ctx: ProviderContext, runtime: AdapterRuntime, req: ChatRequest): Promise<ProviderResult<ChatResponse>>;
  stream?(ctx: ProviderContext, runtime: AdapterRuntime, req: ChatRequest): Promise<ProviderResult<StreamResult>>;
  embeddings?(ctx: ProviderContext, runtime: AdapterRuntime, req: EmbeddingRequest): Promise<ProviderResult<EmbeddingResponse>>;
  models(ctx: ProviderContext, runtime: AdapterRuntime): Promise<ProviderResult<ModelInfo[]>>;
  health(ctx: ProviderContext, runtime: AdapterRuntime): Promise<ProviderResult<HealthStatus>>;
  validateKey(ctx: ProviderContext, runtime: AdapterRuntime): Promise<ProviderResult<boolean>>;
  estimateCost?(model: string, usage: EstimateCostInput): EstimatedCost;
}