import { registerProviderAdapter } from "../registry.ts";
import { okResult, failResult } from "../results.ts";
import type { ProviderAdapter, ProviderContext, AdapterRuntime } from "../types.ts";

// OpenSRS / Tucows (backup domain registrar).
// Requires HMAC-signed requests; full signing is on the provider-integration roadmap.
// This adapter is registered so the catalog exposes the backup choice; OpenProvider
// remains the primary registrar and handles live availability + registration.
const adapter: ProviderAdapter = {
  key: "opensrs_domain",
  displayName: "OpenSRS / Tucows (backup domain registrar)",
  category: "domain",
  credentialSchema: [
    { name: "OPENSRS_RESELLER_USERNAME", displayName: "OpenSRS reseller username", required: true },
    { name: "OPENSRS_API_KEY", displayName: "OpenSRS API key", required: true },
  ],
  async testConnection(ctx: ProviderContext, runtime: AdapterRuntime) {
    const op = "testConnection";
    const hasUser = Boolean(ctx.credentials["OPENSRS_RESELLER_USERNAME"]);
    const hasKey = Boolean(ctx.credentials["OPENSRS_API_KEY"]);
    if (!hasUser || !hasKey) {
      return failResult(ctx, op, { error_code: "MISSING_CREDENTIALS", error_message: "OpenSRS reseller username and API key are required.", retryable: false });
    }
    return okResult(ctx, op, { message: "OpenSRS credentials present — HMAC-signed provisioning runs via the OpenSRS reseller API (roadmap). OpenProvider is the active primary registrar.", latencyMs: 0 });
  },
};

registerProviderAdapter(adapter);
export default adapter;