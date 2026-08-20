// Shared Business Context API — the SINGLE read surface every module uses.
//
// Future modules import ONLY from here:
//
//   import { getBusinessContext } from '../../shared/sdk/index.ts';
//   const ctx = await getBusinessContext(base44.asServiceRole, businessId);
//
// They never import the source entities, never import each other, and never
// depend on another module's internal shape. This is how enterprise platforms
// collapse N×N dependencies into N dependencies on one graph.
//
// Re-exported through the kernel SDK (base44/shared/sdk/index.ts).

import { loadSources, buildGraph, detectStaleness, type BusinessContext, type BuiltGraph } from './engine.ts';
import { bus } from '../events/bus.ts';

export { loadSources, buildGraph, detectStaleness };
export type { BusinessContext, BuiltGraph, GraphNode, GraphRelationship, SourceVersions, ModuleCoverage } from './engine.ts';

// The graph is one record per business, versioned. The latest (max version) is
// the live graph; older rows are kept for audit/history and marked superseded.
async function latestGraph(svc: any, businessId: string): Promise<any | null> {
  const rows = (await svc.entities.BusinessKnowledgeGraph.filter({ business_id: businessId }))
    .sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
  return rows[0] || null;
}

// ---------- READ: the unified business context ----------
// Downstream AI stages call this. It self-heals: if no graph exists or the
// upstream modules advanced since the last rebuild, it rebuilds first.
// (Change detection is computed from source_versions — no cross-function
// event bus required, so this is reliable in a serverless runtime.)
export async function getBusinessContext(
  svc: any,
  businessId: string,
  opts: { refreshIfStale?: boolean } = {},
): Promise<BusinessContext | null> {
  let graph = await latestGraph(svc, businessId);
  if (!graph) {
    graph = await rebuildGraph(svc, businessId, 'system:auto');
    return graph?.context_snapshot ?? null;
  }
  if (opts.refreshIfStale !== false) {
    const sources = await loadSources(svc, businessId);
    const { stale } = detectStaleness(graph, sources);
    if (stale || graph.is_stale) {
      graph = await rebuildGraph(svc, businessId, 'system:staleness');
      return graph?.context_snapshot ?? null;
    }
  }
  return graph.context_snapshot ?? null;
}

// ---------- READ: the full graph (nodes + relationships + coverage) ----------
export async function getGraph(svc: any, businessId: string): Promise<any | null> {
  return latestGraph(svc, businessId);
}

// ---------- READ: staleness only (no rebuild) ----------
export async function isStale(svc: any, businessId: string): Promise<{ stale: boolean; reasons: string[]; graph: any | null } | null> {
  const graph = await latestGraph(svc, businessId);
  if (!graph) return { stale: true, reasons: ['No graph exists yet'], graph: null };
  const sources = await loadSources(svc, businessId);
  const det = detectStaleness(graph, sources);
  if (det.stale && !graph.is_stale) {
    // Persist the freshly-detected staleness so subscribers/queries see it.
    await svc.entities.BusinessKnowledgeGraph.update(graph.id, { is_stale: true, status: 'stale', stale_reason: det.reasons.join('; ') }).catch(() => {});
    try { await bus.dispatch('KnowledgeGraphStale', { businessId, payload: { reasons: det.reasons } }); } catch {}
  }
  return { stale: det.stale, reasons: graph.is_stale ? (graph.stale_reason ? [graph.stale_reason] : ['Marked stale by upstream event']) : det.reasons, graph };
}

// ---------- WRITE: rebuild the graph from current sources ----------
// Creates a new versioned graph record, supersedes the previous latest, and
// dispatches KnowledgeGraphRebuilt so downstream modules can react.
export async function rebuildGraph(svc: any, businessId: string, actor: string): Promise<any | null> {
  const t0 = Date.now();
  const business: any = await svc.entities.Business.get(businessId);
  const sources = await loadSources(svc, businessId);
  const built = buildGraph(sources);

  const existing = await latestGraph(svc, businessId);
  const version = existing ? (existing.version || 0) + 1 : 1;

  const record = await svc.entities.BusinessKnowledgeGraph.create({
    tenant_id: business.tenant_id,
    business_id: businessId,
    version,
    status: 'fresh',
    is_stale: false,
    stale_reason: '',
    nodes: built.nodes,
    relationships: built.relationships,
    module_coverage: built.module_coverage,
    context_snapshot: built.context_snapshot,
    stats: built.stats,
    source_versions: built.source_versions,
    last_rebuilt_at: new Date().toISOString(),
    last_rebuilt_by: actor,
    rebuild_duration_ms: Date.now() - t0,
    provenance: {
      module: 'business_knowledge_graph',
      version,
      rebuilt_by: actor,
      generation_time_ms: Date.now() - t0,
      triggered_by: actor.startsWith('system:') ? 'auto' : 'manual',
    },
  });

  // Supersede the previous graph (audit history retained, only latest is live).
  if (existing && existing.id !== record.id) {
    await svc.entities.BusinessKnowledgeGraph.update(existing.id, { status: 'superseded' }).catch(() => {});
  }

  try {
    await bus.dispatch('KnowledgeGraphRebuilt', {
      businessId, tenantId: business.tenant_id, actor,
      payload: { version, node_count: built.stats.node_count, relationship_count: built.stats.relationship_count, rebuild_duration_ms: Date.now() - t0 },
    });
  } catch {}

  return record;
}

// ---------- WRITE: mark stale (used by future upstream event hooks) ----------
export async function markStale(svc: any, businessId: string, reason: string): Promise<void> {
  const graph = await latestGraph(svc, businessId);
  if (!graph || graph.is_stale) return;
  await svc.entities.BusinessKnowledgeGraph.update(graph.id, { is_stale: true, status: 'stale', stale_reason: reason }).catch(() => {});
  try { await bus.dispatch('KnowledgeGraphStale', { businessId, payload: { reason } }); } catch {}
}