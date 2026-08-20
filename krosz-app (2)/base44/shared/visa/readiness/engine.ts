// Worldz Visa — Engines 9-12 readiness layer.
// Pure, deterministic, configuration-driven checks. No DB/network/LLM.
// Reuses existing traveler/passport/document/country capability data without
// duplicating regulatory truth. Unknown rules always REVIEW, never guessed.

export type ReadinessStatus = "PASS" | "FAIL" | "REVIEW" | "NOT_REQUIRED";
export type ReadinessEngine = "travel_itinerary" | "financial_accommodation" | "eligibility_risk" | "health_entry";

export interface RuleMeta {
  rule_id: string;
  source?: string | null;
  policy_version?: string | null;
  effective_from?: string | null;
  last_verified_at?: string | null;
}

export interface CheckResult extends RuleMeta {
  engine: ReadinessEngine;
  status: ReadinessStatus;
  title: string;
  reason: string;
  evidence?: Record<string, any>;
  requires_human_review?: boolean;
}

export interface EngineResult<T = any> {
  engine: ReadinessEngine;
  status: "VERIFIED" | "BLOCKED" | "NEEDS_REVIEW" | "NOT_REQUIRED";
  checks: CheckResult[];
  data?: T;
  can_continue: boolean;
  requires_human_review: boolean;
}

function iso(v: any): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function norm(v: any): string { return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " "); }
function daysBetween(a: string, b: string): number { return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }
function ageOn(dob: string, on: string): number {
  const d = new Date(dob), x = new Date(on); let age = x.getFullYear() - d.getFullYear();
  if (x.getMonth() < d.getMonth() || (x.getMonth() === d.getMonth() && x.getDate() < d.getDate())) age--;
  return age;
}
function mk(engine: ReadinessEngine, meta: RuleMeta, status: ReadinessStatus, title: string, reason: string, evidence?: Record<string, any>): CheckResult {
  return { engine, ...meta, status, title, reason, evidence, requires_human_review: status === "REVIEW" };
}
function result<T>(engine: ReadinessEngine, checks: CheckResult[], data?: T): EngineResult<T> {
  const applicable = checks.filter(x => x.status !== "NOT_REQUIRED");
  const status = !applicable.length ? "NOT_REQUIRED" : applicable.some(x => x.status === "FAIL") ? "BLOCKED" : applicable.some(x => x.status === "REVIEW") ? "NEEDS_REVIEW" : "VERIFIED";
  return { engine, status, checks, data, can_continue: status !== "BLOCKED", requires_human_review: status === "NEEDS_REVIEW" };
}

