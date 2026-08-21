import { getProviderAdapter } from "./registry.ts";
import { asAIAdapter } from "./ai_catalog.ts";
import { resolveActiveProviderChain } from "./resolver.ts";
import { recordUsage, recordCost } from "../logging.ts";
import { getObsCtx } from "../observability/index.ts";
import type {
  AdapterRuntime,
  AIProviderAdapter,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderContext,
  ProviderResult,
  RetryPolicy,
  StreamResult,
} from "./types.ts";

// Standard retry policy: up to 3 attempts with exponential backoff. Auth and
// permanent client errors are never retried; transient/network errors are.
export const DEFAULT_RETRY: RetryPolicy = {
  max_attempts: 3,
  base_delay_ms: 400,
  max_delay_ms: 4000,
  retryable: (code?: string) =>
    !["INVALID_KEY", "AUTH_ERROR", "BAD_REQUEST", "NO_CREDENTIALS", "QUOTA_EXCEEDED", "NOT_SUPPORTED", "CONTENT_FILTERED"].includes(code || ""),
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isAIProvider(p: any): boolean {
  try {
    return Boolean(asAIAdapter(getProviderAdapter(p.adapter_key)));
  } catch {
    return false;
  }
}

export async function buildProviderContext(
  base44: any,
  secretsGet: (name: string) => string | undefined,
  provider: any
): Promise<ProviderContext> {
  const creds = await base44.asServiceRole.entities.ProviderCredential.filter({ provider_id: provider.id });
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) {
    for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) {
      if (!name) continue;
      try {
        const v = secretsGet(name);
        if (v !== undefined) credentials[name] = v;
      } catch {}
    }
  }
  return {
    providerId: provider.id,
    providerKey: provider.key,
    category: provider.category,
    environment: provider.environment,
    adapterConfig: provider.adapter_config || {},
    credentials,
    requestId: crypto.randomUUID(),
  };
}

async function withRetry<T>(
  exec: () => Promise<ProviderResult<T>>,
  policy: RetryPolicy,
  onAttempt?: (info: { attempt: number; result: ProviderResult<T>; willRetry: boolean; backoffMs: number; retryable: boolean }) => void
): Promise<{ result: ProviderResult<T>; attempts: number }> {
  let last: ProviderResult<T> | null = null;
  let a = 0;
  while (a < policy.max_attempts) {
    a++;
    last = await exec();
    const retryable = !last.success && policy.retryable(last.error_code);
    const willRetry = retryable && a < policy.max_attempts;
    const backoffMs = willRetry ? Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (a - 1)) : 0;
    if (onAttempt) { try { onAttempt({ attempt: a, result: last, willRetry, backoffMs, retryable }); } catch {} }
    if (last.success || !retryable) return { result: last, attempts: a };
    if (willRetry) await sleep(backoffMs);
  }
  return { result: last as ProviderResult<T>, attempts: a };
}

interface AttemptLog {
  provider_id: string;
  provider_key: string;
  attempts: number;
  success: boolean;
  error_code?: string;
  error_message?: string;
  latency_ms?: number;
}

export interface AIExecutionResult<T> {
  provider_id: string | null;
  provider_key: string | null;
  resolution_level: string;
  attempts: number;
  tried: AttemptLog[];
  result: ProviderResult<T>;
  total_latency_ms: number;
  // Truthful usage telemetry, surfaced so callers (Agent Runtime / factory adapters)
  // can record token usage + cost on AIExecution without re-deriving. Populated on the
  // successful attempt; left undefined on failure paths.
  tokens?: { prompt_tokens: number; completion_tokens: number };
  estimated_cost?: number;
  currency?: string;
}

