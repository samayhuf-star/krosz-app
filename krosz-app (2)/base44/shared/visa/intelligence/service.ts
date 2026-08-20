// Worldz Visa (Phase 22) — Visa Intelligence service: the single entrypoint the
// discovery/eligibility layer calls. Orchestrates cache → provider (registry)
// → fallback (internal) and preserves provenance + freshness.

import {
  CONFIDENCE, type NormalizedVisaRequirement, type ProviderResult, FRESHNESS,
  type VisaFreeDestinationsResult, type PassportCompareResult,
} from "./types.ts";
import { runProvider, getProvider, snapshotHealth, resetProvider } from "./registry.ts";
import { readCache, writeCache, invalidateCache, listCache, markDegraded } from "./cache.ts";

export interface ServiceResult {
  available: boolean;
  normalized?: NormalizedVisaRequirement;
  freshness: string;
  cached: boolean;
  degraded: boolean;
  error?: string;
}

function runtimeValue(name: string): string {
  try {
    const p = (globalThis as any).process;
    if (p?.env?.[name] != null) return String(p.env[name]);
  } catch {}
  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) return d.env.get(name) || "";
  } catch {}
  return "";
}

// Explicit selection wins. Otherwise a configured Travel Buddy secret enables
// the sandbox adapter; Pipeworx remains the default when it is not configured.
export function activeVisaIntelligenceProviderKey(): "PIPEWORX" | "TRAVEL_BUDDY" {
  const configured = runtimeValue("VISA_INTELLIGENCE_PROVIDER").trim().toUpperCase();
  if (configured === "TRAVEL_BUDDY") return "TRAVEL_BUDDY";
  if (configured === "PIPEWORX") return "PIPEWORX";
  return getProvider("TRAVEL_BUDDY")?.isAvailable ? "TRAVEL_BUDDY" : "PIPEWORX";
}

// getVisaRequirement: the ONLY function discovery calls.
// 1. FRESH cache → return.
// 2. call provider (circuit-gated). success → cache + return.
// 3. provider failure, STALE cache → return stale (UNAVAILABLE confidence, degraded).
// 4. provider failure, no cache → UNAVAILABLE (discovery falls back to internal rules).
export async function getVisaRequirement(
  svc: any,
  nationality: string,
  destination: string,
  opts: { bypassCache?: boolean; cacheOnly?: boolean } = {},
): Promise<ServiceResult> {
  const nat = String(nationality || "").toUpperCase();
  const dest = String(destination || "").toUpperCase();
  const providerKey = activeVisaIntelligenceProviderKey();

  // Cache-only: used by synchronous public reads (destination pages, discovery).
  // Returns FRESH/STALE cache if present; never calls the live provider, so a
  // slow/unavailable provider can never block a page render. Live refresh is a
  // separate job (admin action / scheduled), not a per-read call.
  if (opts.cacheOnly) {
    const cached = await readCache(svc, providerKey, nat, dest);
    if (cached && cached.status === FRESHNESS.FRESH) {
      return { available: true, normalized: cached.normalized_payload || toNorm(cached), freshness: FRESHNESS.FRESH, cached: true, degraded: !!cached.degraded };
    }
    if (cached && cached.normalized_payload) {
      await markDegraded(svc, cached);
      return { available: false, normalized: toNorm(cached, CONFIDENCE.UNAVAILABLE), freshness: cached.status, cached: true, degraded: true, error: "cache_only_stale" };
    }
    return { available: false, freshness: FRESHNESS.EXPIRED, cached: false, degraded: false, error: "cache_only_no_data" };
  }

  if (!opts.bypassCache) {
    const cached = await readCache(svc, providerKey, nat, dest);
    if (cached && cached.status === FRESHNESS.FRESH) {
      return { available: true, normalized: cached.normalized_payload || toNorm(cached), freshness: FRESHNESS.FRESH, cached: true, degraded: !!cached.degraded };
    }
    if (cached && cached.status === FRESHNESS.STALE) {
      // Try provider; on failure we'll reuse stale.
      const live = await fetchFromProvider(providerKey, nat, dest);
      if (live.ok && live.result) { await writeCache(svc, providerKey, live.result); return { available: true, normalized: live.result, freshness: FRESHNESS.FRESH, cached: false, degraded: false }; }
      // Stale-but-safe fallback.
      await markDegraded(svc, cached);
      return { available: false, normalized: toNorm(cached, CONFIDENCE.UNAVAILABLE), freshness: FRESHNESS.STALE, cached: true, degraded: true, error: live.error || "stale_fallback" };
    }
    if (cached && cached.status === FRESHNESS.EXPIRED) {
      // Try refresh; if it fails drop the expired row path.
      const live = await fetchFromProvider(providerKey, nat, dest);
      if (live.ok && live.result) { await writeCache(svc, providerKey, live.result); return { available: true, normalized: live.result, freshness: FRESHNESS.FRESH, cached: false, degraded: false }; }
    }
  }

  const live = await fetchFromProvider(providerKey, nat, dest);
  if (live.ok && live.result) {
    await writeCache(svc, providerKey, live.result);
    return { available: true, normalized: live.result, freshness: FRESHNESS.FRESH, cached: false, degraded: false };
  }
  // Final fallback: look for any cache (even stale) before declaring unavailable.
  const cached = await readCache(svc, providerKey, nat, dest);
  if (cached && cached.normalized_payload) {
    await markDegraded(svc, cached);
    return { available: false, normalized: toNorm(cached, CONFIDENCE.UNAVAILABLE), freshness: cached.status, cached: true, degraded: true, error: live.error || "provider_unavailable" };
  }
  return { available: false, freshness: FRESHNESS.EXPIRED, cached: false, degraded: false, error: live.error || "unavailable" };
}

