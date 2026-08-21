// Worldz Visa (Phase 22) — Pipeworx Visa Requirements provider adapter.
// THE ONLY module that knows Pipeworx-specific details (MCP endpoint, token,
// tool names, JSON-RPC). Imported server-side only; the frontend never imports
// this and never references "pipeworx"/"gateway.pipeworx.io".

import {
  VISA_STATUS, CONFIDENCE, mapVisaStatusToken, isKnownVisaStatus, classifyConfidence,
  type NormalizedVisaRequirement, type ProviderResult, type VisaIntelligenceProvider,
  type VisaFreeDestinationsResult, type PassportCompareResult,
} from "./types.ts";

function getSecret(name: string): string {
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

const DEFAULT_ENDPOINT = "https://gateway.pipeworx.io/visa-requirements/mcp";

export interface PipeworxOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  token?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PipeworxProvider extends VisaIntelligenceProvider {
  key: string;
  displayName: string;
  isAvailable: boolean;
  getVisaRequirement(nationality: string, destination: string): Promise<ProviderResult>;
  getVisaFreeDestinations(passport: string): Promise<{ ok: boolean; result?: VisaFreeDestinationsResult; error?: string; transient?: boolean }>;
  comparePassports(passports: string[]): Promise<{ ok: boolean; result?: PassportCompareResult; error?: string; transient?: boolean }>;
  diagnose(): { available: boolean; endpoint: string; hasToken: boolean };
}

export function createPipeworxProvider(opts: PipeworxOptions = {}): PipeworxProvider {
  const fetchImpl = opts.fetchImpl || ((globalThis as any).fetch?.bind(globalThis) || null);
  const endpoint = (opts.endpoint || getSecret("PIPEWORX_MCP_ENDPOINT") || DEFAULT_ENDPOINT).trim();
  const token = opts.token || getSecret("PIPEWORX_API_TOKEN");
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRetries = opts.maxRetries ?? 2;
  const hasToken = !!(token && String(token).trim());

  // JSON-RPC 2.0 over HTTP POST. Returns structuredContent or throws a
  // classified error. Retries are handled by the caller for transient errors.
  async function callTool(name: string, args: Record<string, any>, attempt = 0): Promise<any> {
    if (!fetchImpl) throw { message: "No fetch implementation available", transient: false };
    const ctrl = (globalThis as any).AbortController ? new (globalThis as any).AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs) : null;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(hasToken ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 100000, method: "tools/call", params: { name, arguments: args } }),
        signal: ctrl?.signal,
      });
      if (res.status >= 500) {
        const err: any = { message: `pipeworx 5xx: ${res.status}`, transient: true, status: res.status };
        if (attempt < maxRetries) { await backoff(attempt); return callTool(name, args, attempt + 1); }
        throw err;
      }
      if (res.status === 401 || res.status === 403) throw { message: `pipeworx auth ${res.status}`, transient: false, status: res.status };
      // 402/429: quota / billing / rate-limit. Non-transient (retrying won't help,
      // and retrying with a 12s timeout turns a 12s page into 88s), but it SHOULD
      // trip the breaker so subsequent calls short-circuit immediately.
      if (res.status === 402 || res.status === 429) throw { message: `pipeworx quota ${res.status}`, transient: false, breaker: true, quota: true, status: res.status };
      if (res.status === 400 || res.status === 404 || res.status === 422) throw { message: `pipeworx bad request ${res.status}`, transient: false, status: res.status };
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      if (!json) {
        throw { message: `pipeworx: non-json response (${res.status}): ${text.slice(0, 200)}`, transient: false, raw: text.slice(0, 200) };
      }
      if (json.error) {
        const detail = JSON.stringify(json.error).slice(0, 300);
        const m = json.error?.message ? String(json.error.message) : `rpc_error: ${detail}`;
        const invalid = /invalid_argument|invalid_params|invalid_arguments/i.test(m);
        // Quota / billing / rate-limit: non-transient AND breaker-tripping so the
        // circuit opens and later reads short-circuit instead of paying latency.
        const quota = /payment_required|quota|rate_limit|billing|insufficient|credit/i.test(m);
        const transient = !invalid && !quota;
        throw { message: m, transient, breaker: quota, quota, code: json.error?.code, detail };
      }
      const result = json.result;
      if (!result) throw { message: "pipeworx: empty result", transient: true };
      const sc = result.structuredContent ?? (() => { try { return JSON.parse(result.content?.[0]?.text || "null"); } catch { return null; } })();
      if (result.isError || (sc && sc.error)) {
        const m = String(sc?.error || sc?.message || "tool_error");
        const missing = Array.isArray(sc?.missing) && sc.missing.length;
        throw { message: m, transient: false, invalid_arguments: true, missing };
      }
      return sc;
    } catch (e: any) {
      if (e?.transient !== undefined) throw e;
      const aborted = e?.name === "AbortError" || /aborted/i.test(String(e?.message || ""));
      if (aborted) throw { message: "pipeworx timeout", transient: true, timeout: true };
      if (attempt < maxRetries && /fetch|network|ECONN|timeout/i.test(String(e?.message || ""))) {
        await backoff(attempt); return callTool(name, args, attempt + 1);
      }
      throw { message: e?.message || "pipeworx_network_error", transient: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function backoff(attempt: number) {
    const ms = 150 * Math.pow(2, attempt);
    return new Promise((r) => setTimeout(r, ms));
  }

  function normalize(raw: any): NormalizedVisaRequirement | null {
    if (!raw || typeof raw !== "object") return null;
    const nat = String(raw?.passport?.code || raw?.nationality || "").toUpperCase();
    const dest = String(raw?.destination?.code || raw?.destination || "").toUpperCase();
    const status = mapVisaStatusToken(raw?.requirement);
    const stay = raw?.allowed_stay_days == null ? null : Number(raw.allowed_stay_days);
    if (!nat || !dest) return null; // validation failure — missing required identity
    if (!isKnownVisaStatus(raw?.requirement) && !raw?.requirement) return null;
    const confidence = classifyConfidence(status, stay);
    return {
      provider: "PIPEWORX",
      provider_endpoint: endpoint,
      nationality: nat,
      destination: dest,
      visa_status: status,
      visa_status_label: raw?.requirement_label || undefined,
      stay_duration_days: Number.isFinite(stay as any) ? (stay as number) : null,
      source: raw?.source,
      dataset_last_updated: raw?.dataset_last_updated,
      retrieved_at: new Date().toISOString(),
      verified_at: raw?.dataset_last_updated, // dataset snapshot, NOT an official decision
      confidence,
      disclaimer: raw?.disclaimer,
      provider_reference: raw?.reference || undefined,
    };
  }

  async function getVisaRequirement(nationality: string, destination: string): Promise<ProviderResult> {
    try {
      const raw = await callTool("visa_requirement", { passport: nationality, destination });
      const norm = normalize(raw);
      if (!norm) return { ok: false, error: "invalid_arguments", transient: false };
      return { ok: true, result: norm };
    } catch (e: any) {
      return { ok: false, error: e?.message || "pipeworx_error", transient: e?.transient === true, breaker: e?.breaker === true, quota: e?.quota === true };
    }
  }

  async function getVisaFreeDestinations(passport: string): Promise<any> {
    try {
      const raw = await callTool("visa_free_destinations", { passport });
      if (!raw || raw.error) return { ok: false, error: raw?.error?.message || "invalid", transient: false };
      return {
        ok: true,
        result: {
          provider: "PIPEWORX",
          passport: raw.passport || { code: passport.toUpperCase() },
          counts: raw.counts || {},
          groups: {
            visa_free: raw.visa_free || [],
            visa_on_arrival: raw.visa_on_arrival || [],
            e_visa: raw.e_visa || [],
            eta: raw.eta || [],
            visa_required: raw.visa_required,
          },
          source: raw.source, dataset_last_updated: raw.dataset_last_updated, disclaimer: raw.disclaimer,
          retrieved_at: new Date().toISOString(),
          confidence: CONFIDENCE.NORMAL,
        } as VisaFreeDestinationsResult,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || "pipeworx_error", transient: e?.transient === true };
    }
  }

  async function comparePassports(passports: string[]): Promise<any> {
    if (!Array.isArray(passports) || passports.length < 2 || passports.length > 5) {
      return { ok: false, error: "passports must be 2-5 entries", transient: false };
    }
    try {
      const raw = await callTool("visa_passport_compare", { passports });
      if (!raw || raw.error) return { ok: false, error: raw?.error?.message || "invalid", transient: false };
      return {
        ok: true,
        result: {
          provider: "PIPEWORX",
          passports: raw.passports || [],
          differences: raw.differences,
          source: raw.source, dataset_last_updated: raw.dataset_last_updated, disclaimer: raw.disclaimer,
          retrieved_at: new Date().toISOString(),
        } as PassportCompareResult,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || "pipeworx_error", transient: e?.transient === true };
    }
  }

  return {
    key: "PIPEWORX",
    displayName: "Pipeworx Visa Requirements",
    isAvailable: !!(fetchImpl && hasToken),
    getVisaRequirement,
    getVisaFreeDestinations,
    comparePassports,
    diagnose: () => ({ available: !!(fetchImpl && hasToken), endpoint, hasToken }),
  };
}

// Built with factory so contract tests can inject a fake fetch.
export default createPipeworxProvider;