export interface TravelPolicy extends Partial<RuleMeta> {
  max_stay_days?: number | null;
  return_or_onward_required?: boolean | null;
  accommodation_required?: boolean | null;
  allowed_entry_points?: string[] | null;
  transit_review_required?: boolean | null;
}
export interface TravelInput {
  arrival?: string | null; departure?: string | null;
  onward_ticket?: { date?: string | null; passenger_name?: string | null } | null;
  traveler_name?: string | null;
  accommodation?: { check_in?: string | null; check_out?: string | null }[] | null;
  entry_point?: string | null;
  transit_countries?: string[] | null;
}
export function evaluateTravelItinerary(input: TravelInput, policy: TravelPolicy): EngineResult {
  const E: ReadinessEngine = "travel_itinerary"; const c: CheckResult[] = [];
  const meta = (id: string): RuleMeta => ({ rule_id: id, source: policy.source, policy_version: policy.policy_version, effective_from: policy.effective_from, last_verified_at: policy.last_verified_at });
  const a = iso(input.arrival), d = iso(input.departure);
  c.push(mk(E, meta("TRAVEL-001"), a && d ? (d >= a ? "PASS" : "FAIL") : "REVIEW", "Travel dates", a && d ? (d >= a ? "Arrival and departure dates are consistent." : "Departure is before arrival.") : "Travel dates are incomplete."));
  if (policy.max_stay_days == null) c.push(mk(E, meta("TRAVEL-002"), "REVIEW", "Permitted stay", "Maximum stay rule is not verified for this route."));
  else if (a && d) { const days = daysBetween(a, d); c.push(mk(E, meta("TRAVEL-002"), days <= policy.max_stay_days ? "PASS" : "FAIL", "Permitted stay", days <= policy.max_stay_days ? "Trip is within the permitted stay." : `Trip exceeds the ${policy.max_stay_days}-day limit.`, { days, max_stay_days: policy.max_stay_days })); }
  else c.push(mk(E, meta("TRAVEL-002"), "REVIEW", "Permitted stay", "Travel dates are required to evaluate permitted stay."));
  if (policy.return_or_onward_required === false) c.push(mk(E, meta("TRAVEL-003"), "NOT_REQUIRED", "Return/onward ticket", "Not required by this route."));
  else if (policy.return_or_onward_required == null) c.push(mk(E, meta("TRAVEL-003"), "REVIEW", "Return/onward ticket", "Ticket requirement is not verified."));
  else { const od = iso(input.onward_ticket?.date); c.push(mk(E, meta("TRAVEL-003"), !od ? "FAIL" : a && od >= a ? "PASS" : "FAIL", "Return/onward ticket", !od ? "Required onward/return ticket is missing." : a && od >= a ? "Onward/return ticket is chronologically valid." : "Onward/return ticket date is invalid.")); }
  if (input.onward_ticket?.passenger_name || input.traveler_name) { const ok = !!input.onward_ticket?.passenger_name && !!input.traveler_name && norm(input.onward_ticket.passenger_name) === norm(input.traveler_name); c.push(mk(E, meta("TRAVEL-004"), ok ? "PASS" : "REVIEW", "Ticket passenger identity", ok ? "Ticket passenger matches the traveler." : "Ticket passenger name needs identity review.", { ticket_name: input.onward_ticket?.passenger_name || null, traveler_name: input.traveler_name || null })); }
  if (policy.accommodation_required === false) c.push(mk(E, meta("TRAVEL-005"), "NOT_REQUIRED", "Accommodation coverage", "Accommodation proof is not required by this route."));
  else if (policy.accommodation_required == null) c.push(mk(E, meta("TRAVEL-005"), "REVIEW", "Accommodation coverage", "Accommodation requirement is not verified."));
  else { const stays = input.accommodation || []; const coverage = a && d && stays.some(x => { const ci = iso(x.check_in), co = iso(x.check_out); return !!ci && !!co && ci <= a && co >= d; }); c.push(mk(E, meta("TRAVEL-005"), coverage ? "PASS" : "FAIL", "Accommodation coverage", coverage ? "Accommodation covers the trip." : "Accommodation does not clearly cover the full trip.")); }
  if (!policy.allowed_entry_points?.length) c.push(mk(E, meta("TRAVEL-006"), "REVIEW", "Permitted entry point", "Allowed entry points are not verified for this route."));
  else c.push(mk(E, meta("TRAVEL-006"), input.entry_point ? (policy.allowed_entry_points.map(norm).includes(norm(input.entry_point)) ? "PASS" : "FAIL") : "REVIEW", "Permitted entry point", input.entry_point ? (policy.allowed_entry_points.map(norm).includes(norm(input.entry_point)) ? "Entry point is permitted." : "Selected entry point is not permitted for this route.") : "Entry point is not provided.", { entry_point: input.entry_point || null }));
  const transit = input.transit_countries || [];
  c.push(mk(E, meta("TRAVEL-007"), !transit.length ? "NOT_REQUIRED" : policy.transit_review_required === false ? "PASS" : "REVIEW", "Transit requirements", !transit.length ? "No transit country declared." : policy.transit_review_required === false ? "No additional transit review is configured." : "Transit itinerary requires route-specific review.", { transit_countries: transit }));
  return result(E, c, input);
}

