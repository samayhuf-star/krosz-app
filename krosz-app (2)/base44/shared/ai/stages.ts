// Shared AI Execution Engine — the single entry point every AI module uses.
// Modules must NEVER call a provider integration directly. They call runAIStage().
//
// Responsibilities consolidated here (previously duplicated per factory):
//   • promptVersion stamp         (auditability / reproducibility)
//   • model + ordered fallback    (providerSelection / fallback)
//   • bounded retry               (retry)
//   • executionTime               (latency)
//   • model + provider             (model)
//   • usage logging                (usageLogging) via the existing UsageLog ledger
//   • audit trail                  (tried[]) returned for provenance
//   • platform event               (AIStageExecuted) for the Event Bus
//
// Cost is NEVER fabricated: Base44's built-in InvokeLLM does not report token
// usage, so no cost row is written. When the external AI provider runtime is
// used (executeAIChat in providers/runtime.ts) it writes real cost from token
// usage — that path remains authoritative for cost.

import { recordUsage } from '../logging.ts';
import { bus } from '../events/bus.ts';

export interface AIStageRequest {
  prompt: string;
  schema?: any;                      // response_json_schema
  stage: string;                     // e.g. "website.architecture" — usage.operation
  promptVersion: string;            // immutable, per-factory prompt version tag
  model?: string;                    // preferred model (default 'automatic')
  fallbackModels?: string[];         // ordered fallback chain
  tenantId?: string;                 // workspace tenant
  businessId?: string;              // workspace (Business) the stage runs for
  module?: string;                   // which module triggered the stage (telemetry)
  versionId?: string;                // version record the stage contributes to (telemetry)
  version?: number;                  // version number (telemetry)
  fileUrls?: string[];
  addContextFromInternet?: boolean;
  maxAttempts?: number;              // attempts per model (default 1)
  actor?: string;
}

export interface AIStageAttempt {
  model: string;
  success: boolean;
  error?: string;
  latencyMs: number;
}

export interface AIStageResult<T = any> {
  ok: boolean;
  data: T | null;
  error?: { code: string; message: string };
  model: string;
  provider: string;
  promptVersion: string;
  attempts: number;
  executionTimeMs: number;
  tried: AIStageAttempt[];
  module: string;
  versionId?: string;
  version?: number;
  estimatedCost?: number;            // heuristic estimate (USD); 0 when pricing unknown
  costBasis?: string;                 // 'char_heuristic' | 'unknown_pricing'
}

const PLATFORM_PROVIDER_ID = 'base44-core';

// Rough per-1M-token pricing (USD) for the heuristic estimator. Unknown models → 0 (never fabricated).
const MODEL_PRICE_PER_1M: Record<string, { in: number; out: number }> = {
  'claude_sonnet_4_6': { in: 3, out: 15 },
  'claude_opus_4_6': { in: 15, out: 75 },
  'gpt_5_4': { in: 5, out: 15 },
  'gpt_5_mini': { in: 0.15, out: 0.6 },
  'gemini_3_flash': { in: 0.075, out: 0.3 },
  'gemini_3_1_pro': { in: 1.25, out: 5 },
};

function estimateCost(model: string, prompt: string, res: any): { estimated: number; basis: string } {
  const p = MODEL_PRICE_PER_1M[model];
  if (!p) return { estimated: 0, basis: 'unknown_pricing' };
  const outChars = typeof res === 'string' ? res.length : JSON.stringify(res || '').length;
  const inTok = Math.ceil(prompt.length / 4);
  const outTok = Math.ceil(outChars / 4);
  const estimated = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  return { estimated: Number(estimated.toFixed(6)), basis: 'char_heuristic' };
}

const isTransient = (e: any): boolean => {
  const m = String(e?.message || e || '');
  // treat empty structured results and timeouts as transient (retryable)
  return /empty|timeout|aborted|temporarily|503|502|429/i.test(m);
};

