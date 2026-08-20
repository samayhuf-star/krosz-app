// Orchestrator Factory-Adapter Contract.
//
// ONE authoritative execution path:
//   Business → Run → Task DAG → Orchestrator → Factory Adapter → Provider Adapter
//
// A factory adapter receives the canonical ExecuteInput and returns a normalized
// ExecuteResult. Factories never invent their own result format and never bypass
// provider resolution. Domain intelligence stays inside the factory; the
// orchestrator only coordinates.

export interface ProviderRef {
  provider_id: string;
  provider_key: string;
  adapter_key: string;
  name: string;
  category: string;
  via: string;
}

export interface ExecuteInput {
  run_id: string;
  task_id: string;
  business_id: string;
  task_type: string;
  task_key: string;
  capability: string;
  input_context: any;            // immutable context snapshot (business + run + prior outputs)
  prior_task_outputs: Record<string, any>;
  provider: ProviderRef;          // the orchestrator-resolved provider for this task
  attempt: number;
  actor: string;
}

export interface ExecuteResult {
  success: boolean;
  output?: any;
  error_code?: string;
  error_detail?: string;
  retryable?: boolean;
  provider?: ProviderRef;         // the provider that actually executed (runtime-truth)
  execution_id?: string;          // last AIExecution checkpoint id
  execution_ids?: string[];        // all checkpoint ids
  completed_stage?: string;
}

export function normalizedResult(r: Partial<ExecuteResult>): ExecuteResult {
  return {
    success: !!r.success,
    output: r.output ?? null,
    error_code: r.error_code || (r.success ? "" : "FACTORY_FAILED"),
    error_detail: r.error_detail || "",
    retryable: r.retryable ?? true,
    provider: r.provider,
    execution_id: r.execution_id,
    execution_ids: r.execution_ids,
    completed_stage: r.completed_stage,
  };
}

// Build the canonical dispatch input from the orchestrator's task + context.
export function buildDispatchInput(opts: {
  run: any; task: any; context: any; resolvedProvider: any; attempt: number; actor: string;
}): ExecuteInput {
  const rp = opts.resolvedProvider || {};
  return {
    run_id: opts.run.id,
    task_id: opts.task.id,
    business_id: opts.run.business_id,
    task_type: opts.task.type,
    task_key: opts.task.task_key,
    capability: opts.task.provider_capability || "",
    input_context: opts.context || opts.task.input_context || {},
    prior_task_outputs: (opts.context && opts.context.prior_task_outputs) || {},
    provider: {
      provider_id: rp.provider_id || "",
      provider_key: rp.key || rp.provider_key || "",
      adapter_key: rp.adapter_key || "",
      name: rp.name || "",
      category: rp.category || "",
      via: rp.via || "",
    },
    attempt: opts.attempt,
    actor: opts.actor || "system",
  };
}

// Record a truthful per-stage AIExecution checkpoint. Provenance comes from the
// runtime execution (provider that actually served), never compile-time constants.
export async function recordExecution(svc: any, opts: {
  run: any; task: any; attempt: number; stage: string; operation: string;
  capability: string; provider: ProviderRef; model: string; inputHash: string;
  outputHash: string; success: boolean; errorCode?: string; errorMessage?: string;
  retryable?: boolean; durationMs: number; actor?: string; output?: any;
  tokens?: { prompt_tokens: number; completion_tokens: number };
  estimatedCost?: number;
}): Promise<string> {
  const row = await svc.entities.AIExecution.create({
    tenant_id: opts.run.tenant_id,
    business_id: opts.run.business_id,
    module_id: "orchestrator",
    capability: opts.capability || opts.task.provider_capability || "ai_generation",
    stage: opts.stage,
    prompt_id: `orchestrator.${opts.task.type}`,
    prompt_version: 1,
    run_id: opts.run.id,
    task_id: opts.task.id,
    attempt: opts.attempt,
    operation: opts.operation,
    provider: opts.provider?.provider_key || "",
    provider_id: opts.provider?.provider_id || "",
    adapter_key: opts.provider?.adapter_key || "",
    provider_capability: opts.capability || null,
    model: opts.model || "",
    input_hash: opts.inputHash,
    input_snapshot: { task_key: opts.task.task_key, stage: opts.stage },
    output_hash: opts.outputHash,
    success: opts.success,
    failure_reason: opts.errorMessage || "",
    error_code: opts.errorCode || "",
    retryable: !!opts.retryable,
    duration_ms: opts.durationMs,
    tokens: (opts.tokens?.prompt_tokens || 0) + (opts.tokens?.completion_tokens || 0),
    estimated_cost: opts.estimatedCost ?? 0,
    actual_cost: opts.estimatedCost ?? 0,
    completed_at: opts.success ? new Date().toISOString() : null,
    actor: opts.actor || "system",
    output: opts.output ?? null,
  });
  return row?.id || null;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function hashOf(v: any): string {
  try { return djb2(JSON.stringify(v ?? {})); } catch { return ""; }
}