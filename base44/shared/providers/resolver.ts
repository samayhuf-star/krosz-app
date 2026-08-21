import { getProviderAdapter } from "./registry.ts";
import type { ProviderContext, ProviderResult, TestConnectionData, AdapterRuntime } from "./types.ts";

export interface ResolvedProvider {
  level: "tenant_override" | "reseller_override" | "platform_default" | "platform_fallback" | "none";
  provider: any | null;
  override_id?: string;
}

// Resolution hierarchy: tenant override → reseller (white-label) override → platform default
// → any enabled provider in the category → none. A disabled override is skipped (safe fallback)
// so disabling an overridden provider silently degrades to the next level instead of failing.
export async function resolveActiveProviderChain(base44: any, category: string, tenantId?: string): Promise<ResolvedProvider> {
  const svc = base44.asServiceRole;

  if (tenantId) {
    const tenantOverrides = await svc.entities.ProviderOverride.filter({ scope_type: "tenant", scope_id: tenantId, category });
    if (tenantOverrides.length) {
      const provider = await svc.entities.Provider.get(tenantOverrides[0].provider_id).catch(() => null);
      if (provider && provider.enabled) {
        return { level: "tenant_override", provider, override_id: tenantOverrides[0].id };
      }
    }
    const tenant = await svc.entities.Tenant.get(tenantId).catch(() => null);
    const resellerId = tenant && tenant.white_label_account_id;
    if (resellerId) {
      const resellerOverrides = await svc.entities.ProviderOverride.filter({ scope_type: "reseller", scope_id: resellerId, category });
      if (resellerOverrides.length) {
        const provider = await svc.entities.Provider.get(resellerOverrides[0].provider_id).catch(() => null);
        if (provider && provider.enabled) {
          return { level: "reseller_override", provider, override_id: resellerOverrides[0].id };
        }
      }
    }
  }

  const defaults = await svc.entities.Provider.filter({ category, enabled: true, is_default: true });
  if (defaults.length) return { level: "platform_default", provider: defaults[0] };

  const enabled = await svc.entities.Provider.filter({ category, enabled: true });
  if (enabled.length) return { level: "platform_fallback", provider: enabled[0] };

  return { level: "none", provider: null };
}

// Resolve a provider by the hierarchy and then run its adapter test, building the context
// (credentials loaded from platform secrets, never exposed) on the server.
export async function resolveAndTest(
  base44: any,
  secretsGet: (name: string) => string,
  category: string,
  tenantId: string | undefined,
  runtime: AdapterRuntime
): Promise<{ resolved: ResolvedProvider; result: ProviderResult<TestConnectionData> | null }> {
  const resolved = await resolveActiveProviderChain(base44, category, tenantId);
  if (!resolved.provider) return { resolved, result: null };
  const result = await runAdapterTest(base44, secretsGet, resolved.provider, runtime);
  return { resolved, result };
}

export async function runAdapterTest(
  base44: any,
  secretsGet: (name: string) => string,
  provider: any,
  runtime: AdapterRuntime
): Promise<ProviderResult<TestConnectionData>> {
  const adapter = getProviderAdapter(provider.adapter_key);
  const creds = await base44.asServiceRole.entities.ProviderCredential.filter({ provider_id: provider.id });
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) {
    for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) {
      if (!name) continue;
      try { credentials[name] = secretsGet(name); } catch { credentials[name] = undefined; }
    }
  }
  const ctx: ProviderContext = {
    providerId: provider.id,
    providerKey: provider.key,
    category: provider.category,
    environment: provider.environment,
    adapterConfig: provider.adapter_config || {},
    credentials,
    requestId: crypto.randomUUID(),
  };
  return adapter.testConnection(ctx, runtime);
}