// Business Knowledge Graph — HTTP entry point.
// Exposes the read-only Context API + explicit rebuild/status over the function
// boundary so the frontend and other backend functions can invoke it. This is
// the only place the graph is exposed as an HTTP service; modules importing the
// shared SDK (base44/shared/sdk) use getBusinessContext directly.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getBusinessContext, getGraph, isStale, rebuildGraph, markStale } from '../../shared/knowledge-graph/index.ts';
import { isModuleEnabled } from '../../shared/sdk/index.ts';

function actorName(u: any): string { return (u && (u.full_name || u.email)) || (u && u.id) || 'system'; }

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const businessId = body.business_id;

    // ---------- STATUS ----------
    // Returns the latest graph + freshness + module coverage + stats. Cheap read.
    if (action === 'status') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const graph = await getGraph(svc, businessId);
      const freshness = await isStale(svc, businessId);
      return Response.json({
        business: { id: business.id, name: business.name, industry: business.industry, launch_stage: business.launch_stage },
        graph: graph ? {
          id: graph.id, version: graph.version, status: graph.status, is_stale: graph.is_stale || freshness?.stale,
          stale_reason: graph.stale_reason || (freshness?.reasons || []).join('; '),
          last_rebuilt_at: graph.last_rebuilt_at, last_rebuilt_by: graph.last_rebuilt_by, rebuild_duration_ms: graph.rebuild_duration_ms,
          module_coverage: graph.module_coverage, stats: graph.stats, source_versions: graph.source_versions,
        } : null,
        stale: freshness?.stale ?? true,
        stale_reasons: freshness?.reasons ?? [],
      });
    }

    // ---------- GET CONTEXT (read-only AI context snapshot) ----------
    if (action === 'getContext') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const ctx = await getBusinessContext(svc, businessId, { refreshIfStale: true });
      return Response.json({ context: ctx });
    }

    // ---------- GET GRAPH (nodes + relationships) ----------
    if (action === 'getGraph') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const graph = await getGraph(svc, businessId);
      return Response.json({ graph });
    }

    // ---------- REBUILD (explicit sync) ----------
    if (action === 'rebuild') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const enabled = await isModuleEnabled(svc, 'business_knowledge_graph', businessId);
      if (!enabled) return Response.json({ error: 'Knowledge Graph module is disabled for this workspace.' }, { status: 403 });
      const record = await rebuildGraph(svc, businessId, actorName(user));
      return Response.json({
        graph: {
          id: record.id, version: record.version, status: record.status,
          stats: record.stats, module_coverage: record.module_coverage, source_versions: record.source_versions,
          last_rebuilt_at: record.last_rebuilt_at, rebuild_duration_ms: record.rebuild_duration_ms,
        },
      });
    }

    // ---------- MARK STALE (future upstream event hook) ----------
    if (action === 'markStale') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      await markStale(svc, businessId, body.reason || 'upstream_changed');
      return Response.json({ ok: true });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}