/**
 * Run a single AI stage with retry + model fallback, full audit trail, and
 * best-effort usage logging via the existing UsageLog ledger.
 */
export async function runAIStage(base44: any, req: AIStageRequest): Promise<AIStageResult<any>> {
  const svc = base44.asServiceRole ?? base44;
  const models = [req.model || 'automatic', ...(req.fallbackModels || [])].filter((m, i, a) => a.indexOf(m) === i);
  const maxAttempts = Math.max(1, req.maxAttempts ?? 1);
  const t0 = Date.now();
  const tried: AIStageAttempt[] = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const a0 = Date.now();
      try {
        const res: any = await svc.integrations.Core.InvokeLLM({
          prompt: req.prompt,
          response_json_schema: req.schema ?? null,
          model,
          file_urls: req.fileUrls,
          add_context_from_internet: !!req.addContextFromInternet,
        });
        const latency = Date.now() - a0;
        // InvokeLLM returns a parsed object when schema is set, else a string.
        const isEmpty = res == null || (typeof res === 'object' && !Array.isArray(res) && Object.keys(res || {}).length === 0);
        if (isEmpty) {
          tried.push({ model, success: false, error: 'empty_result', latencyMs: latency });
          // continue to next attempt / model
          continue;
        }
        await recordUsage(base44, {
          tenant_id: req.tenantId ?? null,
          business_id: req.businessId ?? null,
          provider_id: PLATFORM_PROVIDER_ID,
          service: 'ai',
          operation: req.stage,
          usage_quantity: 0, // token usage not reported by InvokeLLM; 0 is honest
          usage_unit: 'tokens',
          success: true,
          kind: 'production_operation',
        });
        const est = estimateCost(model, req.prompt, res);
        const result: AIStageResult = {
          ok: true, data: res, model, provider: PLATFORM_PROVIDER_ID,
          promptVersion: req.promptVersion, attempts: tried.length + 1,
          executionTimeMs: Date.now() - t0, tried: [...tried, { model, success: true, latencyMs: latency }],
          module: req.module || '', versionId: req.versionId, version: req.version,
          estimatedCost: est.estimated, costBasis: est.basis,
        };
        await bus.dispatch('AIStageExecuted', { payload: { stage: req.stage, module: result.module, versionId: result.versionId, model, ok: true, executionTimeMs: result.executionTimeMs, estimatedCost: result.estimatedCost, costBasis: result.costBasis, actor: req.actor }, tenantId: req.tenantId, businessId: req.businessId, actor: req.actor });
        return result;
      } catch (err: any) {
        const latency = Date.now() - a0;
        tried.push({ model, success: false, error: String(err?.message || err), latencyMs: latency });
        if (!isTransient(err) || attempt === maxAttempts) break; // move to fallback model
      }
    }
  }

  // All models failed.
  await recordUsage(base44, {
    tenant_id: req.tenantId ?? null, business_id: req.businessId ?? null,
    provider_id: PLATFORM_PROVIDER_ID, service: 'ai', operation: req.stage,
    usage_quantity: 0, usage_unit: 'tokens', success: false, kind: 'failed_operation',
  });
  const fail: AIStageResult = {
    ok: false, data: null,
    error: { code: 'AI_STAGE_FAILED', message: tried.length ? tried[tried.length - 1].error || 'All models failed.' : 'No models configured.' },
    model: models[0], provider: PLATFORM_PROVIDER_ID, promptVersion: req.promptVersion,
    attempts: tried.length, executionTimeMs: Date.now() - t0, tried,
    module: req.module || '', versionId: req.versionId, version: req.version,
  };
  await bus.dispatch('AIStageExecuted', { payload: { stage: req.stage, module: fail.module, versionId: fail.versionId, model: models[0], ok: false, error: fail.error, actor: req.actor }, tenantId: req.tenantId, businessId: req.businessId, actor: req.actor });
  return fail;
}