async function fetchFromProvider(providerKey: "PIPEWORX" | "TRAVEL_BUDDY", nat: string, dest: string): Promise<ProviderResult> {
  return await runProvider(providerKey, (p) => p.getVisaRequirement(nat, dest));
}

function toNorm(row: any, overrideConfidence?: any): NormalizedVisaRequirement {
  const base = row?.normalized_payload || {
    provider: row?.provider || "PIPEWORX",
    nationality: row?.nationality,
    destination: row?.destination,
    visa_status: row?.visa_status,
    stay_duration_days: row?.stay_duration_days,
    source: row?.source_text,
    dataset_last_updated: row?.dataset_last_updated,
    retrieved_at: row?.retrieved_at,
    confidence: row?.confidence || CONFIDENCE.NORMAL,
    verified_at: row?.dataset_last_updated,
  };
  return overrideConfidence ? { ...base, confidence: overrideConfidence } : base;
}

export async function getVisaFreeDestinations(svc: any, passport: string, opts: { bypassCache?: boolean } = {}): Promise<{ ok: boolean; result?: VisaFreeDestinationsResult; error?: string }> {
  const px = getProvider("PIPEWORX");
  if (!px) return { ok: false, error: "provider_unavailable" };
  const r = await px.getVisaFreeDestinations!(passport);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, result: r.result };
}

export async function comparePassportMobility(svc: any, passports: string[]): Promise<{ ok: boolean; result?: PassportCompareResult; error?: string }> {
  const px = getProvider("PIPEWORX");
  if (!px) return { ok: false, error: "provider_unavailable" };
  const r = await px.comparePassports!(passports);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, result: r.result };
}

// Admin surfaces.
export function getProviderHealth() { return snapshotHealth(); }
export function resetProviderHealth(key = "PIPEWORX") { resetProvider(key); }
export { invalidateCache, listCache };

// Ensure a VisaSource row exists so rule versions can reference the provider
// as a known source (provenance), WITHOUT seeding regulatory requirement rows.
export async function ensureProviderSource(svc: any): Promise<any> {
  const providerKey = activeVisaIntelligenceProviderKey();
  const sourceType = providerKey === "TRAVEL_BUDDY" ? "travel_buddy" : "pipeworx";
  const existing: any[] = await svc.entities.VisaSource.filter({ source_type: sourceType }).catch(() => []);
  if (existing[0]) return existing[0];
  const row = providerKey === "TRAVEL_BUDDY"
    ? {
        name: "Travel Buddy Visa Requirement API",
        source_type: "travel_buddy",
        url: "https://visa-requirement.p.rapidapi.com/v2/visa/check",
        confidence: 0.7,
        status: "active",
        verified_at: null,
        metadata: { provider: "TRAVEL_BUDDY", intelligence_only: true, submission_capability: "UNSUPPORTED", note: "External visa-intelligence source via RapidAPI; verify material rules against official government sources." },
      }
    : {
        name: "Pipeworx Visa Requirements",
        source_type: "pipeworx",
        url: "https://pipeworx.io/packs/visa-requirements",
        confidence: 0.75,
        status: "active",
        verified_at: null,
        metadata: { provider: "PIPEWORX", note: "External intelligence provider — not an official government source." },
      };
  return await svc.entities.VisaSource.create(row).catch(() => null);
}