// Provider Resolver. Factories request CAPABILITIES (ai_generation, email,
// domain_registrar...), never vendors. Resolution order:
//   business primary binding → enabled? healthy? → execute
//   else fallback bindings → enabled + healthy → execute
//   else platform Provider (is_default, enabled) for the capability category → execute
//   else NONE (task fails with PROVIDER_UNAVAILABLE).
//
// Minimal for the foundation phase: maps a capability to a Provider category and
// resolves over the existing Provider entity (which now carries health_status).
// The full Circuit Breaker (failure isolation per business×provider×capability,
// 5-in-5-min degradation) is the next phase — this resolver exposes the seam.

const CAPABILITY_TO_CATEGORY: Record<string, string> = {
  ai_generation: "ai",
  email: "email",
  sms: "email",
  whatsapp: "email",
  voice: "phone",
  domain_registrar: "domain",
  hosting: "other",
  payment: "payment",
  storage: "storage",
};

export interface ResolvedProvider {
  provider_id: string;
  key: string;
  provider_key: string;
  name: string;
  category: string;
  adapter_key: string;
  capability: string;
  via: "business_binding" | "fallback_binding" | "platform_default" | "none";
}

function healthy(p: any): boolean {
  if (!p) return false;
  if (!p.enabled) return false;
  if (p.status === "disabled") return false;
  if (p.health_status === "down" || p.health_status === "degraded") return false;
  return true;
}

async function loadProvider(svc: any, id: string): Promise<any | null> {
  try { return await svc.entities.Provider.get(id); } catch { return null; }
}

export async function resolveProvider(svc: any, businessId: string, capability: string): Promise<ResolvedProvider> {
  const category = CAPABILITY_TO_CATEGORY[capability] || "other";

  // 1. Business primary binding
  const bindings = await svc.entities.BusinessProviderBinding.filter({ business_id: businessId, capability, enabled: true }).catch(() => []);
  if (bindings && bindings.length) {
    const b = bindings[0];
    for (const pid of [b.primary_provider_id, ...(b.fallback_provider_ids || [])]) {
      const p = await loadProvider(svc, pid);
      if (healthy(p)) {
        return { provider_id: p.id, key: p.key, provider_key: p.key, name: p.name, category: p.category, adapter_key: p.adapter_key, capability, via: pid === b.primary_provider_id ? "business_binding" : "fallback_binding" };
      }
    }
  }

  // 2. Platform default provider for the category
  const providers = await svc.entities.Provider.filter({ category }).catch(() => []);
  const def = (providers || []).find((p) => p.is_default && healthy(p)) || (providers || []).find((p) => healthy(p));
  if (def) {
    return { provider_id: def.id, key: def.key, provider_key: def.key, name: def.name, category: def.category, adapter_key: def.adapter_key, capability, via: "platform_default" };
  }

  return { provider_id: "", key: "", provider_key: "", name: "", category, adapter_key: "", capability, via: "none" };
}

// Record a provider failure (Circuit-Breaker seam). Updates the provider's
// failure_count + health_status once a threshold is hit. Full per-business
// isolation arrives in the circuit-breaker phase.
export async function recordProviderFailure(svc: any, providerId: string): Promise<void> {
  if (!providerId) return;
  try {
    const p: any = await svc.entities.Provider.get(providerId);
    if (!p) return;
    const count = (p.failure_count || 0) + 1;
    const health = count >= 5 ? "down" : count >= 2 ? "degraded" : (p.health_status || "unknown");
    await svc.entities.Provider.update(providerId, { failure_count: count, last_failure_at: new Date().toISOString(), health_status: health });
  } catch {}
}