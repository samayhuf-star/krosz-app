import { evaluatePassport, evaluatePhoto, evaluateEligibility, evaluateTravel, evaluateSupportingVisa, evaluateArrivalCard, aggregatePreflight, evaluateExecutionCapability, type EngineResult } from "./engine.ts";
import { parseMrz } from "../mrz.ts";

function t(name: string, pass: boolean, detail: any = "") { return { name, pass, detail: typeof detail === "string" ? detail : JSON.stringify(detail) }; }
function has(r: EngineResult, id: string, status?: string) { const x = r.checks.find(c => c.check_id === id); return !!x && (!status || x.status === status); }

export function runMvpEngineContractTests() {
  const results: any[] = [];

  // ICAO sample passport MRZ (valid public-spec example).
  const mrz = `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10`;
  const parsed = parseMrz(mrz);
  results.push(t("passport.mrz_valid", !!parsed?.valid, parsed?.errors || []));
  const badMrz = mrz.replace("L898902C36", "L898902C35");
  results.push(t("passport.mrz_bad_digit", parseMrz(badMrz)?.valid === false, parseMrz(badMrz)?.errors || []));

  let p = evaluatePassport({ passport: { surname:"ERIKSSON", given_names:"ANNA MARIA", passport_number:"L898902C3", nationality:"UTO", date_of_birth:"1974-08-12", expiry_date:"2032-04-15" }, mrz:{detected:true,valid:true}, travel_start:"2026-09-01", policy:{min_validity_months:6,policy_version:"TEST-v1"}, conflicts:[] });
  results.push(t("passport.clean_verified", p.status === "VERIFIED" && p.can_continue, p.status));
  p = evaluatePassport({ passport: { surname:"A", given_names:"B", passport_number:"P1", nationality:"IND", date_of_birth:"1990-01-01", expiry_date:"2020-01-01" }, mrz:{detected:true,valid:true}, travel_start:"2026-09-01", policy:{min_validity_months:6,policy_version:"TEST-v1"} });
  results.push(t("passport.expired_blocks", has(p,"PASS-005","BLOCKING") && !p.can_continue, p.checks));
  p = evaluatePassport({ passport: { surname:"A", given_names:"B", passport_number:"P1", nationality:"IND", date_of_birth:"1990-01-01", expiry_date:"2026-12-01" }, mrz:{detected:true,valid:true}, travel_start:"2026-09-01", policy:{min_validity_months:6,policy_version:"TEST-v1"} });
  results.push(t("passport.route_validity_blocks", has(p,"PASS-006","BLOCKING"), p.checks));
  p = evaluatePassport({ passport: { surname:"A", given_names:"B", passport_number:"P1", nationality:"IND", date_of_birth:"1990-01-01", expiry_date:"2030-12-01" }, mrz:{detected:false,valid:false}, travel_start:"2026-09-01", policy:{min_validity_months:null,policy_version:"UNKNOWN"}, conflicts:["passport_number"] });
  results.push(t("passport.unknown_policy_review", has(p,"PASS-006","NEEDS_REVIEW"), p.checks));
  results.push(t("passport.conflict_blocks", has(p,"PASS-007","BLOCKING"), p.checks));
  p = evaluatePassport({ passport: { surname:"A", given_names:"B", passport_number:"P1", nationality:"IND", date_of_birth:"1990-01-01", expiry_date:"2030-12-01" }, mrz:{detected:true,valid:true}, quality:{ checks:[{code:"GLARE",level:"review"}] }, travel_start:"2026-09-01", policy:{min_validity_months:6,policy_version:"TEST-v1"}, conflicts:[] });
  results.push(t("passport.quality_blocks_readiness", has(p,"PASS-008","BLOCKING") && !p.can_continue, p.checks));

  const photoPolicy = { policy_version:"VN-v1", min_width:600, min_height:800, max_bytes:1024*1024, allowed_types:["image/jpeg"], aspect_ratio:2/3, aspect_tolerance:.08, face_min_pct:60, face_max_pct:85, background:"WHITE" as const, require_single_face:true, require_frontal:true };
  let ph = evaluatePhoto({ width:800,height:1200,bytes:500000,mime_type:"image/jpeg",face_count:1,face_pct:72,background_uniformity:.9,background_brightness:.9,blur_score:.8,frontal:true }, photoPolicy);
  results.push(t("photo.clean_verified", ph.status === "VERIFIED", ph.status));
  ph = evaluatePhoto({ width:300,height:400,bytes:500000,mime_type:"image/jpeg",face_count:1,face_pct:72,background_uniformity:.9,background_brightness:.9,blur_score:.8,frontal:true }, photoPolicy);
  results.push(t("photo.low_resolution_blocks", has(ph,"PHOTO-001","BLOCKING"), ph.checks));
  ph = evaluatePhoto({ width:800,height:1200,bytes:500000,mime_type:"image/jpeg",face_count:2,face_pct:72,background_uniformity:.9,background_brightness:.9,blur_score:.8,frontal:true }, photoPolicy);
  results.push(t("photo.multiface_blocks", has(ph,"PHOTO-004","BLOCKING"), ph.checks));
  ph = evaluatePhoto({ width:800,height:1200,bytes:500000,mime_type:"image/jpeg",face_count:1,face_pct:72 }, photoPolicy);
  results.push(t("photo.unknown_visuals_review", has(ph,"PHOTO-005","NEEDS_REVIEW") && has(ph,"PHOTO-006","NEEDS_REVIEW"), ph.checks));

  let e = evaluateEligibility({ eligible:true, route:"EVISA", policy_version:"R1", verified:true });
  results.push(t("eligibility.verified_pass", e.status === "VERIFIED", e.status));
  e = evaluateEligibility({ eligible:null, route:"EVISA", policy_version:"R1", verified:false });
  results.push(t("eligibility.unverified_review", e.status === "NEEDS_REVIEW", e.status));
  e = evaluateEligibility({ eligible:false, route:"EVISA", policy_version:"R1", verified:true });
  results.push(t("eligibility.ineligible_blocks", e.status === "BLOCKED", e.status));

  let tr = evaluateTravel({ arrival:"2026-09-01",departure:"2026-09-10",hotel_check_in:"2026-09-01",hotel_check_out:"2026-09-10",onward_date:"2026-09-10",max_stay_days:30 });
  results.push(t("travel.clean_verified", tr.status === "VERIFIED", tr.status));
  tr = evaluateTravel({ arrival:"2026-09-10",departure:"2026-09-01",max_stay_days:30 });
  results.push(t("travel.date_order_blocks", has(tr,"TRIP-001","BLOCKING"), tr.checks));
  tr = evaluateTravel({ arrival:"2026-09-01",departure:"2026-11-10",max_stay_days:30 });
  results.push(t("travel.max_stay_blocks", has(tr,"TRIP-002","BLOCKING"), tr.checks));
  tr = evaluateTravel({ arrival:"2026-09-01",departure:"2026-09-10",hotel_check_in:"2026-09-02",hotel_check_out:"2026-09-09",max_stay_days:30 });
  results.push(t("travel.hotel_gap_warns", has(tr,"TRIP-003","WARNING"), tr.checks));

  let sv = evaluateSupportingVisa({ issuing_country:"GB",expiry_date:"2027-01-01",holder_name:"SAMAY" }, { allowed_issuers:["GB","US","SCHENGEN","IE"],must_be_valid_on:"2026-10-01",expected_holder_name:"SAMAY",policy_version:"TR-v1" });
  results.push(t("supporting_visa.clean_verified", sv.status === "VERIFIED", sv.status));
  sv = evaluateSupportingVisa(null, { allowed_issuers:["GB"],must_be_valid_on:"2026-10-01" });
  results.push(t("supporting_visa.missing_blocks", sv.status === "BLOCKED", sv.status));
  sv = evaluateSupportingVisa({ issuing_country:"GB",expiry_date:"2026-09-01",holder_name:"SAMAY" }, { allowed_issuers:["GB"],must_be_valid_on:"2026-10-01",expected_holder_name:"SAMAY" });
  results.push(t("supporting_visa.expired_for_trip_blocks", has(sv,"SUP-002","BLOCKING"), sv.checks));
  sv = evaluateSupportingVisa({ issuing_country:"GB",expiry_date:"2027-01-01",holder_name:"OTHER PERSON" }, { allowed_issuers:["GB"],must_be_valid_on:"2026-10-01",expected_holder_name:"SAMAY" });
  results.push(t("supporting_visa.holder_mismatch_blocks", has(sv,"SUP-003","BLOCKING"), sv.checks));

  const arrivalPolicies:any = {
    TH:{ country:"TH",form_code:"TH_TDAC",policy_version:"TEST-TH-v1",required_fields:["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address","purpose"],active:true,source:"test" },
    MY:{ country:"MY",form_code:"MY_MDAC",policy_version:"TEST-MY-v1",required_fields:["passport_number","surname","given_names","nationality","arrival_date","departure_date","transport_mode","accommodation_address"],active:true,source:"test" },
    ID:{ country:"ID",form_code:"ID_ARRIVAL",policy_version:"TEST-ID-v1",required_fields:["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address"],active:true,source:"test" },
    KH:{ country:"KH",form_code:"KH_EARRIVAL",policy_version:"TEST-KH-v1",required_fields:["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address"],active:true,source:"test" },
  };
  for (const country of ["TH","MY","ID","KH"]) {
    const sample:any = { passport_number:"P1",surname:"A",given_names:"B",nationality:"IND",arrival_date:"2026-09-01",departure_date:"2026-09-10",flight_number:"AI123",accommodation_address:"Hotel",purpose:"tourism",transport_mode:"AIR" };
    const ar = evaluateArrivalCard(country,sample,arrivalPolicies[country]);
    results.push(t(`arrival.${country}.complete`, ar.status === "VERIFIED", ar.checks));
  }
  const arMissing = evaluateArrivalCard("TH", { passport_number:"P1" }, arrivalPolicies.TH);
  results.push(t("arrival.missing_fields_blocks", arMissing.status === "BLOCKED", arMissing.checks));
  const arUnknown = evaluateArrivalCard("AE", {});
  results.push(t("arrival.unknown_policy_reviews", arUnknown.status === "NEEDS_REVIEW", arUnknown.status));
  const arNone = evaluateArrivalCard("AE", {}, { country:"AE",form_code:"NONE",policy_version:"TEST-AE-v1",required_fields:[],active:false,source:"test" });
  results.push(t("arrival.verified_not_applicable", arNone.status === "NOT_APPLICABLE", arNone.status));

  let ex = evaluateExecutionCapability({ submission_mode:"PARTNER_API",submission_provider_verified:true,tracking_mode:"PARTNER_API",tracking_provider_verified:true,manual_fallback:true });
  results.push(t("execution.real_route_verified", ex.status === "VERIFIED", ex.status));
  ex = evaluateExecutionCapability({ submission_mode:"MOCK_API",submission_provider_verified:false,tracking_mode:"MOCK",tracking_provider_verified:false,manual_fallback:true });
  results.push(t("execution.mock_never_claimed_production", ex.status === "WARNINGS" && ex.requires_human_review, ex.checks));
  ex = evaluateExecutionCapability({ submission_mode:null,submission_provider_verified:false,tracking_mode:null,tracking_provider_verified:false,manual_fallback:false });
  results.push(t("execution.no_route_blocks", ex.status === "BLOCKED", ex.checks));

  const pre = aggregatePreflight([
    evaluateEligibility({ eligible:true,route:"EVISA",verified:true }),
    evaluateTravel({ arrival:"2026-09-01",departure:"2026-09-10",max_stay_days:30 }),
  ]);
  results.push(t("preflight.aggregates_shared_checks", pre.score.applicable >= 3 && pre.can_continue, pre.score));

  const pass = results.every(x => x.pass);
  return { pass, total: results.length, passed: results.filter(x=>x.pass).length, failed: results.filter(x=>!x.pass), results };
}
