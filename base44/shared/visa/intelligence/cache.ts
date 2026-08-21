// Worldz Visa (Phase 22) — server-side provider result cache (ProviderVisaCache).
// Stores normalized provider output keyed by provider + nationality + destination.
// Freshness is computed at read time from retrieved_at; never cached indefinitely.

import { FRESHNESS, type Freshness, type NormalizedVisaRequirement } from "./types.ts";
import { recordCacheHit, recordCacheMiss } from "./registry.ts";

const FRESH_MS = 6 * 60 * 60 * 1000;    // 6h
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export function computeFreshness(retrievedAt: string, now = Date.now()): Freshness {
  const t = new Date(retrievedAt).getTime();
  if (!Number.isFinite(t)) return FRESHNESS.EXPIRED;
  const age = now - t;
  if (age <= FRESH_MS) return FRESHNESS.FRESH;
  if (age <= STALE_MS) return FRESHNESS.STALE;
  return FRESHNESS.EXPIRED;
}

export async function readCache(svc: any, provider: string, nationality: string, destination: string): Promise<any | null> {
  const rows: any[] = await svc.entities.ProviderVisaCache
    .filter({ provider, nationality: nationality.toUpperCase(), destination: destination.toUpperCase() })
    .catch(() => []);
  if (!rows || !rows.length) { recordCacheMiss(provider); return null; }
  // Most-recent first.
  rows.sort((a, b) => String(b.retrieved_at || "").localeCompare(String(a.retrieved_at || "")));
  const row = rows[0];
  const freshness = computeFreshness(row.retrieved_at);
  recordCacheHit(provider);
  return { ...row, status: freshness, normalized_payload: row.normalized_payload };
}

export async function writeCache(svc: any, provider: string, norm: NormalizedVisaRequirement): Promise<any> {
  const nationality = norm.nationality.toUpperCase();
  const destination = norm.destination.toUpperCase();
  const existing: any[] = await svc.entities.ProviderVisaCache
    .filter({ provider, nationality, destination }).catch(() => []);
  const row: any = {
    provider, nationality, destination,
    visa_status: norm.visa_status,
    stay_duration_days: norm.stay_duration_days ?? null,
    confidence: norm.confidence,
    source_text: norm.source || null,
    dataset_last_updated: norm.dataset_last_updated || null,
    retrieved_at: norm.retrieved_at,
    fresh_until: new Date(Date.parse(norm.retrieved_at) + FRESH_MS).toISOString(),
    status: FRESHNESS.FRESH,
    degraded: false,
    normalized_payload: { ...norm },
    metadata: { provider_endpoint: norm.provider_endpoint },
  };
  if (existing[0]) return await svc.entities.ProviderVisaCache.update(existing[0].id, { ...existing[0], ...row }).catch(() => null);
  return await svc.entities.ProviderVisaCache.create(row).catch(() => null);
}

export async function markDegraded(svc: any, cacheRow: any): Promise<any> {
  if (!cacheRow?.id) return cacheRow;
  return await svc.entities.ProviderVisaCache.update(cacheRow.id, { degraded: true }).catch(() => cacheRow);
}

export async function invalidateCache(svc: any, opts: { nationality?: string; destination?: string; provider?: string } = {}): Promise<{ deleted: number }> {
  const q: any = {};
  if (opts.provider) q.provider = opts.provider;
  if (opts.nationality) q.nationality = opts.nationality.toUpperCase();
  if (opts.destination) q.destination = opts.destination.toUpperCase();
  if (Object.keys(q).length === 0) {
    await svc.entities.ProviderVisaCache.deleteMany({}).catch(() => null);
    return { deleted: -1 };
  }
  await svc.entities.ProviderVisaCache.deleteMany(q).catch(() => null);
  return { deleted: -1 };
}

export async function listCache(svc: any, limit = 100): Promise<any[]> {
  const rows: any[] = await svc.entities.ProviderVisaCache.filter({}, "-retrieved_at", limit).catch(() => []);
  return (rows || []).map((r) => ({ ...r, status: computeFreshness(r.retrieved_at) }));
}