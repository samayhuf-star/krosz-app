// Worldz Visa — Engines 9-12 orchestrator.
// Resolves one country rule pack, evaluates only deterministic checks, and returns
// a single readiness projection. No AI/network calls. Unknown pack => REVIEW.

import {
  evaluateTravelItinerary, evaluateFinancialAccommodation, evaluateEligibilityRisk,
  evaluateHealthEntry, aggregateReadiness,
  type TravelInput, type FinancialInput, type EligibilityInput, type HealthInput,
  type EngineResult,
} from "./engine.ts";
import { getCountryRulePack, listCountryRulePacks, type CountryRulePack } from "./countryRulePacks.ts";

export interface VisaReadinessInput {
  country: string;
  nationality?: string;
  purpose?: string;
  departure_country?: string;
  travel?: TravelInput;
  financial?: FinancialInput;
  eligibility?: EligibilityInput;
  health?: HealthInput;
  qualifying_third_country_status?: { present?: boolean | null; issuer?: string | null; valid_on_travel_date?: boolean | null } | null;
}

export interface VisaReadinessProjection {
  country: string;
  nationality: string;
  purpose: string;
  rule_pack_state: "VERIFIED" | "REVIEW" | "MISSING";
  rule_version: string | null;
  journey: string | null;
  engines: EngineResult[];
  aggregate: { status: "READY" | "BLOCKED" | "REVIEW"; blocking: number; review: number; checks: number };
  route_gate: { status: "PASS" | "FAIL" | "REVIEW"; code: string; reason: string }[];
  official_sources: string[];
  notes: string[];
}

function norm(v: any): string { return String(v ?? "").trim().toUpperCase(); }

function evaluateRouteGates(pack: CountryRulePack, input: VisaReadinessInput): VisaReadinessProjection["route_gate"] {
  const gates: VisaReadinessProjection["route_gate"] = [];
  const rc = pack.route_conditions || {};
  if (rc.qualifying_third_country_status_required) {
    const q = input.qualifying_third_country_status;
    if (!q || q.present == null) gates.push({ status: "REVIEW", code: "ROUTE-QUALIFYING-STATUS", reason: "Qualifying third-country visa/residence status must be confirmed." });
    else if (!q.present) gates.push({ status: "FAIL", code: "ROUTE-QUALIFYING-STATUS", reason: "This route requires a qualifying third-country visa/residence/Green Card." });
    else {
      const allowed = (rc.qualifying_issuers || []).map(norm);
      if (!q.issuer) gates.push({ status: "REVIEW", code: "ROUTE-QUALIFYING-ISSUER", reason: "Qualifying visa/residence issuer must be verified." });
      else if (!allowed.includes(norm(q.issuer))) gates.push({ status: "FAIL", code: "ROUTE-QUALIFYING-ISSUER", reason: "The declared qualifying visa/residence issuer is not accepted for this route." });
      else if (q.valid_on_travel_date === false) gates.push({ status: "FAIL", code: "ROUTE-QUALIFYING-VALIDITY", reason: "The qualifying visa/residence is not valid for the travel date." });
      else if (q.valid_on_travel_date == null) gates.push({ status: "REVIEW", code: "ROUTE-QUALIFYING-VALIDITY", reason: "Qualifying visa/residence validity must be checked for the travel date." });
      else gates.push({ status: "PASS", code: "ROUTE-QUALIFYING-STATUS", reason: "Qualifying third-country status requirement is satisfied." });
    }
  }
  if (rc.visa_exempt_until) {
    const travelDate = input.travel?.arrival || input.eligibility?.travel_date || null;
    if (!travelDate) gates.push({ status: "REVIEW", code: "ROUTE-VISA-EXEMPT-WINDOW", reason: `Travel date is needed to confirm temporary visa exemption through ${rc.visa_exempt_until}.` });
    else if (String(travelDate).slice(0,10) <= String(rc.visa_exempt_until)) gates.push({ status: "PASS", code: "ROUTE-VISA-EXEMPT-WINDOW", reason: `Travel falls within the verified visa-exemption window through ${rc.visa_exempt_until}.` });
    else gates.push({ status: "REVIEW", code: "ROUTE-VISA-EXEMPT-WINDOW", reason: "Travel occurs after the currently verified exemption window; re-check visa requirements." });
  }
  if (pack.state === "REVIEW") gates.push({ status: "REVIEW", code: "RULE-PACK-TRANSITION", reason: "Country rules are in a verified transition/review state; do not auto-submit or auto-sell a route yet." });
  return gates;
}

export function evaluateVisaReadiness(input: VisaReadinessInput): VisaReadinessProjection {
  const country = norm(input.country), nationality = norm(input.nationality || "IN"), purpose = String(input.purpose || "tourism").toLowerCase();
  const pack = getCountryRulePack(country, nationality, purpose);
  if (!pack) {
    const engineReview: EngineResult[] = [];
    return {
      country, nationality, purpose, rule_pack_state: "MISSING", rule_version: null, journey: null,
      engines: engineReview,
      aggregate: { status: "REVIEW", blocking: 0, review: 1, checks: 0 },
      route_gate: [{ status: "REVIEW", code: "RULE-PACK-MISSING", reason: "No verified Engines 9-12 country rule pack exists for this route." }],
      official_sources: [], notes: [],
    };
  }

  const travel = evaluateTravelItinerary(input.travel || {}, pack.travel);
  const financial = evaluateFinancialAccommodation(input.financial || {}, pack.financial);
  const eligibility = evaluateEligibilityRisk({ nationality, purpose, ...(input.eligibility || {}) }, pack.eligibility);
  const health = evaluateHealthEntry(input.health || {}, pack.health);
  const engines = [travel, financial, eligibility, health];
  const base = aggregateReadiness(engines);
  const route_gate = evaluateRouteGates(pack, input);
  const gateBlocking = route_gate.filter(x => x.status === "FAIL").length;
  const gateReview = route_gate.filter(x => x.status === "REVIEW").length;
  const aggregate = {
    status: (gateBlocking || base.blocking ? "BLOCKED" : gateReview || base.review ? "REVIEW" : "READY") as "READY" | "BLOCKED" | "REVIEW",
    blocking: base.blocking + gateBlocking,
    review: base.review + gateReview,
    checks: base.checks + route_gate.length,
  };
  return {
    country, nationality, purpose, rule_pack_state: pack.state, rule_version: pack.rule_version,
    journey: pack.journey, engines, aggregate, route_gate, official_sources: [...pack.official_sources], notes: [...(pack.notes || [])],
  };
}

export function rulePackCoverage() {
  const packs = listCountryRulePacks();
  return {
    total: packs.length,
    verified: packs.filter(x => x.state === "VERIFIED").map(x => x.country),
    review: packs.filter(x => x.state === "REVIEW").map(x => x.country),
    packs: packs.map(x => ({ country: x.country, journey: x.journey, state: x.state, rule_version: x.rule_version, last_verified_at: x.last_verified_at, sources: x.official_sources })),
  };
}
