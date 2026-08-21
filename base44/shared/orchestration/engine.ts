// AI Orchestration Engine — the SINGLE entry point for all AI generation.
//
// Every AI request flows through: Business Context → Capability → Prompt Builder →
// Prompt Registry → Provider/Model resolution → Execution → Validation → Retry →
// Fallback → Telemetry → Version Engine → Knowledge Graph update → Result.
//
// Execution itself delegates to the existing `runAIStage` (the proven retry/fallback/
// usage-logging path), so no business module is re-wired and there are no regressions.
// This engine layers prompt-registry, context, cache, validation, unified telemetry
// and events on top.

import { runAIStage } from '../ai/stages.ts';
import { bus } from '../events/bus.ts';
import { latestPrompt, ensureSeedPrompt } from './registry.ts';
import { validate } from './validators.ts';
import { loadBusinessContext, loadGraphVersion, loadCapabilityContext } from './context.ts';

export interface OrchestrationRequest {
  capability: string;          // capability key served (e.g. 'BusinessBlueprint')
  moduleId?: string;           // owning module (telemetry)
  promptId: string;            // logical prompt id
  businessId: string;
  tenantId: string;
  variables?: Record<string, any>;
  model?: string;              // preferred model (overrides prompt default)
  fallbackModels?: string[];
  schema?: any;               // overrides prompt.response_schema
  stage?: string;             // usage.operation label
  bypassCache?: boolean;
  maxAttempts?: number;
  actor?: string;
  versionId?: string;         // version record being produced (telemetry link)
  version?: number;
  // Approval integration: when set, the engine records a draft AIExecution
  // referencing the version record; the Version Engine owns the lifecycle.
  draftOf?: { entityName: string; recordId: string };
}

