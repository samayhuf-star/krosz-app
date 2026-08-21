// Worldz Visa (Phase 10) — PaymentProviderResolver.
//
// DETERMINISTIC provider selection (§14/§15): reuse the existing Provider entity
// (category "payment"); pick the first enabled, healthy provider that advertises
// the needed capability, preferring a platform default. If Stripe is bound as a
// Provider it is picked automatically — no hard-coded provider anywhere in the
// visa domain. No LLM selection.

import { getPaymentAdapter } from "./registry.ts";
import type { PaymentCapability, PaymentProviderAdapter } from "./types.ts";

export interface ResolvedPaymentProvider {
  provider: any;
  adapter: PaymentProviderAdapter;
  provider_id: string;
  provider_key: string;
  provider_type: string;
  environment: "sandbox" | "production";
  capabilities: PaymentCapability[];
  supports: (cap: PaymentCapability) => boolean;
  fallback_used: boolean;
  skipped: { provider_id: string; reason: string }[];
}

const CAP_PRIORITY: Record<PaymentCapability, number> = {
  CREATE_CHECKOUT: 0, AUTHORIZE: 1, CAPTURE: 2, REFUND: 3, STATUS: 4,
};

export async function resolvePaymentProvider(
  svc: any,
  need: PaymentCapability,
  opts?: { preferred_provider_id?: string; environment?: "sandbox" | "production" }
): Promise<ResolvedPaymentProvider> {
  const all: any[] = await svc.entities.Provider.filter({ category: "payment", enabled: true }).catch(() => []);
  // Defaults first (is_default), then by key stability; preferred id moves to front.
  const withIdx = all.map((p, i) => ({ p, i }));
  withIdx.sort((a, b) => {
    const da = a.p.is_default ? 0 : 1, db = b.p.is_default ? 0 : 1;
    if (da !== db) return da - db;
    return a.i - b.i;
  });
  if (opts?.preferred_provider_id) {
    const idx = withIdx.findIndex((x) => x.p.id === opts.preferred_provider_id);
    if (idx > 0) { const [x] = withIdx.splice(idx, 1); withIdx.unshift(x); }
  }
  const skipped: { provider_id: string; reason: string }[] = [];
  for (const { p } of withIdx) {
    if (opts?.environment && p.environment !== opts.environment) { skipped.push({ provider_id: p.id, reason: "env_mismatch" }); continue; }
    if (p.health_status === "down") { skipped.push({ provider_id: p.id, reason: "unhealthy" }); continue; }
    let adapter: PaymentProviderAdapter;
    try { adapter = getPaymentAdapter(p.adapter_key); }
    catch { skipped.push({ provider_id: p.id, reason: "no_adapter" }); continue; }
    const caps = adapter.getCapabilities({ providerId: p.id, providerKey: p.key, category: p.category, environment: p.environment, adapterConfig: p.adapter_config || {}, credentials: {}, requestId: crypto.randomUUID() } as any) || [];
    if (!caps.includes(need)) { skipped.push({ provider_id: p.id, reason: `missing_${need}` }); continue; }
    return {
      provider: p, adapter,
      provider_id: p.id, provider_key: p.key,
      provider_type: (p.adapter_config as any)?.provider_type || "PAYMENT_PROVIDER",
      environment: p.environment === "production" ? "production" : "sandbox",
      capabilities: caps,
      supports: (cap: PaymentCapability) => caps.includes(cap),
      fallback_used: skipped.length > 0 || !(p.is_default),
      skipped,
    };
  }
  const hasProvider = all.length > 0;
  throw Object.assign(new Error(hasProvider ? `No payment provider with capability ${need}` : "No payment provider configured"), { code: hasProvider ? "NO_CAPABLE_PROVIDER" : "NO_PAYMENT_PROVIDER", skipped });
}

// Build a ProviderContext with credentials loaded from ProviderCredential. Only
// presence of a configured secret name is surfaced to mocks; real adapters read
// process.env via the secrets flow (handled in the engine, not here).
export async function buildProviderContext(svc: any, provider: any): Promise<any> {
  const creds: any[] = await svc.entities.ProviderCredential.filter({ provider_id: provider.id }).catch(() => []);
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) if (name) credentials[name] = (c.key_configured || c.secret_configured) ? "(configured)" : undefined;
  return { providerId: provider.id, providerKey: provider.key, category: provider.category, environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials, requestId: crypto.randomUUID() };
}