export interface FinancialPolicy extends Partial<RuleMeta> {
  accommodation_required?: boolean | null;
  proof_of_funds_required?: boolean | null;
  statement_max_age_days?: number | null;
  minimum_funds_minor?: number | null;
  minimum_funds_per_day_minor?: number | null;
  currency?: string | null;
  sponsor_allowed?: boolean | null;
}
export interface FinancialInput {
  trip_days?: number | null;
  traveler_name?: string | null;
  accommodation?: { confirmed?: boolean | null; check_in?: string | null; check_out?: string | null }[] | null;
  bank_statement?: { holder_name?: string | null; statement_date?: string | null; closing_balance_minor?: number | null; currency?: string | null } | null;
  sponsor?: { present?: boolean; relationship_verified?: boolean | null; financial_evidence_present?: boolean | null } | null;
  as_of?: string | null;
}
export function evaluateFinancialAccommodation(input: FinancialInput, policy: FinancialPolicy): EngineResult {
  const E: ReadinessEngine = "financial_accommodation"; const c: CheckResult[] = [];
  const meta = (id: string): RuleMeta => ({ rule_id: id, source: policy.source, policy_version: policy.policy_version, effective_from: policy.effective_from, last_verified_at: policy.last_verified_at });
  const stays = input.accommodation || [];
  if (policy.accommodation_required === false) c.push(mk(E, meta("FIN-001"), "NOT_REQUIRED", "Accommodation evidence", "Not required by this route."));
  else if (policy.accommodation_required == null) c.push(mk(E, meta("FIN-001"), "REVIEW", "Accommodation evidence", "Accommodation evidence rule is not verified."));
  else c.push(mk(E, meta("FIN-001"), stays.some(x => x.confirmed === true) ? "PASS" : "FAIL", "Accommodation evidence", stays.some(x => x.confirmed === true) ? "Confirmed accommodation evidence is present." : "Confirmed accommodation evidence is missing."));
  if (policy.proof_of_funds_required === false) c.push(mk(E, meta("FIN-002"), "NOT_REQUIRED", "Proof of funds", "Not required by this route."));
  else if (policy.proof_of_funds_required == null) c.push(mk(E, meta("FIN-002"), "REVIEW", "Proof of funds", "Proof-of-funds rule is not verified."));
  else c.push(mk(E, meta("FIN-002"), input.bank_statement ? "PASS" : input.sponsor?.present && policy.sponsor_allowed ? "REVIEW" : "FAIL", "Proof of funds", input.bank_statement ? "Financial evidence is present." : input.sponsor?.present && policy.sponsor_allowed ? "Sponsor evidence must be verified." : "Required financial evidence is missing."));
  if (input.bank_statement) {
    const holderOk = !!input.traveler_name && !!input.bank_statement.holder_name && norm(input.traveler_name) === norm(input.bank_statement.holder_name);
    c.push(mk(E, meta("FIN-003"), holderOk ? "PASS" : "REVIEW", "Statement holder identity", holderOk ? "Bank statement holder matches traveler." : "Bank statement holder needs identity review."));
    if (policy.statement_max_age_days == null) c.push(mk(E, meta("FIN-004"), "REVIEW", "Statement freshness", "Statement freshness rule is not verified."));
    else { const sd = iso(input.bank_statement.statement_date), now = iso(input.as_of || new Date().toISOString()); const age = sd && now ? daysBetween(sd, now) : null; c.push(mk(E, meta("FIN-004"), age == null ? "REVIEW" : age <= policy.statement_max_age_days ? "PASS" : "FAIL", "Statement freshness", age == null ? "Statement date cannot be verified." : age <= policy.statement_max_age_days ? "Bank statement is recent enough." : "Bank statement is older than the allowed period.", { age_days: age, max_age_days: policy.statement_max_age_days })); }
    const base = policy.minimum_funds_minor ?? 0; const perDay = policy.minimum_funds_per_day_minor ?? 0;
    if (!base && !perDay) c.push(mk(E, meta("FIN-005"), "REVIEW", "Minimum funds", "Minimum-funds threshold is not verified."));
    else if (input.trip_days == null && perDay > 0) c.push(mk(E, meta("FIN-005"), "REVIEW", "Minimum funds", "Trip duration is required for the funds calculation."));
    else { const required = base + perDay * Math.max(0, input.trip_days || 0); const bal = input.bank_statement.closing_balance_minor; const currencyOk = !policy.currency || norm(policy.currency) === norm(input.bank_statement.currency); const status: ReadinessStatus = bal == null || !currencyOk ? "REVIEW" : bal >= required ? "PASS" : "FAIL"; c.push(mk(E, meta("FIN-005"), status, "Minimum funds", status === "PASS" ? "Available funds meet the configured threshold." : status === "FAIL" ? "Available funds are below the configured threshold." : "Funds amount/currency needs verification.", { required_minor: required, available_minor: bal ?? null, currency: input.bank_statement.currency || null, required_currency: policy.currency || null })); }
  }
  if (input.sponsor?.present) {
    if (policy.sponsor_allowed === false) c.push(mk(E, meta("FIN-006"), "FAIL", "Sponsor eligibility", "This route does not allow sponsor-based financial evidence."));
    else if (policy.sponsor_allowed == null) c.push(mk(E, meta("FIN-006"), "REVIEW", "Sponsor eligibility", "Sponsor rules are not verified."));
    else c.push(mk(E, meta("FIN-006"), input.sponsor.relationship_verified === true && input.sponsor.financial_evidence_present === true ? "PASS" : "REVIEW", "Sponsor evidence", input.sponsor.relationship_verified === true && input.sponsor.financial_evidence_present === true ? "Sponsor relationship and financial evidence are present." : "Sponsor evidence requires review."));
  }
  return result(E, c, input);
}

