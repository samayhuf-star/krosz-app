import { evaluateVisaReadiness, rulePackCoverage } from "./orchestrator.ts";

function t(name: string, pass: boolean, detail: any = "") { return { name, pass, detail: typeof detail === "string" ? detail : JSON.stringify(detail) }; }
function gate(r: any, code: string) { return r.route_gate.find((x: any) => x.code === code); }

export function runReadinessOrchestratorContractTests() {
  const results: any[] = [];
  const coverage = rulePackCoverage();
  results.push(t("coverage.six_mvp_packs", coverage.total === 6, coverage));
  results.push(t("coverage.primary_three_verified", ["AE","VN","ID"].every(x => coverage.verified.includes(x)), coverage));
  results.push(t("coverage.thailand_transition_review", coverage.review.includes("TH"), coverage));

  let r = evaluateVisaReadiness({
    country: "ID", nationality: "IN", purpose: "tourism",
    travel: { arrival: "2026-09-01", departure: "2026-09-10", onward_ticket: { date: "2026-09-10", passenger_name: "SAMAY VASHISHT" }, traveler_name: "SAMAY VASHISHT" },
    financial: { trip_days: 9, traveler_name: "SAMAY VASHISHT" },
    eligibility: { residence_country: "IN", passport_type: "ORDINARY", travel_date: "2026-09-01", purpose: "tourism", dual_nationality: false, prior_refusal: false, prior_overstay: false, criminal_history_declared: false },
    health: { recent_country_history: [] },
  });
  results.push(t("ID.uses_verified_pack", r.rule_pack_state === "VERIFIED" && r.rule_version === "ID-IN-EVOA-2026.08.19", r));
  results.push(t("ID.return_ticket_pass", r.engines.flatMap(x => x.checks).some((x:any) => x.rule_id === "TRAVEL-003" && x.status === "PASS"), r));

  r = evaluateVisaReadiness({
    country: "AE", nationality: "IN", purpose: "tourism",
    qualifying_third_country_status: { present: false },
    eligibility: { passport_type: "ORDINARY", purpose: "tourism", dual_nationality: false, prior_refusal: false, prior_overstay: false, criminal_history_declared: false },
  });
  results.push(t("AE.qualifying_status_blocks", gate(r, "ROUTE-QUALIFYING-STATUS")?.status === "FAIL" && r.aggregate.status === "BLOCKED", r));

  r = evaluateVisaReadiness({
    country: "AE", nationality: "IN", purpose: "tourism",
    qualifying_third_country_status: { present: true, issuer: "US", valid_on_travel_date: true },
    eligibility: { passport_type: "ORDINARY", purpose: "tourism", dual_nationality: false, prior_refusal: false, prior_overstay: false, criminal_history_declared: false },
    health: { insurance_present: true, recent_country_history: [] },
  });
  results.push(t("AE.qualifying_status_passes_gate", gate(r, "ROUTE-QUALIFYING-STATUS")?.status === "PASS", r));

  r = evaluateVisaReadiness({
    country: "MY", nationality: "IN", purpose: "tourism",
    travel: { arrival: "2026-10-01", departure: "2026-10-10", onward_ticket: { date: "2026-10-10" }, accommodation: [{ check_in: "2026-10-01", check_out: "2026-10-10" }] },
    financial: { accommodation: [{ confirmed: true }], trip_days: 9 },
    eligibility: { passport_type: "ORDINARY", travel_date: "2026-10-01", purpose: "tourism", dual_nationality: false, prior_refusal: false, prior_overstay: false, criminal_history_declared: false },
  });
  results.push(t("MY.visa_exempt_window_pass", gate(r, "ROUTE-VISA-EXEMPT-WINDOW")?.status === "PASS" && r.journey === "VISA_FREE_TEMPORARY", r));

  r = evaluateVisaReadiness({ country: "MY", nationality: "IN", purpose: "tourism", travel: { arrival: "2027-01-10", departure: "2027-01-15" }, eligibility: { passport_type: "ORDINARY", travel_date: "2027-01-10", purpose: "tourism" } });
  results.push(t("MY.post_exemption_reviews", gate(r, "ROUTE-VISA-EXEMPT-WINDOW")?.status === "REVIEW" && r.aggregate.status !== "READY", r));

  r = evaluateVisaReadiness({ country: "TH", nationality: "IN", purpose: "tourism", eligibility: { passport_type: "ORDINARY", purpose: "tourism" } });
  results.push(t("TH.never_auto_ready_during_transition", r.rule_pack_state === "REVIEW" && gate(r, "RULE-PACK-TRANSITION")?.status === "REVIEW" && r.aggregate.status === "REVIEW", r));

  r = evaluateVisaReadiness({ country: "KH", nationality: "IN", purpose: "tourism", travel: { arrival: "2026-09-01", departure: "2026-09-10", entry_point: "KTI" }, eligibility: { passport_type: "ORDINARY", purpose: "tourism", dual_nationality: false, prior_refusal: false, prior_overstay: false, criminal_history_declared: false }, health: { health_declaration_complete: true } });
  results.push(t("KH.entry_port_verified", r.engines.flatMap(x => x.checks).some((x:any) => x.rule_id === "TRAVEL-006" && x.status === "PASS"), r));

  const unknown = evaluateVisaReadiness({ country: "ZZ", nationality: "IN", purpose: "tourism" });
  results.push(t("unknown.never_guessed", unknown.rule_pack_state === "MISSING" && unknown.aggregate.status === "REVIEW", unknown));

  const pass = results.every(x => x.pass);
  return { pass, total: results.length, passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass), results };
}
