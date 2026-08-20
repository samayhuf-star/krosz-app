import { evaluateTravelItinerary, evaluateFinancialAccommodation, evaluateEligibilityRisk, evaluateHealthEntry, aggregateReadiness } from "./engine.ts";

function t(name: string, pass: boolean, detail: any = "") { return { name, pass, detail: typeof detail === "string" ? detail : JSON.stringify(detail) }; }
function has(r: any, id: string, status?: string) { const x = r.checks.find((c: any) => c.rule_id === id); return !!x && (!status || x.status === status); }

export function runReadinessContractTests() {
  const results: any[] = [];
  const meta = { source: "contract-test", policy_version: "TEST-v1", effective_from: "2026-01-01", last_verified_at: "2026-08-19" };

  let tr = evaluateTravelItinerary({ arrival:"2026-09-01", departure:"2026-09-10", onward_ticket:{date:"2026-09-10",passenger_name:"SAMAY VASHISHT"}, traveler_name:"SAMAY VASHISHT", accommodation:[{check_in:"2026-09-01",check_out:"2026-09-10"}], entry_point:"SGN", transit_countries:[] }, { ...meta, max_stay_days:30, return_or_onward_required:true, accommodation_required:true, allowed_entry_points:["SGN","HAN"], transit_review_required:true });
  results.push(t("E9.clean_verified", tr.status === "VERIFIED", tr));
  tr = evaluateTravelItinerary({ arrival:"2026-09-10", departure:"2026-09-01" }, { ...meta, max_stay_days:30, return_or_onward_required:true, accommodation_required:true, allowed_entry_points:["SGN"] });
  results.push(t("E9.bad_dates_block", has(tr,"TRAVEL-001","FAIL") && tr.status === "BLOCKED", tr));
  tr = evaluateTravelItinerary({ arrival:"2026-09-01", departure:"2026-11-01", onward_ticket:{date:"2026-11-01"}, accommodation:[{check_in:"2026-09-01",check_out:"2026-11-01"}], entry_point:"SGN" }, { ...meta, max_stay_days:30, return_or_onward_required:true, accommodation_required:true, allowed_entry_points:["SGN"] });
  results.push(t("E9.max_stay_block", has(tr,"TRAVEL-002","FAIL"), tr));
  tr = evaluateTravelItinerary({ arrival:"2026-09-01", departure:"2026-09-10" }, { ...meta, max_stay_days:null, return_or_onward_required:null, accommodation_required:null, allowed_entry_points:null });
  results.push(t("E9.unknown_rules_review", tr.status === "NEEDS_REVIEW" && has(tr,"TRAVEL-002","REVIEW") && has(tr,"TRAVEL-003","REVIEW"), tr));

  let fin = evaluateFinancialAccommodation({ trip_days:10, traveler_name:"SAMAY VASHISHT", accommodation:[{confirmed:true}], bank_statement:{holder_name:"SAMAY VASHISHT",statement_date:"2026-08-10",closing_balance_minor:100000,currency:"USD"}, as_of:"2026-08-19" }, { ...meta, accommodation_required:true, proof_of_funds_required:true, statement_max_age_days:30, minimum_funds_minor:20000, minimum_funds_per_day_minor:5000, currency:"USD", sponsor_allowed:true });
  results.push(t("E10.clean_verified", fin.status === "VERIFIED", fin));
  fin = evaluateFinancialAccommodation({ trip_days:10, traveler_name:"SAMAY VASHISHT", accommodation:[{confirmed:true}], bank_statement:{holder_name:"SAMAY VASHISHT",statement_date:"2026-08-10",closing_balance_minor:10000,currency:"USD"}, as_of:"2026-08-19" }, { ...meta, accommodation_required:true, proof_of_funds_required:true, statement_max_age_days:30, minimum_funds_minor:20000, minimum_funds_per_day_minor:5000, currency:"USD" });
  results.push(t("E10.low_funds_block", has(fin,"FIN-005","FAIL"), fin));
  fin = evaluateFinancialAccommodation({ sponsor:{present:true,relationship_verified:false,financial_evidence_present:true} }, { ...meta, accommodation_required:false, proof_of_funds_required:true, sponsor_allowed:true });
  results.push(t("E10.sponsor_review", has(fin,"FIN-006","REVIEW"), fin));

  let el = evaluateEligibilityRisk({ nationality:"IN", residence_country:"IN", passport_type:"ORDINARY", date_of_birth:"1990-01-01", travel_date:"2026-09-01", purpose:"tourism", dual_nationality:false, prior_refusal:false, prior_overstay:false, criminal_history_declared:false }, { ...meta, allowed_nationalities:["IN"], allowed_residencies:["IN"], passport_types:["ORDINARY"], min_age:18, allowed_purposes:["tourism"], dual_nationality_review:true, prior_refusal_review:true, prior_overstay_review:true, criminal_history_review:true });
  results.push(t("E11.clean_verified", el.status === "VERIFIED", el));
  el = evaluateEligibilityRisk({ nationality:"PK", residence_country:"IN", passport_type:"ORDINARY", date_of_birth:"1990-01-01", travel_date:"2026-09-01", purpose:"tourism", dual_nationality:false, prior_refusal:false, prior_overstay:false, criminal_history_declared:false }, { ...meta, allowed_nationalities:["IN"], allowed_residencies:["IN"], passport_types:["ORDINARY"], min_age:18, allowed_purposes:["tourism"] });
  results.push(t("E11.nationality_block", has(el,"ELIG9-001","FAIL"), el));
  el = evaluateEligibilityRisk({ nationality:"IN", residence_country:"IN", passport_type:"ORDINARY", date_of_birth:"1990-01-01", travel_date:"2026-09-01", purpose:"tourism", dual_nationality:false, prior_refusal:true, prior_overstay:false, criminal_history_declared:false }, { ...meta, allowed_nationalities:["IN"], allowed_residencies:["IN"], passport_types:["ORDINARY"], min_age:18, allowed_purposes:["tourism"], prior_refusal_review:true });
  results.push(t("E11.prior_refusal_review", has(el,"ELIG9-007","REVIEW") && el.status === "NEEDS_REVIEW", el));

  let h = evaluateHealthEntry({ insurance_present:true, vaccinations:["YF"], health_declaration_complete:true, recent_country_history:[] }, { ...meta, insurance_required:true, vaccination_required:true, vaccination_codes:["YF"], health_declaration_required:true });
  results.push(t("E12.clean_verified", h.status === "VERIFIED", h));
  h = evaluateHealthEntry({ insurance_present:false, vaccinations:[], health_declaration_complete:false, recent_country_history:[] }, { ...meta, insurance_required:true, vaccination_required:true, vaccination_codes:["YF"], health_declaration_required:true });
  results.push(t("E12.missing_evidence_blocks", h.status === "BLOCKED" && has(h,"HEALTH-001","FAIL") && has(h,"HEALTH-002","FAIL"), h));
  h = evaluateHealthEntry({ recent_country_history:[{country:"BR"}] }, { ...meta, insurance_required:false, vaccination_required:false, health_declaration_required:false });
  results.push(t("E12.recent_travel_review", has(h,"HEALTH-004","REVIEW"), h));

  const agg = aggregateReadiness([
    evaluateTravelItinerary({ arrival:"2026-09-01", departure:"2026-09-10", onward_ticket:{date:"2026-09-10"}, accommodation:[{check_in:"2026-09-01",check_out:"2026-09-10"}], entry_point:"SGN" }, { ...meta, max_stay_days:30, return_or_onward_required:true, accommodation_required:true, allowed_entry_points:["SGN"], transit_review_required:false }),
    evaluateHealthEntry({ insurance_present:true, vaccinations:[], health_declaration_complete:true }, { ...meta, insurance_required:true, vaccination_required:false, health_declaration_required:true }),
  ]);
  results.push(t("aggregate.ready", agg.status === "READY" && agg.blocking === 0 && agg.review === 0, agg));

  return { pass: results.every(x=>x.pass), total: results.length, passed: results.filter(x=>x.pass).length, failed: results.filter(x=>!x.pass), results };
}