export interface EligibilityPolicy extends Partial<RuleMeta> {
  allowed_nationalities?: string[] | null; disallowed_nationalities?: string[] | null;
  allowed_residencies?: string[] | null; passport_types?: string[] | null;
  min_age?: number | null; max_age?: number | null; allowed_purposes?: string[] | null;
  dual_nationality_review?: boolean | null; prior_refusal_review?: boolean | null;
  prior_overstay_review?: boolean | null; criminal_history_review?: boolean | null;
}
export interface EligibilityInput {
  nationality?: string | null; residence_country?: string | null; passport_type?: string | null;
  date_of_birth?: string | null; travel_date?: string | null; purpose?: string | null;
  dual_nationality?: boolean | null; prior_refusal?: boolean | null; prior_overstay?: boolean | null;
  criminal_history_declared?: boolean | null;
}
export function evaluateEligibilityRisk(input: EligibilityInput, policy: EligibilityPolicy): EngineResult {
  const E: ReadinessEngine = "eligibility_risk"; const c: CheckResult[] = [];
  const meta = (id: string): RuleMeta => ({ rule_id: id, source: policy.source, policy_version: policy.policy_version, effective_from: policy.effective_from, last_verified_at: policy.last_verified_at });
  const nat = norm(input.nationality);
  if (!nat) c.push(mk(E, meta("ELIG9-001"), "REVIEW", "Nationality eligibility", "Nationality is missing."));
  else if (policy.disallowed_nationalities?.map(norm).includes(nat)) c.push(mk(E, meta("ELIG9-001"), "FAIL", "Nationality eligibility", "Nationality is excluded from this route."));
  else if (policy.allowed_nationalities?.length) c.push(mk(E, meta("ELIG9-001"), policy.allowed_nationalities.map(norm).includes(nat) ? "PASS" : "FAIL", "Nationality eligibility", policy.allowed_nationalities.map(norm).includes(nat) ? "Nationality is eligible." : "Nationality is not eligible for this route."));
  else c.push(mk(E, meta("ELIG9-001"), "REVIEW", "Nationality eligibility", "Nationality eligibility rule is not verified."));
  if (policy.allowed_residencies?.length) c.push(mk(E, meta("ELIG9-002"), input.residence_country ? (policy.allowed_residencies.map(norm).includes(norm(input.residence_country)) ? "PASS" : "FAIL") : "REVIEW", "Residence eligibility", input.residence_country && policy.allowed_residencies.map(norm).includes(norm(input.residence_country)) ? "Residence condition is met." : input.residence_country ? "Residence condition is not met." : "Residence country is missing."));
  if (policy.passport_types?.length) c.push(mk(E, meta("ELIG9-003"), input.passport_type ? (policy.passport_types.map(norm).includes(norm(input.passport_type)) ? "PASS" : "FAIL") : "REVIEW", "Passport type eligibility", input.passport_type && policy.passport_types.map(norm).includes(norm(input.passport_type)) ? "Passport type is eligible." : input.passport_type ? "Passport type is not eligible." : "Passport type is missing."));
  if (policy.min_age != null || policy.max_age != null) { const dob = iso(input.date_of_birth), on = iso(input.travel_date); const age = dob && on ? ageOn(dob, on) : null; const ok = age != null && (policy.min_age == null || age >= policy.min_age) && (policy.max_age == null || age <= policy.max_age); c.push(mk(E, meta("ELIG9-004"), age == null ? "REVIEW" : ok ? "PASS" : "FAIL", "Age eligibility", age == null ? "Age cannot be evaluated." : ok ? "Age condition is met." : "Age condition is not met.", { age })); }
  if (policy.allowed_purposes?.length) c.push(mk(E, meta("ELIG9-005"), input.purpose ? (policy.allowed_purposes.map(norm).includes(norm(input.purpose)) ? "PASS" : "FAIL") : "REVIEW", "Travel purpose", input.purpose && policy.allowed_purposes.map(norm).includes(norm(input.purpose)) ? "Travel purpose is supported." : input.purpose ? "Travel purpose is not supported by this route." : "Travel purpose is missing."));
  const history: [string, boolean | null | undefined, boolean | null | undefined, string][] = [
    ["ELIG9-006", input.dual_nationality, policy.dual_nationality_review, "Dual nationality"],
    ["ELIG9-007", input.prior_refusal, policy.prior_refusal_review, "Prior visa refusal"],
    ["ELIG9-008", input.prior_overstay, policy.prior_overstay_review, "Prior overstay"],
    ["ELIG9-009", input.criminal_history_declared, policy.criminal_history_review, "Criminal/immigration declaration"],
  ];
  for (const [id, declared, reviewRule, title] of history) {
    if (declared === false) c.push(mk(E, meta(id), "PASS", title, `No ${title.toLowerCase()} declared.`));
    else if (declared === true) c.push(mk(E, meta(id), reviewRule === false ? "PASS" : "REVIEW", title, reviewRule === false ? "Declared history does not trigger an additional configured restriction." : "Declared history requires rule-specific human review."));
    else c.push(mk(E, meta(id), "REVIEW", title, `${title} declaration is incomplete.`));
  }
  return result(E, c, input);
}

