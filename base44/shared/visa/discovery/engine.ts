// Worldz Visa — Phase 15 Visa Discovery & Country Intelligence Engine.
// Deterministic discovery over the existing catalog (Country, Nationality,
// TravelPurpose, VisaType, VisaRoute, VisaProduct, VisaPrice, VisaRequirementsVersion,
// VisaSource). Pure helpers are exported for contract tests; the async check-* fns
// run server-side only — the frontend never evaluates eligibility.

import { ensureVisaCatalog } from "../catalog.ts";
import { resolveRequirements } from "../requirements.ts";
import { enrichEligibility, enrichSampleOption } from "../intelligence/engine.ts";

export type EligibilityOutcome = "eligible" | "possibly_eligible" | "not_eligible" | "requires_review";

export interface DiscoveryInput {
  nationality: string;
  destination: string;
  purpose: string;
  residence?: string;
  travel_dates?: { departure?: string; return?: string };
}

export interface VisaOptionFees {
  currency: string;
  government_minor?: number;
  service_minor?: number;
  expedited_minor?: number;
  other_minor?: number;
  total_minor: number;
  components?: any[];
}

export interface VisaOption {
  id: string;
  route_id: string;
  visa_type_key: string;
  name: string;
  category?: string;
  channel?: string;
  entry_type?: string;
  application_method?: string;
  authority?: string;
  max_stay_days?: number;
  validity_days?: number;
  entries?: number;
  appointment_required: boolean;
  processing: { standard_min?: number; standard_max?: number; expedited?: boolean; expedited_days?: number };
  fees?: VisaOptionFees;
  eligibility: EligibilityOutcome;
  requirements_version?: string;
  source?: string;
  source_name?: string;
  source_url?: string;
  verified_at?: string;
  confidence?: number;
}

export interface DiscoveryResult {
  outcome: EligibilityOutcome;
  reason: string;
  input: DiscoveryInput;
  nationality: any;
  destination: any;
  purpose: any;
  options: VisaOption[];
  version?: any;
  provenance: { source_type: string; source_name?: string; source_url?: string; verified_at?: string; confidence?: number; verified: boolean };
  _provenance: { source: string; verified: boolean };
}

const RANK: Record<EligibilityOutcome, number> = { eligible: 3, possibly_eligible: 2, requires_review: 1, not_eligible: 0 };
const BEST: EligibilityOutcome[] = ["eligible", "possibly_eligible", "requires_review", "not_eligible"];

// ---- Pure helpers (no DB) — unit-tested by discovery/contract.ts ----

// Rule effective-window check (Phase 15 §7). Open-ended ends/beginnings are allowed.
export function isRuleEffective(version: { effective_from?: string; effective_until?: string }, asOf: string): boolean {
  const d = asOf.slice(0, 10);
  if (version?.effective_from && d < version.effective_from) return false;
  if (version?.effective_until && d > version.effective_until) return false;
  return true;
}

// Integer-minor-unit sum of price components by type. Never floating-point.
export function sumPriceComponents(components: any[] = []): { government_minor: number; service_minor: number; expedited_minor: number; other_minor: number; total_minor: number } {
  const out = { government_minor: 0, service_minor: 0, expedited_minor: 0, other_minor: 0, total_minor: 0 };
  for (const c of components) {
    const amt = Number(c?.amount_minor || 0) | 0;
    const net = amt - Number(c?.discount_minor || 0) | 0;
    out.total_minor += net;
    const type = String(c?.type || c?.component_type || "").toUpperCase();
    if (type === "GOVERNMENT_FEE") out.government_minor += net;
    else if (type === "SERVICE_FEE" || type === "PROCESSING_FEE") out.service_minor += net;
    else if (type === "EXPEDITED_FEE") out.expedited_minor += net;
    else out.other_minor += net;
  }
  return out;
}

// Per-route option eligibility (deterministic). Confidence < 0.7 or dev_seed → possibly_eligible;
// missing requirements_version → requires_review; route.eligible === false → not_eligible.
export function routeOutcome(route: any): EligibilityOutcome {
  if (!route) return "not_eligible";
  if (route.eligible === false) return "not_eligible";
  const src = String(route.source || "dev_seed");
  const conf = Number(route.confidence ?? 0);
  if (!route.requirements_version) return "requires_review";
  if (src === "dev_seed" || conf < 0.7) return "possibly_eligible";
  return "eligible";
}

// Overall outcome = best across option outcomes; no options → not_eligible.
export function evaluateOutcome(options: VisaOption[]): EligibilityOutcome {
  if (!options.length) return "not_eligible";
  let best: EligibilityOutcome = "not_eligible";
  for (const o of options) if (RANK[o.eligibility] > RANK[best]) best = o.eligibility;
  return best;
}

