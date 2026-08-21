import { registerProviderAdapter, hasProviderAdapter } from "../registry.ts";
import { okResult } from "../results.ts";
import type { ProviderContext } from "../types.ts";

// Deterministic in-process mock domain registrar — a TEST provider used by the
// orchestrator's Domain-adapter integration tests when no real registrar is
// configured. It is NEVER substituted for a production provider: resolution
// returns this adapter only when a Provider entity with adapter_key
// "mock_domain" is explicitly configured (the test seeds it). registerDomain is
// deterministic (same name -> same external reference) so retries/resumes cannot
// create duplicate orders.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const adapter: any = {
  key: "mock_domain",
  displayName: "Mock Domain Registrar (deterministic test)",
  category: "domain",
  credentialSchema: [],

  async testConnection(ctx: ProviderContext) {
    return okResult(ctx, "testConnection", { message: "Mock domain registrar ready.", latencyMs: 0 });
  },
  async checkAvailability(ctx: ProviderContext, _rt: any, names: string[]) {
    return okResult(ctx, "checkAvailability", names.map((n) => ({ name: n, available: true, price: 10, currency: "USD", is_estimated: false })));
  },
  async registerDomain(ctx: ProviderContext, _rt: any, opts: { name: string; years?: number }) {
    return okResult(ctx, "registerDomain", { external_reference: `mock-${djb2(opts.name)}-${opts.years || 1}`, status: "registered", price: 10, currency: "USD" });
  },
  async configureDns(ctx: ProviderContext, _rt: any, _opts: { domain: string }) {
    return okResult(ctx, "configureDns", { status: "configured", nameservers: ["ns1.mock.example", "ns2.mock.example"], dns_verified: true });
  },
  async verifyDomain(ctx: ProviderContext, _rt: any, _opts: { domain: string }) {
    return okResult(ctx, "verifyDomain", { status: "verified", verified: true });
  },
};

// Idempotent registration: safe even if this module is imported from more than
// one place within a bundle.
if (!hasProviderAdapter("mock_domain")) registerProviderAdapter(adapter);
export default adapter;