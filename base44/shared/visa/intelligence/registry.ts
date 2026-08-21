// Worldz Visa (Phase 22) — Visa Intelligence provider registry, circuit breaker,
// and metrics. The discovery layer asks this registry, never a provider directly.
// Pipeworx is the primary; the fallback is "internal catalog only" (degraded path
// that returns UNAVAILABLE so discovery continues from internal VisaRoutes).

import type { VisaIntelligenceProvider, ProviderResult, NormalizedVisaRequirement } from "./types.ts";
import { createPipeworxProvider } from "./pipeworx.ts";
import { createTravelBuddyProvider } from "./travel_buddy.ts";

// ---- In-memory circuit breaker (§13) ----
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
interface CircuitStateT { state: CircuitState; failures: number; openedAt: number; halfOpenAt: number; }

const FAILURE_THRESHOLD = 3;
const OPEN_COOLDOWN_MS = 30_000;

// ---- In-memory metrics (§15) ----
export interface ProviderMetrics {
  requests_total: number;
  success_total: number;
  failure_total: number;
  timeout_total: number;
  fallback_total: number;
  cache_hit_total: number;
  cache_miss_total: number;
  latency_ms_total: number;
  latency_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  circuit: CircuitState;
  consecutive_failures: number;
}
function freshMetrics(): ProviderMetrics {
  return { requests_total: 0, success_total: 0, failure_total: 0, timeout_total: 0, fallback_total: 0, cache_hit_total: 0, cache_miss_total: 0, latency_ms_total: 0, latency_count: 0, last_success_at: null, last_failure_at: null, circuit: "CLOSED", consecutive_failures: 0 };
}

class ProviderEntry {
  provider: VisaIntelligenceProvider;
  circuit: CircuitStateT = { state: "CLOSED", failures: 0, openedAt: 0, halfOpenAt: 0 };
  metrics: ProviderMetrics = freshMetrics();
  constructor(p: VisaIntelligenceProvider) { this.provider = p; }

  isCircuitClosed(): boolean {
    const now = Date.now();
    if (this.circuit.state === "OPEN") {
      if (now - this.circuit.openedAt > OPEN_COOLDOWN_MS) {
        this.circuit.state = "HALF_OPEN"; this.circuit.halfOpenAt = now;
        this.metrics.circuit = "HALF_OPEN";
        return true; // allow a single probe
      }
      return false;
    }
    return true;
  }

  recordSuccess(latencyMs: number) {
    this.circuit.failures = 0; this.circuit.state = "CLOSED";
    this.metrics.consecutive_failures = 0;
    this.metrics.success_total++;
    this.metrics.latency_ms_total += latencyMs; this.metrics.latency_count++;
    this.metrics.last_success_at = new Date().toISOString();
    this.metrics.circuit = "CLOSED";
  }

  recordFailure(e: { transient?: boolean; timeout?: boolean }, latencyMs: number) {
    this.metrics.failure_total++;
    this.metrics.latency_ms_total += latencyMs; this.metrics.latency_count++;
    this.metrics.last_failure_at = new Date().toISOString();
    if (e?.timeout) this.metrics.timeout_total++;
    // Transient errors count toward the breaker; invalid/client errors don't.
    // Quota/billing errors are non-transient but still trip the breaker (breaker:true)
    // so the circuit opens and later reads short-circuit instead of paying latency.
    if (e?.transient !== false || e?.breaker === true) {
      this.circuit.failures++;
      this.circuit.consecutive_failures = Math.max(0, this.circuit.failures);
      if (this.circuit.failures >= FAILURE_THRESHOLD) {
        this.circuit.state = "OPEN"; this.circuit.openedAt = Date.now();
        this.metrics.circuit = "OPEN"; this.metrics.consecutive_failures = this.circuit.failures;
      }
    }
  }
}

const _entries: Map<string, ProviderEntry> = new Map();
let _initialized = false;