async function failoverCandidates(base44: any, tenant_id?: string): Promise<{ ordered: any[]; level: string }> {
  const svc = base44.asServiceRole;
  const resolved = await resolveActiveProviderChain(base44, "ai", tenant_id);
  const all = await svc.entities.Provider.filter({ category: "ai", enabled: true });
  const seen = new Set<string>();
  const ordered: any[] = [];
  const consider = (p: any) => {
    if (!p || seen.has(p.id) || !p.enabled) return;
    if (!isAIProvider(p)) return;
    seen.add(p.id);
    ordered.push(p);
  };
  if (resolved.provider) consider(resolved.provider);
  for (const p of all) consider(p);
  return { ordered, level: resolved.level };
}

async function runWithFailover<T>(
  base44: any,
  secretsGet: (n: string) => string | undefined,
  runtime: AdapterRuntime,
  opts: { tenant_id?: string; business_id?: string | undefined; operation: "chat" | "embeddings"; request: any; retryPolicy?: RetryPolicy },
  exec: (ai: AIProviderAdapter, ctx: ProviderContext) => Promise<ProviderResult<T>>,
  tokensOf: (data: T) => { prompt_tokens: number; completion_tokens: number },
  modelOf: (data: T) => string
): Promise<AIExecutionResult<T>> {
  const start = Date.now();
  const { ordered, level } = await failoverCandidates(base44, opts.tenant_id);
  const tried: AttemptLog[] = [];
  const policy = opts.retryPolicy || DEFAULT_RETRY;
  const octx: any = await getObsCtx();
  let globalAttempt = 0;

  for (const provider of ordered) {
    const ctx = await buildProviderContext(base44, secretsGet, provider);
    const ai = asAIAdapter(getProviderAdapter(provider.adapter_key)) as AIProviderAdapter;
    const { result, attempts } = await withRetry(() => exec(ai, ctx), policy, ({ attempt, result: ra, willRetry, backoffMs }) => {
      if (octx && octx.service && octx.traceId) {
        let cost: { estimated_amount: number; currency: string } | null = null;
        try { if (ra.success && ra.data && (ai as any).estimateCost) cost = (ai as any).estimateCost(modelOf(ra.data), tokensOf(ra.data)); } catch {}
        try {
          const u = ra.success && ra.data ? tokensOf(ra.data) : { prompt_tokens: 0, completion_tokens: 0 };
          octx.service.recordGeneration({
            parentObservationId: octx.parentObservationId || null,
            name: `${opts.operation}:${provider.key}#${attempt}`,
            provider: provider.key, providerId: provider.id, adapterKey: provider.adapter_key,
            model: ra.success && ra.data ? modelOf(ra.data) : (opts.request?.model || ""),
            attempt: ++globalAttempt, success: ra.success,
            tokens: { prompt: u.prompt_tokens, completion: u.completion_tokens, total: u.prompt_tokens + u.completion_tokens },
            estimatedCost: cost?.estimated_amount, currency: cost?.currency,
            latencyMs: (ra.data as any)?.latency_ms,
            errorCode: ra.success ? undefined : ra.error_code, errorMessage: ra.success ? undefined : ra.error_message,
            retryable: ra.retryable, requestId: ra.request_id,
            metadata: { provider_attempt: attempt, will_retry: willRetry, backoff_ms: backoffMs, run_id: octx.run_id || null, task_id: octx.task_id || null, tenant_id: opts.tenant_id ?? null, business_id: opts.business_id ?? null },
          });
        } catch {}
      }
    });
    const usage = result.success && result.data ? tokensOf(result.data) : { prompt_tokens: 0, completion_tokens: 0 };
    let cost: { estimated_amount: number; currency: string } | null = null;
    await recordUsage(base44, {
      tenant_id: opts.tenant_id ?? null,
      business_id: opts.business_id ?? null,
      provider_id: provider.id,
      service: "ai",
      operation: opts.operation,
      usage_quantity: usage.prompt_tokens + usage.completion_tokens,
      usage_unit: "tokens",
      provider_request_id: result.request_id,
      success: result.success,
      kind: result.success ? "production_operation" : "failed_operation",
    });
    if (result.success && result.data) {
      cost = ai.estimateCost ? ai.estimateCost(modelOf(result.data), usage) : null;
      if (cost && cost.estimated_amount > 0) {
        await recordCost(base44, {
          tenant_id: opts.tenant_id ?? null,
          business_id: opts.business_id ?? null,
          provider_id: provider.id,
          service: "ai",
          operation: opts.operation,
          estimated_amount: cost.estimated_amount,
          currency: cost.currency,
        });
      }
    }
    tried.push({ provider_id: provider.id, provider_key: provider.key, attempts, success: result.success, error_code: result.error_code, error_message: result.error_message, latency_ms: (result.data as any)?.latency_ms });
    if (result.success) {
      return { provider_id: provider.id, provider_key: provider.key, resolution_level: level, attempts: tried.reduce((n, t) => n + t.attempts, 0), tried, result, total_latency_ms: Date.now() - start, tokens: usage, estimated_cost: cost?.estimated_amount || 0, currency: cost?.currency || "USD" };
    }
  }

  const total_attempts = tried.reduce((n, t) => n + t.attempts, 0);
  const fail: ProviderResult<T> = {
    success: false,
    provider: { providerId: null, key: null, category: "ai" },
    operation: opts.operation,
    request_id: crypto.randomUUID(),
    error_code: "NO_PROVIDER",
    error_message: ordered.length ? "All candidate AI providers failed." : "No AI provider configured or enabled.",
    retryable: false,
  };
  return { provider_id: null, provider_key: null, resolution_level: level, attempts: total_attempts, tried, result: fail, total_latency_ms: Date.now() - start, tokens: { prompt_tokens: 0, completion_tokens: 0 }, estimated_cost: 0, currency: "" };
}

