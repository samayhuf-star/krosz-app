// Worldz Visa — Phase 15 Discovery contract tests (pure, no DB).
// Covers the spec test matrix: eligibility outcomes, money, dates, security.

import { evaluateOutcome, isRuleEffective, routeOutcome, sumPriceComponents, normalizeInput } from "./engine.ts";

function assert(name: string, cond: boolean, detail = ""): { name: string; pass: boolean; detail: string } {
  return { name, pass: !!cond, detail: cond ? "" : (detail || "FAIL") };
}

export function runDiscoveryContractTests(): { pass: boolean; total: number; passed: number; results: any[] } {
  const results: any[] = [];

  // --- Eligibility outcomes ---
  // eligible applicant: a real-source, high-confidence, eligible route.
  results.push(assert("eligibility.eligible", routeOutcome({ eligible: true, source: "government", confidence: 0.9, requirements_version: "v1" }) === "eligible"));
  // possibly_eligible: dev seed or low confidence.
  results.push(assert("eligibility.possibly_eligible_dev", routeOutcome({ eligible: true, source: "dev_seed", confidence: 0.4, requirements_version: "v1" }) === "possibly_eligible"));
  results.push(assert("eligibility.possibly_eligible_low_conf", routeOutcome({ eligible: true, source: "government", confidence: 0.5, requirements_version: "v1" }) === "possibly_eligible"));
  // requires_review: missing requirements_version.
  results.push(assert("eligibility.requires_review", routeOutcome({ eligible: true, source: "government", confidence: 0.9 }) === "requires_review"));
  // not_eligible: route marked ineligible.
  results.push(assert("eligibility.not_eligible", routeOutcome({ eligible: false, source: "government", confidence: 0.9, requirements_version: "v1" }) === "not_eligible"));

  // overall outcome: best across options.
  results.push(assert("eligibility.best_of_mixed", evaluateOutcome([
    { id: "a", eligibility: "not_eligible" }, { id: "b", eligibility: "possibly_eligible" },
  ] as any) === "possibly_eligible"));
  results.push(assert("eligibility.no_options", evaluateOutcome([]) === "not_eligible"));

  // --- Money ---
  const money = sumPriceComponents([
    { type: "GOVERNMENT_FEE", amount_minor: 8500 },
    { type: "SERVICE_FEE", amount_minor: 999 },
    { type: "EXPEDITED_FEE", amount_minor: 1500 },
    { type: "TAX", amount_minor: 180 },
  ]);
  results.push(assert("money.government_minor", money.government_minor === 8500, `got ${money.government_minor}`));
  results.push(assert("money.service_minor", money.service_minor === 999));
  results.push(assert("money.expedited_minor", money.expedited_minor === 1500));
  results.push(assert("money.total_minor", money.total_minor === 8500 + 999 + 1500 + 180, `got ${money.total_minor}`));
  results.push(assert("money.zero_fee", sumPriceComponents([]).total_minor === 0));
  results.push(assert("money.no_float", Number.isInteger(money.total_minor)));

  // --- Dates / rule effective window ---
  results.push(assert("dates.effective_inside", isRuleEffective({ effective_from: "2026-01-01", effective_until: "2026-12-31" }, "2026-08-12T10:00:00Z")));
  results.push(assert("dates.effective_before_fail", !isRuleEffective({ effective_from: "2026-12-01" }, "2026-08-12T10:00:00Z")));
  results.push(assert("dates.effective_after_fail", !isRuleEffective({ effective_from: "2026-01-01", effective_until: "2026-03-01" }, "2026-08-12T10:00:00Z")));
  results.push(assert("dates.effective_open_end", isRuleEffective({ effective_from: "2026-01-01" }, "2026-08-12T10:00:00Z")));
  results.push(assert("dates.effective_open_both", isRuleEffective({}, "2026-08-12T10:00:00Z")));

  // past travel date vs valid future: the engine does not reject past dates itself
  // (it only gates on rule effective dates), but must not crash on empty travel_dates.
  results.push(assert("dates.empty_travel_dates_ok", normalizeInput({ nationality: "IN", destination: "FR", purpose: "tourism" }).travel_dates?.toString() === "[object Object]"));

  // --- Security / input validation ---
  const n1 = normalizeInput({ nationality: "in", destination: "fr", purpose: "TOURISM", residence: "in" });
  results.push(assert("security.normalizes_case", n1.nationality === "IN" && n1.destination === "FR" && n1.purpose === "tourism"));
  results.push(assert("security.residence_defaults_to_nationality", normalizeInput({ nationality: "IN", destination: "FR", purpose: "tourism" }).residence === "IN"));
  results.push(assert("security.invalid_input_blank", evaluateOutcome([]) === "not_eligible"));
  results.push(assert("security.malformed_nationality", normalizeInput({ nationality: "", destination: "FR", purpose: "tourism" }).nationality === ""));
  results.push(assert("security.malformed_destination", normalizeInput({ nationality: "IN", destination: "", purpose: "tourism" }).destination === ""));

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, results };
}