// Normalize/validate input IDs server-side (Phase 15 §22).
export function normalizeInput(input: DiscoveryInput): DiscoveryInput {
  return {
    nationality: String(input?.nationality || "").toUpperCase(),
    residence: String(input?.residence || input?.nationality || "").toUpperCase(),
    destination: String(input?.destination || "").toUpperCase(),
    purpose: String(input?.purpose || "").toLowerCase(),
    travel_dates: input?.travel_dates || {},
  };
}

function validInput(n: DiscoveryInput): boolean {
  return !!(n.nationality && n.destination && n.purpose);
}

export async function checkEligibility(svc: any, rawInput: DiscoveryInput): Promise<DiscoveryResult> {
  const input = normalizeInput(rawInput);
  if (!validInput(input)) {
    return { outcome: "not_eligible", reason: "invalid_input", input, nationality: null, destination: null, purpose: null, options: [], provenance: { source_type: "dev_seed", verified: false }, _provenance: { source: "dev_seed", verified: false } };
  }

  const [countries, nationalities, purposeRows, routes] = await Promise.all([
    svc.entities.Country.filter({ code: input.destination }).catch(() => []),
    svc.entities.Nationality.filter({ code: input.nationality, status: "active" }).catch(() => []),
    svc.entities.TravelPurpose.filter({ key: input.purpose, status: "active" }).catch(() => []),
    svc.entities.VisaRoute.filter({ nationality: input.nationality, destination: input.destination, purpose: input.purpose, status: "active" }).catch(() => []),
  ]);
  const country = countries[0] || null;

  const nationality = nationalities[0] || { code: input.nationality, country_code: input.nationality, name: input.nationality };
  const purpose = purposeRows[0] || { key: input.purpose, label: input.purpose };

  // Filter routes by residence (exact then fallback to nationality).
  const exact = routes.filter((r: any) => String(r.residence || "").toUpperCase() === String(input.residence).toUpperCase());
  const matched = exact.length ? exact : routes.filter((r: any) => !r.residence || String(r.residence).toUpperCase() === input.nationality);
  // Deduplicate routes: the catalog has known duplicate seed rows; running
  // synthesizeOption (5 sub-queries each) for every duplicate turns a page load
  // into dozens of DB calls. Collapse to one option per visa_type_key+channel.
  const routeList: any[] = [];
  const _seenKeys = new Set<string>();
  for (const r of (matched.length ? matched : routes) as any[]) {
    const k = `${r.visa_type_key}|${r.channel || ""}|${r.residence || ""}`;
    if (_seenKeys.has(k)) continue;
    _seenKeys.add(k);
    routeList.push(r);
  }

  const options: VisaOption[] = [];
  let bestRoute: any = null;
  let versionRow: any = null;
  let sourceRow: any = null;
  for (const r of routeList) {
    const opt = await synthesizeOption(svc, r, country);
    options.push(opt);
    if (!bestRoute || RANK[opt.eligibility] > RANK[routeOutcome(bestRoute)]) bestRoute = r;
  }

  const outcome = evaluateOutcome(options);
  let reason = outcome === "not_eligible" && !routeList.length ? "no_route_in_catalog" : outcome;

  // Version + provenance from the best route's requirements version.
  if (bestRoute?.requirements_version) {
    const vs: any[] = await svc.entities.VisaRequirementsVersion.filter({ requirements_version: bestRoute.requirements_version }).catch(() => []);
    versionRow = vs[0] || null;
    if (versionRow?.source_id) {
      const ss: any[] = await svc.entities.VisaSource.filter({ id: versionRow.source_id }).catch(() => []);
      sourceRow = ss[0] || null;
    }
    // Effective-date gate: if the rule version is not effective on today, downgrade.
    if (versionRow && !isRuleEffective(versionRow, new Date().toISOString())) {
      const downgraded = options.map((o) => o.id === (bestRoute.id || bestRoute.requirements_version) ? { ...o, eligibility: "requires_review" as EligibilityOutcome } : o);
      // re-evaluate
      const nd = evaluateOutcome(downgraded);
      if (RANK[nd] < RANK[outcome]) {
        for (const o of options) if (o.id === (bestRoute.id || bestRoute.requirements_version)) o.eligibility = "requires_review";
        reason = "rule_not_effective";
      }
    }
  }

  const verified = !!versionRow?.verified_at || (sourceRow && sourceRow.source_type !== "dev_seed" && !!sourceRow.verified_at);
  const provenance = {
    source_type: String(sourceRow?.source_type || bestRoute?.source || "dev_seed"),
    source_name: sourceRow?.name,
    source_url: sourceRow?.url,
    verified_at: versionRow?.last_verified_at || sourceRow?.verified_at,
    confidence: bestRoute?.confidence,
    verified,
  };

  const base: DiscoveryResult = {
    outcome, reason, input, nationality, destination: country || { code: input.destination }, purpose,
    options, version: versionRow, provenance, _provenance: { source: provenance.source_type, verified },
  };
  return await enrichEligibility(svc, input, base);
}