export async function executeAIChat(
  base44: any,
  secretsGet: (n: string) => string | undefined,
  runtime: AdapterRuntime,
  opts: { tenant_id?: string; business_id?: string; request: ChatRequest; retryPolicy?: RetryPolicy }
): Promise<AIExecutionResult<ChatResponse>> {
  return runWithFailover<ChatResponse>(
    base44, secretsGet, runtime, { ...opts, operation: "chat" },
    (ai, ctx) => ai.chat(ctx, runtime, opts.request),
    (d) => d.usage,
    (d) => d.model
  );
}

export async function executeAIEmbeddings(
  base44: any,
  secretsGet: (n: string) => string | undefined,
  runtime: AdapterRuntime,
  opts: { tenant_id?: string; business_id?: string; request: EmbeddingRequest; retryPolicy?: RetryPolicy }
): Promise<AIExecutionResult<EmbeddingResponse>> {
  return runWithFailover<EmbeddingResponse>(
    base44, secretsGet, runtime, { ...opts, operation: "embeddings" },
    (ai, ctx) => (ai.embeddings ? ai.embeddings(ctx, runtime, opts.request) : Promise.resolve({
      success: false,
      provider: { providerId: ctx.providerId, key: ctx.providerKey, category: ctx.category },
      operation: "embeddings",
      request_id: ctx.requestId,
      error_code: "NOT_SUPPORTED",
      error_message: "Provider does not support embeddings.",
      retryable: false,
    } as ProviderResult<EmbeddingResponse>)),
    (d) => d.usage,
    (d) => d.model
  );
}

// Run any single-provider adapter method (models/health/validateKey/stream) outside failover.
export async function runOnProvider(
  base44: any,
  secretsGet: (n: string) => string | undefined,
  runtime: AdapterRuntime,
  provider: any,
  fn: (ai: AIProviderAdapter, ctx: ProviderContext) => Promise<ProviderResult<any>>
): Promise<{ ctx: ProviderContext; result: ProviderResult<any> }> {
  const ctx = await buildProviderContext(base44, secretsGet, provider);
  const ai = asAIAdapter(getProviderAdapter(provider.adapter_key)) as AIProviderAdapter;
  return { ctx, result: await fn(ai, ctx) };
}