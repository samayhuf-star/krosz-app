import { registerProviderAdapter } from "../registry.ts";
import { okResult, failResult } from "../results.ts";
import type { ProviderAdapter, ProviderContext, AdapterRuntime } from "../types.ts";

// Real OpenProvider REST adapter (primary domain registrar).
// Auth: bearer API key (OPENPROVIDER_API_KEY). Availability + registration call the live API.
const BASE = "https://api.openprovider.eu";

function headers(ctx: ProviderContext): Record<string, string> {
  return { Authorization: `Bearer ${ctx.credentials["OPENPROVIDER_API_KEY"] || ""}`, "Content-Type": "application/json" };
}

interface AvailabilityRow {
  name: string;
  available: boolean | null;
  price: number | null;
  currency: string;
  is_estimated: boolean;
}

const adapter: any = {
  key: "openprovider_domain",
  displayName: "OpenProvider (domain registrar)",
  category: "domain",
  credentialSchema: [{ name: "OPENPROVIDER_API_KEY", displayName: "OpenProvider API key (bearer token)", required: true }],

  async testConnection(ctx: ProviderContext, runtime: AdapterRuntime) {
    const op = "testConnection";
    const t = Date.now();
    try {
      const r = await runtime.fetchExternal(`${BASE}/v1/user/info`, { headers: headers(ctx) });
      if (r.status === 200) {
        const j: any = await r.json().catch(() => ({}));
        return okResult(ctx, op, { message: `OpenProvider OK — account ${j?.data?.handle || "verified"}`, latencyMs: Date.now() - t });
      }
      if (r.status === 401 || r.status === 403) {
        const j: any = await r.json().catch(() => ({}));
        return failResult(ctx, op, { error_code: `HTTP_${r.status}`, error_message: j?.code ? `OpenProvider: ${j.code}` : `OpenProvider rejected the API key (HTTP ${r.status}).`, retryable: false });
      }
      return failResult(ctx, op, { error_code: `HTTP_${r.status}`, error_message: `OpenProvider returned HTTP ${r.status}.`, retryable: r.status >= 500 });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "Could not reach OpenProvider API.", retryable: true });
    }
  },

  // Real availability + wholesale pricing for a batch of full domain names.
  async checkAvailability(ctx: ProviderContext, runtime: AdapterRuntime, names: string[]): Promise<ProviderResult<AvailabilityRow[]>> {
    const op = "checkAvailability";
    try {
      const r = await runtime.fetchExternal(`${BASE}/v1/domain/check`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ domains: names.map((n) => ({ name: n })) }),
      });
      const j: any = await r.json().catch(() => ({}));
      const arr: any[] = j?.data?.results || j?.data || [];
      const out: AvailabilityRow[] = names.map((n) => {
        const row: any = Array.isArray(arr) ? arr.find((x) => x?.domain === n || x?.name === n) : null;
        const avail = row && (row.status === "free" || row.available === true || row.availability === "available");
        const price = row?.price?.product?.price ? Number(row.price.product.price) : null;
        return { name: n, available: avail === undefined ? null : avail, price, currency: row?.price?.product?.currency || "USD", is_estimated: false };
      });
      return okResult(ctx, op, out);
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "OpenProvider availability failed.", retryable: true });
    }
  },

  // Real domain registration. Returns the provider order id as external_reference.
  async registerDomain(ctx: ProviderContext, runtime: AdapterRuntime, opts: { name: string; years?: number; }) {
    const op = "registerDomain";
    try {
      const r = await runtime.fetchExternal(`${BASE}/v1/at/order/domain/create`, {
        method: "POST",
        headers: headers(ctx),
        body: JSON.stringify({ domain: { name: opts.name }, period: Number(opts.years || 1) }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 200 && (j?.data?.id || j?.code === 0 || /success/i.test(j?.desc || ""))) {
        return okResult(ctx, op, { external_reference: j?.data?.id || String(j?.data || ""), status: "registered" });
      }
      return failResult(ctx, op, { error_code: `HTTP_${r.status}`, error_message: j?.longmsg || j?.desc || `OpenProvider registration returned HTTP ${r.status}.`, retryable: false });
    } catch (e) {
      return failResult(ctx, op, { error_code: "NETWORK_ERROR", error_message: (e && e.message) || "OpenProvider registration failed.", retryable: true });
    }
  },
};

registerProviderAdapter(adapter);
export default adapter;