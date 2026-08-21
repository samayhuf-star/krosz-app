import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { listAIAdapters, asAIAdapter } from '../../shared/providers/ai_catalog.ts';
import { executeAIChat, executeAIEmbeddings, runOnProvider } from '../../shared/providers/runtime.ts';
import { resolveActiveProviderChain } from '../../shared/providers/resolver.ts';
import { getProviderAdapter } from '../../shared/providers/registry.ts';
import { ModuleRegistry, CapabilityRegistry } from '../../shared/sdk/index.ts';
import { FLAG_DEFAULTS, resolveFlag } from '../../shared/sdk/index.ts';
import { getObsConfig, ObservabilityService, setObsCtx } from '../../shared/observability/index.ts';

const secGet = (name: string): string | undefined => {
  try { return secrets.get(name); } catch { return undefined; }
};

function runtimeFor(svc: any) {
  return {
    invokeLLM: async (prompt: string, opts?: Record<string, unknown>) => {
      const r = await svc.integrations.Core.InvokeLLM({ prompt, ...(opts || {}) });
      return r || '';
    },
    fetchExternal: async (url: string, init?: RequestInit) => await fetch(url, init),
  };
}

function healthFromProvider(p: any): string {
  if (!p.enabled) return 'disabled';
  if (p.last_test_success === true) return 'healthy';
  if (p.last_test_success === false) {
    const m = (p.last_test_message || '').toLowerCase();
    if (/invalid|authoriz|api key/i.test(m)) return 'invalid_key';
    if (/rate|429/.test(m)) return 'rate_limited';
    if (/quota/.test(m)) return 'quota_exceeded';
    return 'unhealthy';
  }
  return 'unconfigured';
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: platform administrators only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const svc = base44.asServiceRole;
    const rt = runtimeFor(svc);

    if (action === 'catalog') return Response.json({ adapters: listAIAdapters() });

    if (action === 'failoverPreview') {
      const resolved = await resolveActiveProviderChain(base44, 'ai', body.tenant_id);
      const all = await svc.entities.Provider.filter({ category: 'ai', enabled: true });
      const seen = new Set<string>();
      const ordered: any[] = [];
      const consider = (p: any) => {
        if (!p || seen.has(p.id) || !p.enabled) return;
        try { if (!asAIAdapter(getProviderAdapter(p.adapter_key))) return; } catch { return; }
        seen.add(p.id); ordered.push(p);
      };
      if (resolved.provider) consider(resolved.provider);
      for (const p of all) consider(p);
      return Response.json({
        level: resolved.level,
        ordered: ordered.map((p) => ({ id: p.id, name: p.name, adapter_key: p.adapter_key, key: p.key })),
      });
    }

    if (action === 'chat') {
      const obsCfg = getObsConfig();
      const obs = obsCfg.enabled ? new ObservabilityService(obsCfg, { kind: 'playground', tenant_id: body.tenant_id || 'system', business_id: body.business_id || null, actor: user?.email || null }) : null;
      if (obs) obs.startTrace('playground:chat', { tenant_id: body.tenant_id || null, business_id: body.business_id || null });
      const r = obs
        ? await setObsCtx({ service: obs, traceId: obs.traceId, parentObservationId: null, run_id: body.run_id || null, task_id: body.task_id || null }, async () => executeAIChat(base44, secGet, rt, { tenant_id: body.tenant_id, business_id: body.business_id, request: body.request }))
        : await executeAIChat(base44, secGet, rt, { tenant_id: body.tenant_id, business_id: body.business_id, request: body.request });
      // Record the real execution in the SAME AIExecution ledger production tasks use
      // (the orchestrator path). This is not a second runtime — only an accounting
      // write so the Playground/Usage/Logs surfaces reflect real playground requests.
      try {
        const t: any = r.tokens || (r.result?.data?.usage) || {};
        await svc.entities.AIExecution.create({
          tenant_id: body.tenant_id || 'system',
          business_id: body.business_id || null,
          module_id: 'ai_runtime',
          capability: 'ai_generation',
          prompt_id: r.result?.request_id || 'playground',
          operation: 'chat',
          stage: 'chat',
          provider: r.provider_key || null,
          provider_id: r.provider_id || null,
          adapter_key: null,
          model: r.result?.data?.model || null,
          tokens: t.total_tokens ?? 0,
          latency_ms: r.total_latency_ms ?? null,
          duration_ms: r.total_latency_ms ?? null,
          estimated_cost: r.estimated_cost ?? 0,
          actual_cost: r.estimated_cost ?? 0,
          success: Boolean(r.result?.success),
          error_code: r.result?.error_code || null,
          error_detail: r.result?.error_message || null,
          actor: user?.email || null,
          attempt: r.attempts || 1,
          fallback_used: Boolean(r.tried && r.tried.some((x: any) => !x.success)),
          completed_at: new Date().toISOString(),
        });
      } catch {}
      if (obs) { try { await obs.flush(); } catch {} }
      return Response.json({ ...r, observability: obs ? obs.summary() : { enabled: false } });
    }

    if (action === 'embeddings') {
      const r = await executeAIEmbeddings(base44, secGet, rt, { tenant_id: body.tenant_id, business_id: body.business_id, request: body.request });
      return Response.json(r);
    }

    if (['models', 'health', 'validateKey', 'stream'].includes(action)) {
      const { provider_id } = body;
      if (!provider_id) return Response.json({ error: 'provider_id is required' }, { status: 400 });
      const provider = await svc.entities.Provider.get(provider_id);
      const { ctx, result } = await runOnProvider(base44, secGet, rt, provider, async (ai, c) => {
        if (action === 'models') return ai.models(c, rt);
        if (action === 'health') return ai.health(c, rt);
        if (action === 'validateKey') return ai.validateKey(c, rt);
        if (ai.stream) return ai.stream(c, rt, body.request || { model: '', messages: [{ role: 'user', content: 'ping' }] });
        return { success: false, provider: { providerId: c.providerId, key: c.providerKey, category: c.category }, operation: 'stream', request_id: c.requestId, error_code: 'NOT_SUPPORTED', error_message: 'Provider does not support streaming.', retryable: false };
      });
      return Response.json({ provider: provider.name, request_id: ctx.requestId, result });
    }

    if (action === 'monitor') {
      const providers = await svc.entities.Provider.filter({ category: 'ai' });
      const usage = await svc.entities.UsageLog.filter({ service: 'ai' });
      const costs = await svc.entities.CostLog.filter({ service: 'ai' });
      const adapters = listAIAdapters();
      const adapterByKey: Record<string, any> = Object.fromEntries(adapters.map((a) => [a.key, a]));
      const stats = providers.map((p: any) => {
        const u = usage.filter((x: any) => x.provider_id === p.id);
        const successes = u.filter((x: any) => x.success).length;
        const errors = u.length - successes;
        const tokens = u.reduce((n: number, x: any) => n + (x.usage_quantity || 0), 0);
        const cost = costs.filter((c: any) => c.provider_id === p.id).reduce((n: number, c: any) => n + (c.estimated_amount || 0) + (c.cost_amount || 0), 0);
        const adapter = adapterByKey[p.adapter_key];
        return {
          id: p.id,
          name: p.name,
          adapter_key: p.adapter_key,
          key: p.key,
          environment: p.environment,
          enabled: p.enabled,
          is_default: p.is_default,
          health_status: healthFromProvider(p),
          last_tested_at: p.last_tested_at,
          last_test_latency: p.last_test_latency,
          last_test_message: p.last_test_message,
          requests: u.length,
          errors,
          success_rate: u.length ? successes / u.length : null,
          tokens,
          cost,
          capabilities: adapter?.capabilities,
          default_model: adapter?.defaultModel,
        };
      });
      const totals = {
        requests: usage.length,
        errors: usage.filter((x: any) => !x.success).length,
        tokens: usage.reduce((n: number, x: any) => n + (x.usage_quantity || 0), 0),
        cost: costs.reduce((n: number, c: any) => n + (c.estimated_amount || 0) + (c.cost_amount || 0), 0),
      };
      // Platform Kernel: module discovery + capability lookup + feature-flag resolution.
      const modules = ModuleRegistry.list().map((m) => ({
        id: m.id, name: m.name, version: m.version, icon: m.icon, available: m.available,
        stage: m.stage, dependencies: m.dependencies, capabilities: m.capabilities,
        requiredProviders: m.requiredProviders, canEnable: ModuleRegistry.canEnable(m),
      }));
      const capabilities = CapabilityRegistry.list();
      const resolvedFlags = {
        'platform.module_registry': await resolveFlag(svc, 'platform.module_registry'),
        'platform.ai_telemetry': await resolveFlag(svc, 'platform.ai_telemetry'),
        'module.crm.enabled': await resolveFlag(svc, 'module.crm.enabled'),
        'module.marketing.enabled': await resolveFlag(svc, 'module.marketing.enabled'),
      };
      return Response.json({ providers: stats, totals, adapters, modules, capabilities, featureFlags: { defaults: FLAG_DEFAULTS, resolved: resolvedFlags } });
    }

    // ---- Execution Logs (real AIExecution ledger) ----
    // Read-only, admin-gated by the guard at the top of this function. Returns the
    // most recent AIExecution rows with all provenance fields (provider, model, run,
    // task, tokens, cost, latency) — never secrets. Filters applied in JS to keep the
    // surface a single predictable read.
    if (action === 'logs') {
      const { provider_key, model, status, run_id, task_id, business_id, limit } = body;
      const cap = Math.max(1, Math.min(Number(limit) || 200, 500));
      const rows: any[] = await svc.entities.AIExecution.filter({}, '-created_date', cap).catch(() => []);
      const filtered = rows.filter((r: any) => {
        if (provider_key && r.provider !== provider_key) return false;
        if (model && r.model !== model) return false;
        if (status && (r.success ? 'success' : 'failed') !== status) return false;
        if (run_id && r.run_id !== run_id) return false;
        if (task_id && r.task_id !== task_id) return false;
        if (business_id && r.business_id !== business_id) return false;
        return true;
      });
      const out = filtered.map((r: any) => ({
        id: r.id, created_date: r.created_date, tenant_id: r.tenant_id, business_id: r.business_id,
        provider: r.provider, provider_id: r.provider_id, adapter_key: r.adapter_key, model: r.model,
        capability: r.capability, stage: r.stage, operation: r.operation, attempt: r.attempt,
        success: r.success, error_code: r.error_code, error_detail: r.error_detail,
        tokens: r.tokens, latency_ms: r.latency_ms, duration_ms: r.duration_ms,
        estimated_cost: r.estimated_cost, actual_cost: r.actual_cost, fallback_used: r.fallback_used,
        retry_count: r.retry_count, run_id: r.run_id, task_id: r.task_id,
      }));
      return Response.json({ rows: out });
    }

    // ---- Usage & Costs (real UsageLog + CostLog + AIExecution) ----
    // KPIs aggregated from the accounting sources (UsageLog/CostLog). The detailed
    // table is sourced from AIExecution (which carries model + business + latency +
    // status that UsageLog lacks). today/this-month computed from occurred_at.
    if (action === 'usage') {
      const usage: any[] = await svc.entities.UsageLog.filter({ service: 'ai' }).catch(() => []);
      const costs: any[] = await svc.entities.CostLog.filter({ service: 'ai' }).catch(() => []);
      const execs: any[] = await svc.entities.AIExecution.filter({}, '-created_date', 500).catch(() => []);
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const ts = (r: any) => (r && (r.occurred_at || r.created_date)) || '';
      const usageToday = usage.filter((u: any) => ts(u) && ts(u) >= startToday);
      const costToday = costs.filter((c: any) => ts(c) && ts(c) >= startToday);
      const costMonth = costs.filter((c: any) => ts(c) && ts(c) >= startMonth);
      const execLat = execs.map((e: any) => e.latency_ms).filter((x: any) => typeof x === 'number');
      const providers = [...new Set(execs.map((e: any) => e.provider).filter(Boolean))].sort();
      const models = [...new Set(execs.map((e: any) => e.model).filter(Boolean))].sort();
      const businesses = [...new Set(execs.map((e: any) => e.business_id).filter(Boolean))].sort();
      const rows = execs.map((r: any) => ({
        id: r.id, time: r.created_date, provider: r.provider, model: r.model,
        business_id: r.business_id, tokens: r.tokens, cost: r.estimated_cost,
        latency_ms: r.latency_ms, status: r.success ? 'success' : 'failed',
        run_id: r.run_id, task_id: r.task_id, operation: r.operation, attempt: r.attempt,
      }));
      return Response.json({
        kpis: {
          requests: usage.length,
          successful: usage.filter((u: any) => u.success).length,
          failed: usage.filter((u: any) => !u.success).length,
          tokens: usage.reduce((n: number, u: any) => n + (u.usage_quantity || 0), 0),
          cost: costs.reduce((n: number, c: any) => n + (c.cost_amount || c.estimated_amount || 0), 0),
          avgLatency: execLat.length ? Math.round(execLat.reduce((a: number, b: number) => a + b, 0) / execLat.length) : null,
          requestsToday: usageToday.length,
          tokensToday: usageToday.reduce((n: number, u: any) => n + (u.usage_quantity || 0), 0),
          spendToday: costToday.reduce((n: number, c: any) => n + (c.cost_amount || c.estimated_amount || 0), 0),
          spendMonth: costMonth.reduce((n: number, c: any) => n + (c.cost_amount || c.estimated_amount || 0), 0),
        },
        filters: { providers, models, businesses },
        rows,
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}