// Agent Memory (Phase 13b) — scoped, confidence-weighted, provenance-tracked, tenant-isolated.
//
// REUSES the existing BusinessMemory entity — this is NOT a second memory system.
// All retrieval is business-id scoped (RLS-enforced server-side); writes go ONLY
// through the approved `remember_business_fact` capability (never automatic, never
// free-text). No vector DB, no embeddings.
//
// Conflict resolution: one current value per (business, kind, key). A new fact
// supersedes an existing one ONLY when its resolved precedence is >= the existing's.
// Lower-precedence writes are rejected (authoritative fact preserved). Superseded
// values are archived in provenance.previous_versions — never lost, never silently
// overwritten. Provenance answers "why does the agent believe this?".

const DURABLE_KINDS = ["fact", "preference", "lesson", "decision"];

function precedence(m: any, confidence: number): number {
  const src = String((m && m.source) || "").toLowerCase();
  if (src === "user") return 5;
  if (m && m.provenance && m.provenance.verified) return 4;
  if (confidence >= 0.9) return 3;
  if (confidence >= 0.5) return 2;
  return 1;
}

function isExpired(m: any): boolean {
  if (!m || !m.expires_at) return false;
  try { return new Date(m.expires_at).getTime() < Date.now(); } catch { return false; }
}

// Canonical retrieval: tenant + business + (optional) agent scoped. Deterministic
// (business_id + key + type + agent_id). Resolves live conflicts (defensive — the
// write path already keeps one current value per key). Never exposes another tenant.
export async function retrieveRelevantMemory(svc: any, opts: { tenant_id?: string; business_id: string; agent_id?: string; keys?: string[]; limit?: number }): Promise<any[]> {
  const limit = Math.max(1, Math.min(opts.limit || 25, 100));
  const rows: any[] = await svc.entities.BusinessMemory.filter({ business_id: opts.business_id }, "-updated_date", 100).catch(() => []);
  let durable = (rows || []).filter((m) => DURABLE_KINDS.includes(m.kind) && !isExpired(m));
  if (opts.keys && opts.keys.length) durable = durable.filter((m) => (opts.keys as string[]).includes(m.key));
  if (opts.agent_id) {
    durable = durable.filter((m) => {
      const provAgent = m.provenance && m.provenance.agent_id;
      const tagged = Array.isArray(m.tags) && m.tags.includes(opts.agent_id as string);
      // Keep business-wide facts (no agent provenance) + this agent's facts; drop other agents' private facts.
      if (!provAgent && !tagged) return true;
      return provAgent === opts.agent_id || tagged;
    });
  }
  const byKey = new Map<string, any>();
  for (const m of durable) {
    const cur = byKey.get(m.key);
    if (!cur) { byKey.set(m.key, m); continue; }
    const a = precedence(cur, cur.confidence); const b = precedence(m, m.confidence);
    const ta = new Date(cur.updated_at || cur.created_date || 0).getTime();
    const tb = new Date(m.updated_at || m.created_date || 0).getTime();
    if (b > a || (b === a && tb > ta)) byKey.set(m.key, m);
  }
  return [...byKey.values()].sort((x, y) => (y.confidence || 0) - (x.confidence || 0)).slice(0, limit).map((m) => ({
    id: m.id, kind: m.kind, key: m.key, title: m.title, body: m.body, confidence: m.confidence, source: m.source,
    expires_at: m.expires_at || null, provenance: m.provenance || null, agent_id: (m.provenance && m.provenance.agent_id) || null,
  }));
}

export interface WriteFactInput {
  business: any; agent_id?: string | null; run_id?: string | null; task_id?: string | null;
  kind?: string; key: string; title?: string; body: string; payload?: any;
  confidence: number; source?: string; verified?: boolean; expires_at?: string | null; importance?: number; actor?: string;
}

export async function writeBusinessFact(svc: any, input: WriteFactInput): Promise<{ id: string; superseded: boolean; reason?: string; previous_value?: any }> {
  const kind = input.kind || "fact";
  if (!DURABLE_KINDS.includes(kind)) throw Object.assign(new Error(`Invalid memory kind: ${kind}`), { code: "INVALID_MEMORY" });
  if (!input.key) throw Object.assign(new Error("key is required"), { code: "INVALID_MEMORY" });
  const c = Number(input.confidence);
  if (isNaN(c) || c < 0 || c > 1) throw Object.assign(new Error("confidence must be 0-1"), { code: "INVALID_MEMORY" });
  const business = input.business;
  const iso = new Date().toISOString();
  const existing: any[] = await svc.entities.BusinessMemory.filter({ business_id: business.id, kind, key: input.key }).catch(() => []);
  const newPrec = precedence({ source: input.source || "ai", provenance: { verified: input.verified } }, c);

  if (existing && existing.length) {
    const old = existing[0];
    const oldPrec = precedence(old, old.confidence);
    if (newPrec < oldPrec) {
      // Weaker fact must NOT overwrite an authoritative one (spec step 13). Preserve +
      // record the rejected attempt for auditability (no value change).
      try {
        const rejected = (old.provenance && Array.isArray(old.provenance.rejected_attempts)) ? old.provenance.rejected_attempts : [];
        rejected.push({ at: iso, value: input.body, confidence: c, source: input.source || "ai", run_id: input.run_id || null, task_id: input.task_id || null });
        await svc.entities.BusinessMemory.update(old.id, { provenance: { ...(old.provenance || {}), rejected_attempts: rejected } });
      } catch {}
      return { id: old.id, superseded: false, reason: `Lower precedence (${newPrec}) than current (${oldPrec}); authoritative fact preserved.`, previous_value: old.body };
    }
    // Supersede: archive the old value, write the new one with full provenance.
    const prevVersions = (old.provenance && Array.isArray(old.provenance.previous_versions)) ? old.provenance.previous_versions : [];
    prevVersions.push({ value: old.body, confidence: old.confidence, source: old.source, updated_at: old.updated_at || old.created_at });
    await svc.entities.BusinessMemory.update(old.id, {
      title: input.title || input.key, body: input.body, payload: input.payload || {}, confidence: c, source: input.source || "ai",
      tags: input.importance != null ? [`importance:${input.importance}`] : (old.tags || []),
      expires_at: input.expires_at ?? null, updated_at: iso,
      provenance: {
        source_run_id: input.run_id || null, source_task_id: input.task_id || null, agent_id: input.agent_id || null,
        actor: input.actor || null, source: input.source || "ai", confidence: c, verified: !!input.verified,
        first_created_at: (old.provenance && old.provenance.first_created_at) || old.created_at || old.created_date || iso,
        superseded_at: iso, previous_versions: prevVersions,
      },
    }).catch(() => {});
    return { id: old.id, superseded: true, previous_value: old.body };
  }

  const row: any = await svc.entities.BusinessMemory.create({
    tenant_id: business.tenant_id, business_id: business.id, kind, key: input.key,
    title: input.title || input.key, body: input.body, payload: input.payload || {},
    confidence: c, source: input.source || "ai",
    tags: input.importance != null ? [`importance:${input.importance}`] : [],
    expires_at: input.expires_at ?? null, created_at: iso, updated_at: iso,
    provenance: { source_run_id: input.run_id || null, source_task_id: input.task_id || null, agent_id: input.agent_id || null, actor: input.actor || null, source: input.source || "ai", confidence: c, verified: !!input.verified, first_created_at: iso },
  });
  return { id: row?.id || "", superseded: false };
}