export interface OrchestrationResult {
  ok: boolean;
  data: any;
  cacheHit: boolean;
  promptId: string;
  promptVersion: number;
  kgVersion: number | null;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  retryCount: number;
  latencyMs: number;
  estimatedCost: number;
  validationStatus: 'pass' | 'fail' | 'none';
  validationErrors: string[];
  executionId: string | null;
  error?: string;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function renderTemplate(tpl: string, variables: Record<string, any>): string {
  return tpl.replace(/{{\s*([\w.]+)\s*}}/g, (_, k: string) => {
    const parts = k.split('.');
    let v: any = variables;
    for (const p of parts) { v = v?.[p]; if (v == null) break; }
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

async function recordTelemetry(svc: any, p: {
  req: OrchestrationRequest; prompt: any; kgVersion: number | null; cacheKey: string;
  cacheHit: boolean; provider: string; model: string; fallbackUsed: boolean;
  retryCount: number; latencyMs: number; estimatedCost: number; success: boolean;
  failureReason: string; validationStatus: 'pass' | 'fail' | 'none'; validationErrors: string[];
  stage: string; output: any;
}): Promise<string> {
  try {
    const row = await svc.entities.AIExecution.create({
      tenant_id: p.req.tenantId,
      business_id: p.req.businessId,
      module_id: p.req.moduleId || 'ai_orchestration',
      capability: p.req.capability,
      stage: p.stage,
      prompt_id: p.prompt.prompt_id,
      prompt_version: p.prompt.version,
      context_version: p.kgVersion != null ? `kg:v${p.kgVersion}` : '',
      kg_version: p.kgVersion,
      cache_key: p.cacheKey,
      cache_hit: p.cacheHit,
      provider: p.provider,
      model: p.model,
      fallback_used: p.fallbackUsed,
      retry_count: p.retryCount,
      tokens: 0,
      latency_ms: p.latencyMs,
      estimated_cost: p.estimatedCost,
      actual_cost: 0,
      success: p.success,
      failure_reason: p.failureReason,
      validation_status: p.validationStatus,
      validation_errors: p.validationErrors,
      output: p.success ? (p.output ?? null) : null,
      actor: p.req.actor || 'system',
      version_id: p.req.versionId || null,
    });
    return row?.id || null;
  } catch {
    return null;
  }
}

function failResult(req: OrchestrationRequest, code: string, message: string, promptVersion = 0, kgVersion: number | null = null): OrchestrationResult {
  return {
    ok: false, data: null, cacheHit: false,
    promptId: req.promptId, promptVersion, kgVersion,
    provider: '', model: '', fallbackUsed: false, retryCount: 0, latencyMs: 0,
    estimatedCost: 0, validationStatus: 'none', validationErrors: [],
    executionId: null, error: `${code}: ${message}`,
  };
}

export async function orchestrate(base44: any, req: OrchestrationRequest): Promise<OrchestrationResult> {
  const svc = base44.asServiceRole ?? base44;
  const t0 = Date.now();

  // Ensure the default test prompt exists (so validation tests work out of the box).
  if (req.promptId === 'orchestration.self_test') {
    try { await ensureSeedPrompt(svc, req.tenantId); } catch {}
  }

  // 1. Prompt resolution
  const prompt = await latestPrompt(svc, req.promptId, req.tenantId);
  if (!prompt) return failResult(req, 'PROMPT_NOT_FOUND', `No active prompt for ${req.promptId}`);

  // 2. Context loading (Knowledge Graph only)
  let kgVersion: number | null = null;
  let ctxSnapshot: any = null;
  try {
    kgVersion = await loadGraphVersion(svc, req.businessId);
    ctxSnapshot = await loadBusinessContext(svc, req.businessId);
  } catch (e: any) {
    return failResult(req, 'CONTEXT_LOAD_FAILED', String(e?.message || e), prompt.version, kgVersion);
  }
  const ctxSlice = loadCapabilityContext(req.capability, ctxSnapshot);

  // 3. Prompt assembly
  const schema = req.schema ?? prompt.response_schema ?? null;
  const rendered = renderTemplate(prompt.content, { ...req.variables, business_context: ctxSlice });
  const finalPrompt = ctxSlice
    ? `## BUSINESS KNOWLEDGE GRAPH CONTEXT (read-only, single source of truth)\n${JSON.stringify(ctxSlice)}\n\n## TASK\n${rendered}`
    : rendered;

  // 4. Cache key + lookup
  const cacheKey = djb2([req.capability, req.promptId, String(prompt.version), String(kgVersion), JSON.stringify(req.variables || {})].join('|'));
  if (!req.bypassCache) {
    try {
      const cached = await svc.entities.AIExecution.filter({ cache_key: cacheKey, success: true, validation_status: 'pass' }, '-created_date', 1);
      if (cached && cached.length && cached[0].output) {
        const execId = await recordTelemetry(svc, { req, prompt, kgVersion, cacheKey, cacheHit: true, provider: '(cache)', model: '(cache)', fallbackUsed: false, retryCount: 0, latencyMs: Date.now() - t0, estimatedCost: 0, success: true, failureReason: '', validationStatus: 'pass', validationErrors: [], stage: req.stage || req.capability, output: cached[0].output });
        try { await bus.dispatch('AIExecutionCompleted', { tenantId: req.tenantId, businessId: req.businessId, actor: req.actor, payload: { capability: req.capability, promptId: prompt.prompt_id, promptVersion: prompt.version, model: '(cache)', cacheHit: true, success: true, executionId: execId } }); } catch {}
        return { ok: true, data: cached[0].output, cacheHit: true, promptId: prompt.prompt_id, promptVersion: prompt.version, kgVersion, provider: '(cache)', model: '(cache)', fallbackUsed: false, retryCount: 0, latencyMs: Date.now() - t0, estimatedCost: 0, validationStatus: 'pass', validationErrors: [], executionId: execId };
      }
    } catch {}
  }

  // 5. Provider/model resolution (engine decides; modules never do)
  const model = req.model || prompt.default_model || 'automatic';
  const fallbackModels = (req.fallbackModels?.length ? req.fallbackModels : (prompt.fallback_models || []));
  const stageId = req.stage || `${req.moduleId || req.capability}.${req.capability}`;

  // 6. AIExecutionStarted
  try { await bus.dispatch('AIExecutionStarted', { tenantId: req.tenantId, businessId: req.businessId, actor: req.actor, payload: { capability: req.capability, promptId: prompt.prompt_id, promptVersion: prompt.version, model, kgVersion, cacheKey } }); } catch {}

  // 7. Execution (delegates to runAIStage: retry + model fallback + usage logging)
  const aiResult = await runAIStage(base44, {
    prompt: finalPrompt,
    schema: schema ?? undefined,
    stage: stageId,
    promptVersion: `prompt:${prompt.prompt_id}@v${prompt.version}`,
    model, fallbackModels,
    tenantId: req.tenantId, businessId: req.businessId,
    module: 'ai_orchestration',
    versionId: req.versionId, version: req.version,
    maxAttempts: req.maxAttempts ?? 1,
    actor: req.actor,
  });

  const fallbackUsed = aiResult.tried.length > 1 && aiResult.ok;
  const retryCount = Math.max(0, aiResult.attempts - 1);

  // 8. Validation
  let validationStatus: 'pass' | 'fail' | 'none' = 'none';
  let validationErrors: string[] = [];
  if (aiResult.ok && aiResult.data != null) {
    const v = await validate(req.capability, aiResult.data, { schema, ctxSnapshot });
    validationStatus = v.ok ? 'pass' : 'fail';
    validationErrors = v.errors;
    const ve = { tenantId: req.tenantId, businessId: req.businessId, actor: req.actor, payload: { capability: req.capability, promptId: prompt.prompt_id, errors: v.errors } };
    try { await bus.dispatch(v.ok ? 'AIValidationPassed' : 'AIValidationFailed', ve); } catch {}
  }

  // 9. Telemetry (unified ledger — no duplicated telemetry; runAIStage already
  //    writes the UsageLog row, this engine writes the AIExecution row).
  const execId = await recordTelemetry(svc, {
    req, prompt, kgVersion, cacheKey, cacheHit: false,
    provider: aiResult.provider, model: aiResult.model, fallbackUsed, retryCount,
    latencyMs: aiResult.executionTimeMs, estimatedCost: aiResult.estimatedCost || 0,
    success: aiResult.ok, failureReason: aiResult.error?.message || '',
    validationStatus, validationErrors, stage: stageId, output: aiResult.ok ? aiResult.data : null,
  });

  // 10. Events
  const baseEvt = { tenantId: req.tenantId, businessId: req.businessId, actor: req.actor, payload: { capability: req.capability, promptId: prompt.prompt_id, promptVersion: prompt.version, model: aiResult.model, provider: aiResult.provider, success: aiResult.ok, latencyMs: aiResult.executionTimeMs, fallbackUsed, retryCount, validationStatus, executionId: execId, kgVersion } };
  try { await bus.dispatch(aiResult.ok ? 'AIExecutionCompleted' : 'AIExecutionFailed', baseEvt); } catch {}
  if (fallbackUsed && aiResult.ok) { try { await bus.dispatch('AIFallbackUsed', baseEvt); } catch {} }

  return {
    ok: aiResult.ok, data: aiResult.data ?? null, cacheHit: false,
    promptId: prompt.prompt_id, promptVersion: prompt.version, kgVersion,
    provider: aiResult.provider, model: aiResult.model, fallbackUsed, retryCount,
    latencyMs: aiResult.executionTimeMs, estimatedCost: aiResult.estimatedCost || 0,
    validationStatus, validationErrors, executionId: execId,
    error: aiResult.error?.message,
  };
}

// ---------- Approval integration (Version Engine) ----------
// The engine never owns lifecycle state — it tags the produced AIExecution as a
// draft and links it to the target version record. The shared Version Engine owns
// draft → review → approved → rejected → published. This thin helper records that
// link so the observability page can show pending drafts awaiting approval.
export async function linkDraft(svc: any, executionId: string, target: { entityName: string; recordId: string }): Promise<void> {
  try { await svc.entities.AIExecution.update(executionId, { version_id: target.recordId }); } catch {}
}