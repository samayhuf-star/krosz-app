// Shared cognition helpers used by BOTH the AI Business Manager (Phase 9) and the
// AI Executive Team (Phase 10). Extracted so the two orchestration functions never
// duplicate logic — per the Phase-10 rule "Executives NEVER duplicate logic; they
// orchestrate existing engines."

const DAY = 86400000;

export function requireBusinessId(body: any): string {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BUSINESS_REQUIRED" });
  return body.business_id;
}

export function actorOf(user: any, fallback = "system"): string {
  return (user && (user.full_name || user.email)) || (user && user.id) || fallback;
}

export async function verifyTenant(svc: any, businessId: string, user: any): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  if (user && user.data && business.tenant_id && user.data.tenant_id && user.data.tenant_id !== business.tenant_id) {
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
  return business;
}

export async function collectMemory(svc: any, businessId: string): Promise<any[]> {
  const rows: any[] = await svc.entities.BusinessMemory.filter({ business_id: businessId }, "-updated_at", 50).catch(() => []);
  return (rows || []).filter((m: any) => ["fact", "preference", "lesson", "decision"].includes(m.kind)).map((m: any) => ({ kind: m.kind, key: m.key, title: m.title, body: m.body, confidence: m.confidence }));
}

export async function upsertMemory(svc: any, business: any, kind: string, key: string, title: string, body: string, payload: any, meta: any): Promise<string> {
  const existing: any[] = await svc.entities.BusinessMemory.filter({ business_id: business.id, kind, key }).catch(() => []);
  const iso = new Date().toISOString();
  if (existing && existing.length) {
    await svc.entities.BusinessMemory.update(existing[0].id, { title, body, payload, confidence: meta.confidence ?? 1, source: meta.source || "ai", tags: meta.tags, period_date: meta.period_date, updated_at: iso, provenance: { actor: meta.actor } }).catch(() => {});
    return existing[0].id;
  }
  const row: any = await svc.entities.BusinessMemory.create({ tenant_id: business.tenant_id, business_id: business.id, kind, key, title, body, payload, confidence: meta.confidence ?? 1, source: meta.source || "ai", tags: meta.tags || [], period_date: meta.period_date, created_at: iso, updated_at: iso, provenance: { actor: meta.actor } });
  return row?.id || "";
}

export function pad(n: number): string { return String(n).padStart(2, "0"); }

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

// Active/operating businesses eligible for the autonomous routines.
export async function listActiveBusinesses(svc: any, onlyBusinessId?: string): Promise<any[]> {
  const businesses: any[] = await svc.entities.Business.list("-created_date", 300).catch(() => []);
  const active = (businesses || []).filter((b) => ["active", "launched", "relaunching"].includes(b.status) && !["paused", "archived"].includes(b.lifecycle_stage));
  return onlyBusinessId ? active.filter((b) => b.id === onlyBusinessId) : active;
}