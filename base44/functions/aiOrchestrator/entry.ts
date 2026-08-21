// AI Orchestration Engine — HTTP entry point.
// Exposes: orchestrate, registerPrompt, getPrompt, listPrompts, publishPrompt,
// telemetry (aggregated observability), and admin-only seed.
//
// Modules that need AI generation call the shared SDK's `orchestrate()` directly;
// the frontend and external callers use this HTTP function.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  orchestrate,
  linkDraft,
  latestPrompt, getPrompt, listPrompts, registerPrompt, setPromptStatus, ensureSeedPrompt,
  validate, registerValidator,
  loadBusinessContext, loadCapabilityContext, loadPromptContext, loadGraphVersion,
  isModuleEnabled,
} from '../../shared/sdk/index.ts';

function actorName(u: any): string { return (u && (u.full_name || u.email)) || (u && u.id) || 'system'; }
function isAdmin(u: any): boolean { return u?.role === 'admin'; }

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---------- ORCHESTRATE (run the full pipeline) ----------
    if (action === 'orchestrate') {
      const businessId = body.business_id;
      if (!body.prompt_id || !body.capability || !businessId) {
        return Response.json({ error: 'prompt_id, capability and business_id are required' }, { status: 400 });
      }
      const business: any = await base44.entities.Business.get(businessId);
      const enabled = await isModuleEnabled(svc, 'ai_orchestration', businessId);
      if (!enabled) return Response.json({ error: 'AI Orchestration module is disabled for this workspace.' }, { status: 403 });
      const result = await orchestrate(base44, {
        capability: body.capability,
        moduleId: body.module_id || 'ai_orchestration',
        promptId: body.prompt_id,
        businessId,
        tenantId: business.tenant_id,
        variables: body.variables || {},
        model: body.model,
        fallbackModels: body.fallback_models,
        schema: body.schema,
        stage: body.stage,
        bypassCache: !!body.bypass_cache,
        maxAttempts: body.max_attempts,
        actor: actorName(user),
        versionId: body.version_id,
        version: body.version,
      });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    // ---------- PROMPT REGISTRY ----------
    if (action === 'registerPrompt') {
      if (!isAdmin(user)) return Response.json({ error: 'Admin only' }, { status: 403 });
      const { prompt_id, capability, module, content, variables, compatible_models, default_model, fallback_models, response_schema, notes, status, tenant_id } = body;
      if (!prompt_id || !capability || !module || !content) return Response.json({ error: 'prompt_id, capability, module, content required' }, { status: 400 });
      const tid = tenant_id || (user as any).data?.tenant_id || (await base44.entities.Business.list())[0]?.tenant_id;
      if (!tid) return Response.json({ error: 'tenant_id could not be resolved' }, { status: 400 });
      const rec = await registerPrompt(svc, { tenant_id: tid, prompt_id, capability, module, content, variables: variables || [], compatible_models: compatible_models || [], default_model: default_model || 'automatic', fallback_models: fallback_models || [], response_schema, notes, status: status || 'approved', created_by: actorName(user) } as any);
      return Response.json({ prompt: rec });
    }

    if (action === 'getPrompt') {
      const p = await getPrompt(svc, body.prompt_id, body.version, body.tenant_id);
      return Response.json({ prompt: p });
    }

    if (action === 'listPrompts') {
      const tid = body.tenant_id || (user as any).data?.tenant_id;
      const prompts = await listPrompts(svc, tid);
      return Response.json({ prompts });
    }

    if (action === 'publishPrompt') {
      if (!isAdmin(user)) return Response.json({ error: 'Admin only' }, { status: 403 });
      const p = await getPrompt(svc, body.prompt_id, body.version, body.tenant_id);
      if (!p) return Response.json({ error: 'Prompt not found' }, { status: 404 });
      await setPromptStatus(svc, p.id, body.status || 'published');
      return Response.json({ ok: true });
    }

    // ---------- CONTEXT ----------
    if (action === 'getContext') {
      if (!body.business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      const ctx = await loadBusinessContext(svc, body.business_id);
      const kgVersion = await loadGraphVersion(svc, body.business_id);
      return Response.json({ context: ctx, kg_version: kgVersion });
    }

    if (action === 'loadPromptContext') {
      const r = await loadPromptContext(svc, body.business_id, body.prompt_id, body.tenant_id);
      return Response.json(r || { context: null, prompt: null });
    }

    // ---------- VALIDATION ----------
    if (action === 'validate') {
      const v = await validate(body.capability, body.data, { schema: body.schema });
      return Response.json(v);
    }

    // ---------- TELEMETRY / OBSERVABILITY (admin only) ----------
    if (action === 'telemetry') {
      if (!isAdmin(user)) return Response.json({ error: 'Admin only' }, { status: 403 });
      const tenant_id = body.tenant_id || (user as any).data?.tenant_id;
      const q: any = {};
      if (tenant_id) q.tenant_id = tenant_id;
      if (body.business_id) q.business_id = body.business_id;
      const all = await svc.entities.AIExecution.filter(q, '-created_date', body.limit || 200);
      const total = all.length;
      const success = all.filter((e: any) => e.success).length;
      const cacheHits = all.filter((e: any) => e.cache_hit).length;
      const fallbacks = all.filter((e: any) => e.fallback_used).length;
      const retries = all.filter((e: any) => (e.retry_count || 0) > 0).length;
      const failures = all.filter((e: any) => !e.success);
      const avgLatency = total ? Math.round(all.reduce((n: number, e: any) => n + (e.latency_ms || 0), 0) / total) : 0;
      const totalCost = all.reduce((n: number, e: any) => n + (e.estimated_cost || 0), 0);

      const by = (key: string) => {
        const m: Record<string, { count: number; success: number; latencyMs: number; cost: number }> = {};
        for (const e of all) {
          const k = String(e[key] || '(unknown)');
          if (!m[k]) m[k] = { count: 0, success: 0, latencyMs: 0, cost: 0 };
          m[k].count++; if (e.success) m[k].success++; m[k].latencyMs += e.latency_ms || 0; m[k].cost += e.estimated_cost || 0;
        }
        return Object.entries(m).map(([k, v]) => ({ key: k, ...v, avgLatencyMs: Math.round(v.latencyMs / v.count), successRate: v.count ? Math.round((v.success / v.count) * 100) : 0 })).sort((a, b) => b.count - a.count);
      };

      const recent = all.slice(0, 50).map((e: any) => ({
        id: e.id, capability: e.capability, prompt_id: e.prompt_id, prompt_version: e.prompt_version,
        kg_version: e.kg_version, model: e.model, provider: e.provider, success: e.success,
        cache_hit: e.cache_hit, fallback_used: e.fallback_used, retry_count: e.retry_count,
        latency_ms: e.latency_ms, estimated_cost: e.estimated_cost,
        validation_status: e.validation_status, failure_reason: e.failure_reason,
        created_date: e.created_date, business_id: e.business_id, stage: e.stage,
      }));

      return Response.json({
        summary: {
          total, success, failures: failures.length,
          successRate: total ? Math.round((success / total) * 100) : 0,
          cacheHits, fallbacks, retries, avgLatencyMs: avgLatency, totalEstimatedCost: Number(totalCost.toFixed(6)),
        },
        byProvider: by('provider'),
        byModel: by('model'),
        byCapability: by('capability'),
        byPrompt: by('prompt_id'),
        recent,
      });
    }

    if (action === 'seedTestPrompt') {
      if (!isAdmin(user)) return Response.json({ error: 'Admin only' }, { status: 403 });
      const tid = body.tenant_id || (user as any).data?.tenant_id || (await base44.entities.Business.list())[0]?.tenant_id;
      if (!tid) return Response.json({ error: 'tenant_id could not be resolved' }, { status: 400 });
      await ensureSeedPrompt(svc, tid);
      return Response.json({ ok: true });
    }

    // ---------- ASSISTANT ROUTE (customer AI chat → orchestration engine) ----------
    if (action === 'assistantRoute') {
      const businessId = body.business_id;
      if (!businessId) return Response.json({ error: 'business_id required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const enabled = await isModuleEnabled(svc, 'ai_orchestration', businessId);
      if (!enabled) return Response.json({ error: 'AI Orchestration module is disabled for this workspace.' }, { status: 403 });
      const tid = business.tenant_id;
      try {
        if (!(await latestPrompt(svc, 'assistant.route', tid))) {
          await registerPrompt(svc, {
            tenant_id: tid, prompt_id: 'assistant.route', capability: 'AssistantRouting',
            module: 'ai_orchestration', status: 'approved',
            content: 'You are the Business Assistant inside a Business Operating System. The user owns the business "{{business_name}}" ({{business_industry}}). Classify the user request into ONE intent and reply in one friendly sentence (max 25 words, no markdown). Also propose the single best next action and the app route to fulfill it (one of: /onboarding, /communications, /website, /seo, /insights, /customers, /team, /assistant, /domains).\n\nUser request: "{{user_request}}"\n\nReturn JSON: { reply, intent, action_label, action_target }.',
            variables: ['business_name', 'business_industry', 'user_request'],
            compatible_models: [], default_model: 'automatic', fallback_models: ['gpt_5_mini'],
            response_schema: { type: 'object', properties: { reply: { type: 'string' }, intent: { type: 'string' }, action_label: { type: 'string' }, action_target: { type: 'string' } }, required: ['reply', 'action_label', 'action_target'] },
            notes: 'Customer AI Assistant router — seeded by the orchestrator.',
            created_by: actorName(user),
          } as any);
        }
      } catch {}
      const result = await orchestrate(base44, {
        capability: 'AssistantRouting', moduleId: 'ai_orchestration', promptId: 'assistant.route',
        businessId, tenantId: tid, bypassCache: true,
        variables: { business_name: business.name || '', business_industry: business.industry || '', user_request: body.request || '' },
        stage: 'assistant.route', actor: actorName(user),
      });
      if (!result.ok) return Response.json({ error: result.error || 'orchestration_failed' }, { status: 502 });
      return Response.json(result.data || {});
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}

// ensure SDK import side-effect (capability registry) is not tree-shaken
void registerValidator;