export async function synthesizeOption(svc: any, route: any, country?: any): Promise<VisaOption> {
  const vtRows: any[] = await svc.entities.VisaType.filter({ visa_type_key: route.visa_type_key, status: "active" }).catch(() => []);
  const vt = vtRows[0] || {};
  // Product + price (optional; not all routes have a purchasable product yet).
  const products: any[] = await svc.entities.VisaProduct.filter({ country: route.destination, visa_type_key: route.visa_type_key, purpose: route.purpose, status: "ACTIVE" }).catch(() => []);
  const product = products[0] || null;
  let fees: VisaOptionFees | undefined;
  if (product) {
    const prices: any[] = await svc.entities.VisaPrice.filter({ product_id: product.id, status: "active" }).catch(() => []);
    const price = prices.find((p) => isRuleEffective(p, new Date().toISOString())) || prices[0];
    if (price) {
      const s = sumPriceComponents(price.components || []);
      fees = {
        currency: price.currency, government_minor: s.government_minor, service_minor: s.service_minor,
        expedited_minor: s.expedited_minor, other_minor: s.other_minor, total_minor: price.total_minor ?? s.total_minor, components: price.components,
      };
    }
  }
  // Version + source for the option provenance.
  let sourceName: string | undefined; let sourceUrl: string | undefined; let verifiedAt: string | undefined;
  if (route.requirements_version) {
    const vs: any[] = await svc.entities.VisaRequirementsVersion.filter({ requirements_version: route.requirements_version }).catch(() => []);
    const v = vs[0];
    if (v?.source_id) { const ss: any[] = await svc.entities.VisaSource.filter({ id: v.source_id }).catch(() => []); if (ss[0]) { sourceName = ss[0].name; sourceUrl = ss[0].url; } verifiedAt = v.last_verified_at || ss[0]?.verified_at; }
  }
  const expedited = (vt.processing_type === "expedited" || vt.processing_type === "both") && !!vt.expedited_processing_days;
  const stdMin = vt.processing_min_days ?? vt.typical_duration_days;
  const stdMax = vt.processing_max_days ?? vt.typical_duration_days;
  return {
    id: route.id || `${route.visa_type_key}:${route.destination}:${route.nationality}`,
    route_id: route.id,
    visa_type_key: route.visa_type_key,
    name: vt.name || route.visa_type_key,
    category: vt.category || (route.channel === "evisa" ? "evisa" : "embassy_visa"),
    channel: route.channel || vt.channel,
    entry_type: vt.entry_type,
    application_method: vt.application_method,
    authority: vt.authority,
    max_stay_days: vt.max_stay_days ?? vt.typical_duration_days,
    validity_days: vt.validity_days,
    entries: vt.entries,
    appointment_required: !!route.appointment_required,
    processing: { standard_min: stdMin, standard_max: stdMax, expedited, expedited_days: vt.expedited_processing_days },
    fees,
    eligibility: routeOutcome(route),
    requirements_version: route.requirements_version,
    source: route.source,
    source_name: sourceName,
    source_url: sourceUrl,
    verified_at: verifiedAt,
    confidence: route.confidence,
  };
}

// Destination detail: country + all active visa types + sample option for the
// most common route (IN-tourism), plus a requirements summary.
export async function getDestinationDetail(svc: any, code: string): Promise<any> {
  const dest = String(code || "").toUpperCase();
  const countries: any[] = await svc.entities.Country.filter({ code: dest }).catch(() => []);
  const country = countries[0];
  if (!country) return { country: null, visa_types: [], sample_option: null, requirements: null, _provenance: { source: "dev_seed", verified: false } };
  const visaTypes: any[] = await svc.entities.VisaType.filter({ country_code: dest, status: "active" }).catch(() => []);
  // Sample route: IN + tourism if present, else first route for this destination.
  const routes: any[] = await svc.entities.VisaRoute.filter({ destination: dest, status: "active" }).catch(() => []);
  const sampleRoute = routes.find((r) => r.nationality === "IN" && r.purpose === "tourism") || routes[0] || null;
  const sampleOptionRaw = sampleRoute ? await synthesizeOption(svc, sampleRoute, country) : null;
  const requirements = sampleRoute ? await resolveRequirements(svc, dest, sampleRoute.purpose || "tourism") : null;
  const { option: sampleOption, provider } = sampleRoute
    ? await enrichSampleOption(svc, sampleOptionRaw, sampleRoute.nationality || "IN", dest)
    : { option: sampleOptionRaw, provider: undefined };
  return { country, visa_types: visaTypes, sample_option: sampleOption, requirements, provider, _provenance: { source: (sampleRoute?.source) || "dev_seed", verified: sampleRoute?.source !== "dev_seed" } };
}

export async function getVisaOptionById(svc: any, routeId: string): Promise<VisaOption | null> {
  const route: any = await svc.entities.VisaRoute.get(routeId).catch(() => null);
  if (!route) return null;
  return synthesizeOption(svc, route);
}

export const __discovery = { ensureVisaCatalog, RANK, BEST };