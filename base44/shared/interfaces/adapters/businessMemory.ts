// Phase 15C — Business OS MemoryPort adapter.
//
// Thin adapter that IMPLEMENTS the neutral MemoryPort contract by DELEGATING to
// the EXISTING Business OS memory implementation (no second memory store):
//   • collect() → ai/coo.ts collectMemory (canonical long-term retrieval over
//                 the single BusinessMemory entity)
//   • upsert()  → ai/coo.ts upsertMemory (canonical upsert by business+kind+key)
//   • latest()  → a read-only BusinessMemory filter (coo exposes no single-record
//                 reader; this is a thin read, not a new store or parallel runtime)
//
// Source of truth: ONE memory implementation (ai/coo.ts over the BusinessMemory
// entity). agents/memory.ts (retrieveRelevantMemory / writeBusinessFact) remains
// the conflict-resolved path used by the Agent Runtime; this adapter does not
// duplicate it — it reuses coo's canonical collect/upsert so the AI Business
// Manager / Executives and any future port consumer share the same writer.
//
// The port surface is domain-neutral: subject_id == business_id at the seam.
// `kind` values are free-form strings owned by the product module (the existing
// BusinessMemory kinds); the platform does not enumerate them.

import type { MemoryPort, MemoryRecord, MemoryQuery } from "../memory.ts";
import { collectMemory, upsertMemory } from "../../ai/coo.ts";

function toRecord(m: any, subject_id: string): MemoryRecord {
  return {
    id: m.id,
    subject_id,
    kind: m.kind,
    key: m.key,
    title: m.title,
    body: m.body,
    payload: m.payload,
    confidence: m.confidence,
    source: m.source,
    tags: m.tags,
    period_date: m.period_date,
    created_at: m.created_at || m.created_date,
    updated_at: m.updated_at || m.updated_date,
    provenance: m.provenance,
  };
}

export class BusinessMemoryPort implements MemoryPort {
  constructor(private svc: any) {}

  async collect(subject_id: string, query?: MemoryQuery): Promise<MemoryRecord[]> {
    const rows: any[] = await collectMemory(this.svc, subject_id).catch(() => []);
    let out = (rows || []).map((m) => toRecord(m, subject_id));
    const kinds = query?.kinds;
    if (kinds && kinds.length) out = out.filter((r) => kinds.includes(r.kind));
    const limit = query?.limit;
    if (limit && limit > 0) out = out.slice(0, limit);
    return out;
  }

  async upsert(
    subject: { id: string; tenant_id: string },
    kind: string,
    key: string,
    rec: Omit<MemoryRecord, "id" | "subject_id" | "kind" | "key">
  ): Promise<string> {
    const business = { id: subject.id, tenant_id: subject.tenant_id };
    // Delegate to the canonical writer. provenance.actor is the convention used by
    // coo.upsertMemory; everything else maps 1:1.
    return upsertMemory(this.svc, business, kind, key, rec.title, rec.body || "", rec.payload, {
      confidence: rec.confidence ?? 1,
      source: rec.source || "ai",
      tags: rec.tags,
      period_date: rec.period_date,
      actor: (rec.provenance && rec.provenance.actor) || "system",
    });
  }

  async latest(subject_id: string, kind: string, key: string): Promise<MemoryRecord | null> {
    // coo does not expose a single-record reader; this is a thin read over the
    // same BusinessMemory entity (not a parallel store). Most-recent by updated_at.
    const rows: any[] = await this.svc.entities.BusinessMemory.filter({ business_id: subject_id, kind, key }).catch(() => []);
    if (!rows || !rows.length) return null;
    const top = rows.sort((a, b) =>
      new Date(b.updated_at || b.updated_date || b.created_at || 0).getTime() -
      new Date(a.updated_at || a.updated_date || a.created_at || 0).getTime()
    )[0];
    return toRecord(top, subject_id);
  }
}