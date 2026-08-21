import { registerProviderAdapter } from "../registry.ts";
import { okResult, failResult } from "../results.ts";
import type { ProviderAdapter, ProviderContext, AdapterRuntime } from "../types.ts";

// Real adapter: performs a genuine HTTP request to a configurable endpoint and verifies the response status.
const adapter: ProviderAdapter = {
  key: "http_rest",
  displayName: "Generic REST endpoint (HTTP ping)",
  category: "other",
  credentialSchema: [{ name: "HTTP_API_KEY", displayName: "API key (Bearer token)", required: false }],
  async testConnection(ctx: ProviderContext, runtime: AdapterRuntime) {
    const started = Date.now();
    const operation = "testConnection";
    const cfg = (ctx.adapterConfig || {}) as Record<string, unknown>;
    const testUrl = (cfg.test_url as string) || "https://httpbin.org/get";
    try {
      const headers: Record<string, string> = {};
      const apiKey = ctx.credentials["HTTP_API_KEY"];
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await runtime.fetchExternal(testUrl, { method: "GET", headers });
      const ok = res.status >= 200 && res.status < 300;
      if (ok) {
        return okResult(ctx, operation, { message: `${testUrl} returned ${res.status} ${res.statusText}`.trim(), latencyMs: Date.now() - started });
      }
      return failResult(ctx, operation, { error_code: `HTTP_${res.status}`, error_message: `${testUrl} returned ${res.status} ${res.statusText}`.trim(), retryable: res.status >= 500 });
    } catch (e) {
      return failResult(ctx, operation, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || `Could not reach ${testUrl}.`, retryable: true });
    }
  },
};

registerProviderAdapter(adapter);
export default adapter;