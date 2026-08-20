// Universal Integration Platform — synchronization pipeline.
// Reused by the `integrations` backend function. External data flows:
//   Integration → Connection → Auth → Sync → Knowledge Graph → Workflow → AI
// Business modules NEVER talk to external APIs directly; everything routes here.

// Map an external source/category onto the BusinessObservation.source enum.
const OBS_SOURCE_MAP: Record<string, "crm" | "seo" | "website" | "email" | "marketing" | "domain" | "operations" | "communications" | "ai" | "system"> = {
  crm: "crm", email: "email", marketing: "marketing", social: "marketing", ads: "marketing",
  messaging: "communications", collaboration: "communications", communication: "communications",
  calendar: "system", storage: "system", google: "system", payment: "system",
  accounting: "system", finance: "system", ecommerce: "system", erp: "system", custom: "system",
};

export function mapObservationSource(category: string): string {
  return OBS_SOURCE_MAP[category] || "system";
}

// ---------------- KNOWLEDGE GRAPH ----------------
// Merge external objects into the latest BusinessKnowledgeGraph as nodes,
// deduped by node id (`definition_key:external_id`). AI never cares where data
// originated — every node carries `source` provenance.
export async function latestGraph(svc: any, businessId: string): Promise<any> {
  const rows: any[] = await svc.entities.BusinessKnowledgeGraph.filter({ business_id: businessId }, "-version", 5).catch(() => []);
  return (rows || [])[0] || null;
}

export async function upsertExternalNodes(svc: any, business: any, source: string, incoming: any[], connectorId: string): Promise<any> {
  const g = await latestGraph(svc, business.id);
  const existing: any[] = (g?.nodes || []).filter((n: any) => n.source !== source);
  const bySource: any[] = (g?.nodes || []).filter((n: any) => n.source === source);
  const now = new Date().toISOString();
  let created = 0, updated = 0;
  const byId = new Map<string, any>(bySource.map((n) => [n.id, n]));
  for (const node of incoming) {
    if (!node.id) continue;
    if (byId.has(node.id)) { byId.set(node.id, { ...byId.get(node.id), ...node, updated_at: now, provenance: { source, connector_id: connectorId } }); updated++; }
    else { byId.set(node.id, { ...node, source, updated_at: now, provenance: { source, connector_id: connectorId } }); created++; }
  }
  const mergedNodes = [...existing, ...Array.from(byId.values())];
  const coverage: any = { ...(g?.module_coverage || {}), [source]: { count: byId.size, last_sync: now } };
  const sourceVersions: any = { ...(g?.source_versions || {}), [source]: now };
  let graphId: string;
  if (g) {
    await svc.entities.BusinessKnowledgeGraph.update(g.id, {
      version: (g.version || 0) + 1, status: "fresh", nodes: mergedNodes, module_coverage: coverage,
      source_versions: sourceVersions, last_rebuilt_at: now, last_rebuilt_by: `integration:${source}`, is_stale: false, stale_reason: "",
    });
    graphId = g.id;
  } else {
    const r: any = await svc.entities.BusinessKnowledgeGraph.create({
      tenant_id: business.tenant_id, business_id: business.id, version: 1, status: "fresh",
      nodes: mergedNodes, relationships: [], module_coverage: coverage, context_snapshot: {}, stats: { nodes: mergedNodes.length },
      source_versions: sourceVersions, last_rebuilt_at: now, last_rebuilt_by: `integration:${source}`, is_stale: false,
    });
    graphId = r?.id || "";
  }
  return { graph_id: graphId, created, updated, total_nodes: mergedNodes.length };
}

// ---------------- OBSERVATION ENGINE ----------------
// External events (Stripe payment failed, Shopify order, GA traffic drop…) become
// BusinessObservation records — the same engine the AI Executives already read.
export async function emitObservation(svc: any, business: any, definitionKey: string, category: string, severity: string, signalKey: string, title: string, detail: string, evidence: any): Promise<string> {
  const existing: any[] = await svc.entities.BusinessObservation.filter({ business_id: business.id, signal_key: signalKey, status: "open" }).catch(() => []);
  const iso = new Date().toISOString();
  if (existing && existing.length) {
    await svc.entities.BusinessObservation.update(existing[0].id, {
      title, detail, evidence: { ...(evidence || {}), last_seen: iso },
      severity, generated_at: iso, provenance: { integration: definitionKey },
    }).catch(() => {});
    return existing[0].id;
  }
  const r: any = await svc.entities.BusinessObservation.create({
    tenant_id: business.tenant_id, business_id: business.id,
    source: mapObservationSource(category), category: category || definitionKey,
    severity: severity || "info", signal_key: signalKey, title, detail,
    evidence: { ...(evidence || {}), last_seen: iso }, status: "open",
    generated_at: iso, provenance: { integration: definitionKey },
  }).catch(() => null);
  return r?.id || "";
}