export interface HealthPolicy extends Partial<RuleMeta> {
  insurance_required?: boolean | null;
  vaccination_required?: boolean | null;
  vaccination_codes?: string[] | null;
  health_declaration_required?: boolean | null;
  recent_country_history_days?: number | null;
}
export interface HealthInput {
  insurance_present?: boolean | null;
  vaccinations?: string[] | null;
  health_declaration_complete?: boolean | null;
  recent_country_history?: { country: string; left_on?: string | null }[] | null;
}
export function evaluateHealthEntry(input: HealthInput, policy: HealthPolicy): EngineResult {
  const E: ReadinessEngine = "health_entry"; const c: CheckResult[] = [];
  const meta = (id: string): RuleMeta => ({ rule_id: id, source: policy.source, policy_version: policy.policy_version, effective_from: policy.effective_from, last_verified_at: policy.last_verified_at });
  if (policy.insurance_required === false) c.push(mk(E, meta("HEALTH-001"), "NOT_REQUIRED", "Travel insurance", "Not required by this route."));
  else if (policy.insurance_required == null) c.push(mk(E, meta("HEALTH-001"), "REVIEW", "Travel insurance", "Insurance requirement is not verified."));
  else c.push(mk(E, meta("HEALTH-001"), input.insurance_present === true ? "PASS" : input.insurance_present === false ? "FAIL" : "REVIEW", "Travel insurance", input.insurance_present === true ? "Required insurance evidence is present." : input.insurance_present === false ? "Required insurance evidence is missing." : "Insurance evidence status is unknown."));
  if (policy.vaccination_required === false) c.push(mk(E, meta("HEALTH-002"), "NOT_REQUIRED", "Vaccination requirement", "No vaccination requirement configured."));
  else if (policy.vaccination_required == null) c.push(mk(E, meta("HEALTH-002"), "REVIEW", "Vaccination requirement", "Vaccination rule is not verified."));
  else { const have = (input.vaccinations || []).map(norm); const need = (policy.vaccination_codes || []).map(norm); const missing = need.filter(x => !have.includes(x)); c.push(mk(E, meta("HEALTH-002"), need.length && !missing.length ? "PASS" : missing.length ? "FAIL" : "REVIEW", "Vaccination requirement", missing.length ? `Missing required vaccination evidence: ${missing.join(", ")}.` : need.length ? "Required vaccination evidence is present." : "Required vaccination codes are not configured.", { missing })); }
  if (policy.health_declaration_required === false) c.push(mk(E, meta("HEALTH-003"), "NOT_REQUIRED", "Health declaration", "No health declaration required."));
  else if (policy.health_declaration_required == null) c.push(mk(E, meta("HEALTH-003"), "REVIEW", "Health declaration", "Health declaration rule is not verified."));
  else c.push(mk(E, meta("HEALTH-003"), input.health_declaration_complete === true ? "PASS" : input.health_declaration_complete === false ? "FAIL" : "REVIEW", "Health declaration", input.health_declaration_complete === true ? "Health declaration is complete." : input.health_declaration_complete === false ? "Required health declaration is incomplete." : "Health declaration status is unknown."));
  const history = input.recent_country_history || [];
  c.push(mk(E, meta("HEALTH-004"), history.length ? "REVIEW" : "NOT_REQUIRED", "Recent-country health rules", history.length ? "Recent travel history must be evaluated against destination health-entry rules." : "No recent-country history supplied that requires conditional evaluation.", { countries: history.map(x => x.country) }));
  return result(E, c, input);
}

export function aggregateReadiness(results: EngineResult[]): { status: "READY" | "BLOCKED" | "REVIEW"; blocking: number; review: number; checks: number } {
  const checks = results.flatMap(r => r.checks);
  const blocking = checks.filter(x => x.status === "FAIL").length;
  const review = checks.filter(x => x.status === "REVIEW").length;
  return { status: blocking ? "BLOCKED" : review ? "REVIEW" : "READY", blocking, review, checks: checks.length };
}
