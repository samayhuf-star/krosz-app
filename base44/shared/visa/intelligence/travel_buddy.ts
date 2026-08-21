// Orizn — Travel Buddy / RapidAPI visa-intelligence adapter.
// Intelligence-only sandbox source. It never submits applications and never
// upgrades a country's submission capability.

import {
  CONFIDENCE, classifyConfidence, isKnownVisaStatus, mapVisaStatusToken,
  type NormalizedVisaRequirement, type ProviderResult, type VisaIntelligenceProvider,
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

const DEFAULT_BASE_URL = "https://visa-requirement.p.rapidapi.com";
const DEFAULT_PATH = "/v2/visa/check";
const MVP_DESTINATIONS = new Set(["AE", "VN", "ID", "TH", "SG", "LK", "HK", "EG", "OM", "MY"]);

export interface TravelBuddyOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  host?: string;
  baseUrl?: string;
  requirementsPath?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface TravelBuddyProvider extends VisaIntelligenceProvider {
  diagnose(): { available: boolean; host: string; requirementsPath: string; hasApiKey: boolean; mode: "SANDBOX_INTELLIGENCE_ONLY" };
}

function firstDefined(...values: any[]): any {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function unwrap(raw: any): any {
  const candidate = firstDefined(raw?.data?.visaRequirements, raw?.data?.visa_requirements, raw?.data?.requirements, raw?.data, raw?.result, raw?.visaRequirements, raw?.visa_requirements, raw?.requirements, raw);
  if (Array.isArray(candidate)) return candidate[0] || null;
  return candidate;
}

function primaryRule(row: any): any {
  return firstDefined(row?.visa_rules?.primary_rule, row?.visaRules?.primaryRule, row?.primary_rule, row?.primaryRule, row);
}

function secondaryRule(row: any): any {
  return firstDefined(row?.visa_rules?.secondary_rule, row?.visaRules?.secondaryRule, row?.secondary_rule, row?.secondaryRule, null);
}

function code(value: any): string {
  if (value && typeof value === "object") value = firstDefined(value.code, value.iso2, value.iso_code, value.countryCode, value.country_code, value.id);
  return String(value || "").trim().toUpperCase();
}

function statusToken(row: any): any {
  const primary = primaryRule(row);
  return firstDefined(
    primary?.name, primary?.display_label, primary?.displayLabel,
    row?.requirement, row?.visa_status, row?.visaStatus, row?.visa_requirement,
    row?.visaRequirement, row?.status, row?.category, row?.type,
  );
}

function stayDays(row: any): number | null {
  const primary = primaryRule(row);
  const secondary = secondaryRule(row);
  const raw = firstDefined(
    primary?.duration_days, primary?.durationDays, primary?.duration,
    secondary?.duration_days, secondary?.durationDays, secondary?.duration,
    row?.allowed_stay_days, row?.allowedStayDays, row?.stay_duration_days,
    row?.stayDurationDays, row?.max_stay_days, row?.duration,
  );
  if (raw == null) return null;
  const match = String(raw).match(/\d+/);
  const value = match ? Number(match[0]) : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function createTravelBuddyProvider(opts: TravelBuddyOptions = {}): TravelBuddyProvider {
  const fetchImpl = opts.fetchImpl || ((globalThis as any).fetch?.bind(globalThis) || null);
  const apiKey = opts.apiKey || getSecret("TRAVEL_BUDDY_RAPIDAPI_KEY");
  const host = (opts.host || getSecret("TRAVEL_BUDDY_RAPIDAPI_HOST") || "visa-requirement.p.rapidapi.com").trim();
  const baseUrl = (opts.baseUrl || getSecret("TRAVEL_BUDDY_RAPIDAPI_BASE_URL") || DEFAULT_BASE_URL).replace(/\/$/, "");
  const requirementsPath = (opts.requirementsPath || getSecret("TRAVEL_BUDDY_VISA_REQUIREMENTS_PATH") || DEFAULT_PATH).trim();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRetries = opts.maxRetries ?? 1;
  const hasApiKey = !!String(apiKey || "").trim();

  async function request(nationality: string, destination: string, attempt = 0): Promise<any> {
    if (!fetchImpl) throw { message: "travel_buddy_no_fetch", transient: false };
    if (!hasApiKey) throw { message: "travel_buddy_secret_missing", transient: false };
    const ctrl = (globalThis as any).AbortController ? new (globalThis as any).AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs) : null;
    try {
      const response = await fetchImpl(baseUrl + (requirementsPath.startsWith("/") ? requirementsPath : "/" + requirementsPath), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": host,
        },
        body: JSON.stringify({
          passport: nationality,
          destination,
          Passport: nationality,
          Destination: destination,
        }),
        signal: ctrl?.signal,
      });
      if (response.status === 401 || response.status === 403) throw { message: `travel_buddy_auth_${response.status}`, transient: false };
      if (response.status === 402 || response.status === 429) throw { message: `travel_buddy_quota_${response.status}`, transient: false, breaker: true };
      if (response.status >= 500) {
        if (attempt < maxRetries) return await request(nationality, destination, attempt + 1);
        throw { message: `travel_buddy_5xx_${response.status}`, transient: true };
      }
      if (!response.ok) throw { message: `travel_buddy_http_${response.status}`, transient: false };
      const text = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
      let json: any;
      try { json = JSON.parse(text); } catch { throw { message: "travel_buddy_non_json", transient: false }; }
      return json;
    } catch (error: any) {
      if (error?.transient !== undefined) throw error;
      const aborted = error?.name === "AbortError" || /aborted/i.test(String(error?.message || ""));
      throw { message: aborted ? "travel_buddy_timeout" : (error?.message || "travel_buddy_network_error"), transient: true, timeout: aborted };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function normalize(raw: any, requestedNationality: string, requestedDestination: string): NormalizedVisaRequirement | null {
    const row = unwrap(raw);
    if (!row || typeof row !== "object") return null;
    const nationality = code(firstDefined(row?.passport?.code, row.passport, row.passport_code, row.passportCode, row.nationality, requestedNationality));
    const destination = code(firstDefined(row?.destination?.code, row.destination, row.destination_code, row.destinationCode, row.country, requestedDestination));
    const primary = primaryRule(row);
    const secondary = secondaryRule(row);
    const token = statusToken(row);
    if (!nationality || !destination || token == null) return null;
    const status = mapVisaStatusToken(token);
    const stay = stayDays(row);
    const providerConfidence = classifyConfidence(status, stay);
    return {
      provider: "TRAVEL_BUDDY",
      provider_endpoint: requirementsPath,
      nationality,
      destination,
      visa_status: status,
      visa_status_label: String(firstDefined(primary?.display_label, primary?.displayLabel, primary?.name, row.requirement_label, row.requirementLabel, row.visa_status_label, row.label, token)),
      stay_duration_days: stay,
      source: String(firstDefined(primary?.source, row.source, row.source_name, row.provider, "Travel Buddy Visa Requirement API")),
      dataset_last_updated: firstDefined(raw?.meta?.generated_at, raw?.meta?.generatedAt, row.dataset_last_updated, row.last_updated, row.updatedAt, row.updated_at),
      retrieved_at: new Date().toISOString(),
      verified_at: firstDefined(raw?.meta?.generated_at, raw?.meta?.generatedAt, row.dataset_last_updated, row.last_updated, row.updatedAt, row.updated_at),
      confidence: isKnownVisaStatus(token) ? providerConfidence : CONFIDENCE.NEEDS_REVIEW,
      provider_reference: firstDefined(primary?.link, secondary?.link, row.reference, row.id, row.slug),
      disclaimer: String(firstDefined(row.disclaimer, "Sandbox intelligence only. Verify against official government sources before relying on this result.")),
      intelligence_only: true,
      submission_capability: "UNSUPPORTED",
    };
  }

  async function getVisaRequirement(nationality: string, destination: string): Promise<ProviderResult> {
    const nat = code(nationality);
    const dest = code(destination);
    if (!nat || !dest) return { ok: false, error: "invalid_arguments", transient: false };
    try {
      const norm = normalize(await request(nat, dest), nat, dest);
      if (!norm) return { ok: false, error: "travel_buddy_schema_unrecognized", transient: false };
      return { ok: true, result: norm };
    } catch (error: any) {
      return { ok: false, error: error?.message || "travel_buddy_error", transient: error?.transient === true, breaker: error?.breaker === true };
    }
  }

  return {
    key: "TRAVEL_BUDDY",
    displayName: "Travel Buddy Visa Requirement (RapidAPI)",
    isAvailable: !!(fetchImpl && hasApiKey),
    getVisaRequirement,
    diagnose: () => ({ available: !!(fetchImpl && hasApiKey), host, requirementsPath, hasApiKey, mode: "SANDBOX_INTELLIGENCE_ONLY" }),
  };
}

export function isTravelBuddyMvpRoute(nationality: string, destination: string): boolean {
  return code(nationality) === "IN" && MVP_DESTINATIONS.has(code(destination));
}

export default createTravelBuddyProvider;