function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  const px = createPipeworxProvider();
  const travelBuddy = createTravelBuddyProvider();
  _entries.set("PIPEWORX", new ProviderEntry(px));
  _entries.set("TRAVEL_BUDDY", new ProviderEntry(travelBuddy));
  // Travel Buddy remains an intelligence-only sandbox provider.
}

export function getProvider(key: string): VisaIntelligenceProvider | null {
  ensureInitialized();
  return _entries.get(key)?.provider || null;
}
export function listProviders(): string[] {
  ensureInitialized();
  return Array.from(_entries.keys());
}
export function getEntry(key: string): ProviderEntry | null {
  ensureInitialized();
  return _entries.get(key) || null;
}

// Run the primary provider through the breaker. Returns a normalized result or
// a failure marker. Does NOT fabricate a visa answer on failure (§12).
export async function runProvider(
  key: string,
  fn: (p: VisaIntelligenceProvider) => Promise<ProviderResult>,
): Promise<ProviderResult & { _metrics?: any }> {
  ensureInitialized();
  const entry = _entries.get(key);
  if (!entry) return { ok: false, error: "unknown_provider", transient: false };
  if (!entry.isCircuitClosed()) {
    entry.metrics.fallback_total++;
    return { ok: false, error: "circuit_open", transient: true, _metrics: entry.metrics };
  }
  const start = Date.now();
  entry.metrics.requests_total++;
  try {
    const res = await fn(entry.provider);
    const lat = Date.now() - start;
    if (res.ok) entry.recordSuccess(lat);
    else entry.recordFailure({ transient: res.transient, breaker: (res as any).breaker, timeout: false }, lat);
    return { ...res, _metrics: entry.metrics };
  } catch (e: any) {
    const lat = Date.now() - start;
    entry.recordFailure({ transient: e?.transient !== false, breaker: e?.breaker, timeout: e?.timeout }, lat);
    return { ok: false, error: e?.message || "provider_error", transient: e?.transient !== false, _metrics: entry.metrics };
  }
}

export function snapshotHealth() {
  ensureInitialized();
  const out: any = {};
  for (const [k, e] of _entries) {
    const m = e.metrics;
    const successRate = m.requests_total ? (m.success_total / m.requests_total) * 100 : 100;
    const avgLatency = m.latency_count ? Math.round(m.latency_ms_total / m.latency_count) : 0;
    out[k] = {
      key: k, displayName: e.provider.displayName, available: e.provider.isAvailable,
      circuit: e.circuit.state === "HALF_OPEN" ? "HALF_OPEN" : e.circuit.state,
      requests_total: m.requests_total, success_total: m.success_total, failure_total: m.failure_total,
      timeout_total: m.timeout_total, fallback_total: m.fallback_total,
      cache_hits: m.cache_hit_total, cache_misses: m.cache_miss_total,
      success_rate_pct: Number(successRate.toFixed(1)),
      avg_latency_ms: avgLatency,
      last_success_at: m.last_success_at, last_failure_at: m.last_failure_at,
    };
  }
  return out;
}

export function recordCacheHit(key: string) { ensureInitialized(); const e = _entries.get(key); if (e) e.metrics.cache_hit_total++; }
export function recordCacheMiss(key: string) { ensureInitialized(); const e = _entries.get(key); if (e) e.metrics.cache_miss_total++; }

// Reset metrics + circuit (admin action / tests).
export function resetProvider(key: string) {
  ensureInitialized();
  const e = _entries.get(key);
  if (e) { e.metrics = freshMetrics(); e.circuit = { state: "CLOSED", failures: 0, openedAt: 0, halfOpenAt: 0 }; }
}

// Test seam: inject a provider under a key (contract tests).
export function _setProviderForTest(key: string, provider: VisaIntelligenceProvider) {
  _initialized = true;
  _entries.set(key, new ProviderEntry(provider));
}