// Worldz Visa — Phase 1 shared MVP engine layer.
// Thin deterministic adapters over the existing visa domain. No duplicate review,
// eligibility, document-intelligence, submission or tracking engines are created here.

export type CheckStatus = "PASS" | "WARNING" | "BLOCKING" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
export type EngineKey = "passport_intelligence" | "photo_compliance" | "eligibility" | "preflight" | "arrival_card" | "travel_consistency" | "supporting_visa" | "submission_tracking";

export interface EngineCheck {
  check_id: string;
  engine: EngineKey;
  status: CheckStatus;
  title: string;
  customer_message: string;
  internal_reason?: string;
  evidence?: Record<string, any>;
  source?: string;
  policy_version?: string | null;
  can_auto_fix?: boolean;
  requires_human_review?: boolean;
}

export interface EngineResult<T = any> {
  engine: EngineKey;
  status: "VERIFIED" | "WARNINGS" | "BLOCKED" | "NEEDS_REVIEW" | "NOT_APPLICABLE";
  checks: EngineCheck[];
  data?: T;
  can_continue: boolean;
  requires_human_review: boolean;
  score: { passed: number; applicable: number; pct: number };
}

function resultStatus(checks: EngineCheck[]): EngineResult["status"] {
  const applicable = checks.filter(c => c.status !== "NOT_APPLICABLE");
  if (!applicable.length) return "NOT_APPLICABLE";
  if (applicable.some(c => c.status === "BLOCKING")) return "BLOCKED";
  if (applicable.some(c => c.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (applicable.some(c => c.status === "WARNING")) return "WARNINGS";
  return "VERIFIED";
}

export function buildEngineResult<T>(engine: EngineKey, checks: EngineCheck[], data?: T): EngineResult<T> {
  const applicable = checks.filter(c => c.status !== "NOT_APPLICABLE");
  const passed = applicable.filter(c => c.status === "PASS").length;
  const status = resultStatus(checks);
  return {
    engine, status, checks, data,
    can_continue: status !== "BLOCKED",
    requires_human_review: applicable.some(c => c.requires_human_review || c.status === "NEEDS_REVIEW"),
    score: { passed, applicable: applicable.length, pct: applicable.length ? Math.round(passed / applicable.length * 100) : 100 },
  };
}

function c(engine: EngineKey, check_id: string, status: CheckStatus, title: string, customer_message: string, extra: Partial<EngineCheck> = {}): EngineCheck {
  return { engine, check_id, status, title, customer_message, ...extra };
}
function isoDate(v: any): string | null {
  if (!v) return null; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) return null; return d.toISOString().slice(0, 10);
}
function norm(v: any): string { return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " "); }
function monthsBetween(a: string, b: string): number {
  const x = new Date(a), y = new Date(b); return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) + (y.getDate() >= x.getDate() ? 0 : -1);
}

// ---------- Engine 1: Passport Intelligence projection ----------
export interface PassportPolicy { min_validity_months?: number | null; policy_version?: string | null; source?: string | null; }
export interface PassportInput {
  passport?: Record<string, any> | null;
  mrz?: { detected?: boolean; valid?: boolean; errors?: string[] } | null;
  quality?: Record<string, any> | null;
  travel_start?: string | null;
  policy?: PassportPolicy | null;
  conflicts?: string[];
}
export function evaluatePassport(input: PassportInput): EngineResult {
  const E: EngineKey = "passport_intelligence", checks: EngineCheck[] = [];
  const p = input.passport || {};
  const required = ["surname", "given_names", "passport_number", "nationality", "date_of_birth", "expiry_date"];
  checks.push(c(E, "PASS-001", p.passport_number ? "PASS" : "BLOCKING", "Passport detected", p.passport_number ? "Passport details were detected." : "We could not read the passport number. Upload a clearer passport data page."));
  checks.push(c(E, "PASS-002", input.mrz?.detected ? "PASS" : "NEEDS_REVIEW", "MRZ detected", input.mrz?.detected ? "Machine-readable passport data was detected." : "We could not verify the passport MRZ. A clearer scan or manual review is required.", { requires_human_review: !input.mrz?.detected }));
  checks.push(c(E, "PASS-003", input.mrz?.detected ? (input.mrz?.valid ? "PASS" : "BLOCKING") : "NEEDS_REVIEW", "MRZ validation", input.mrz?.valid ? "MRZ check digits are valid." : input.mrz?.detected ? "Passport MRZ validation failed. Please upload a clearer scan." : "MRZ could not be validated.", { evidence: { errors: input.mrz?.errors || [] }, source: "icao9303" }));
  const missing = required.filter(k => !p[k]);
  checks.push(c(E, "PASS-004", missing.length ? "BLOCKING" : "PASS", "Required passport fields", missing.length ? `We could not read: ${missing.join(", ")}.` : "All required passport fields were extracted.", { evidence: { missing } }));
  const exp = isoDate(p.expiry_date), today = new Date().toISOString().slice(0, 10);
  checks.push(c(E, "PASS-005", !exp ? "NEEDS_REVIEW" : exp < today ? "BLOCKING" : "PASS", "Passport expiry", !exp ? "Passport expiry date could not be verified." : exp < today ? "This passport is expired." : "Passport is currently valid.", { requires_human_review: !exp }));
  const minMonths = input.policy?.min_validity_months;
  if (!input.travel_start || minMonths == null) checks.push(c(E, "PASS-006", "NEEDS_REVIEW", "Destination validity rule", "Passport validity for this route needs verification before submission.", { policy_version: input.policy?.policy_version, source: input.policy?.source || undefined, requires_human_review: true }));
  else {
    const travel = isoDate(input.travel_start); const left = exp && travel ? monthsBetween(travel, exp) : -999;
    checks.push(c(E, "PASS-006", left >= minMonths ? "PASS" : "BLOCKING", "Destination validity rule", left >= minMonths ? `Passport meets the ${minMonths}-month validity rule.` : `Passport does not meet the ${minMonths}-month validity requirement for this route.`, { policy_version: input.policy?.policy_version, evidence: { months_left: left, min_months: minMonths }, source: input.policy?.source || undefined }));
  }
  const conflicts = input.conflicts || [];
  checks.push(c(E, "PASS-007", conflicts.length ? "BLOCKING" : "PASS", "Passport data consistency", conflicts.length ? `Passport data conflicts require correction: ${conflicts.join(", ")}.` : "Passport details are consistent across available sources.", { evidence: { conflicts } }));
  const qualityFindings:any[] = Array.isArray((input.quality as any)?.checks) ? (input.quality as any).checks : [];
  const qualityBlockingCodes = new Set(["LOW_RESOLUTION","GLARE","POSSIBLE_BLUR","TOO_DARK","CROPPED_PAGE","FOUR_CORNERS_NOT_VISIBLE","DATA_PAGE_INCOMPLETE","BAD_ORIENTATION"]);
  const blockingQuality = qualityFindings.filter(q => q?.level === "blocking" || qualityBlockingCodes.has(String(q?.code || "")));
  const reviewQuality = qualityFindings.filter(q => !blockingQuality.includes(q));
  checks.push(c(E, "PASS-008", blockingQuality.length ? "BLOCKING" : reviewQuality.length ? "NEEDS_REVIEW" : "PASS", "Passport image quality", blockingQuality.length ? "Passport image quality prevents reliable verification. Retake or upload a clearer full-page image." : reviewQuality.length ? "Passport image quality needs review before submission." : "Passport image quality checks passed.", { evidence: { findings: qualityFindings }, requires_human_review: reviewQuality.length > 0 }));
  return buildEngineResult(E, checks, { passport: p, mrz: input.mrz, quality: input.quality });
}

// ---------- Engine 2: Photo Compliance ----------
export interface PhotoPolicy {
  policy_version: string; min_width?: number; min_height?: number; max_bytes?: number; allowed_types?: string[];
  aspect_ratio?: number; aspect_tolerance?: number; face_min_pct?: number; face_max_pct?: number;
  background?: "WHITE" | "LIGHT" | "PLAIN"; require_single_face?: boolean; require_frontal?: boolean;
}
export interface PhotoMetrics {
  width?: number; height?: number; bytes?: number; mime_type?: string; face_count?: number; face_pct?: number;
  background_uniformity?: number; background_brightness?: number; blur_score?: number; frontal?: boolean | null;
}
export function evaluatePhoto(m: PhotoMetrics, p: PhotoPolicy): EngineResult {
  const E: EngineKey = "photo_compliance", checks: EngineCheck[] = [];
  const sizeOk = (!p.min_width || (m.width || 0) >= p.min_width) && (!p.min_height || (m.height || 0) >= p.min_height);
  checks.push(c(E, "PHOTO-001", sizeOk ? "PASS" : "BLOCKING", "Photo resolution", sizeOk ? "Photo resolution is sufficient." : "Photo resolution is too low for this route.", { policy_version: p.policy_version }));
  const typeOk = !p.allowed_types?.length || p.allowed_types.includes(String(m.mime_type || "").toLowerCase());
  const bytesOk = !p.max_bytes || (m.bytes || 0) <= p.max_bytes;
  checks.push(c(E, "PHOTO-002", typeOk && bytesOk ? "PASS" : "BLOCKING", "Photo file", !typeOk ? "Use an accepted photo file type." : !bytesOk ? "Photo file is too large." : "Photo file format and size are accepted.", { evidence: { mime_type: m.mime_type, bytes: m.bytes }, policy_version: p.policy_version }));
  const ar = m.width && m.height ? m.width / m.height : null;
  const arOk = !p.aspect_ratio || (ar != null && Math.abs(ar - p.aspect_ratio) <= (p.aspect_tolerance ?? 0.08));
  checks.push(c(E, "PHOTO-003", arOk ? "PASS" : "BLOCKING", "Photo proportions", arOk ? "Photo proportions match the route requirement." : "Photo proportions do not match this route.", { evidence: { aspect_ratio: ar }, policy_version: p.policy_version }));
  let faceStatus: CheckStatus = "NEEDS_REVIEW";
  if (m.face_count != null) {
    const countOk = !p.require_single_face || m.face_count === 1;
    const pctOk = m.face_pct == null || ((!p.face_min_pct || m.face_pct >= p.face_min_pct) && (!p.face_max_pct || m.face_pct <= p.face_max_pct));
    faceStatus = countOk && pctOk ? "PASS" : "BLOCKING";
  }
  checks.push(c(E, "PHOTO-004", faceStatus, "Face compliance", faceStatus === "PASS" ? "Face position and size are acceptable." : faceStatus === "BLOCKING" ? "The photo does not meet face positioning requirements." : "Face positioning requires automatic or manual verification.", { requires_human_review: faceStatus === "NEEDS_REVIEW", evidence: { face_count: m.face_count, face_pct: m.face_pct }, policy_version: p.policy_version }));
  const bgKnown = m.background_uniformity != null && m.background_brightness != null;
  const bgOk = bgKnown && (m.background_uniformity as number) >= 0.75 && (p.background !== "WHITE" || (m.background_brightness as number) >= 0.78);
  checks.push(c(E, "PHOTO-005", !bgKnown ? "NEEDS_REVIEW" : bgOk ? "PASS" : "BLOCKING", "Photo background", bgOk ? "Photo background is compliant." : !bgKnown ? "Photo background needs verification." : "Use a plain, compliant background.", { requires_human_review: !bgKnown, policy_version: p.policy_version }));
  const blurKnown = m.blur_score != null, blurOk = blurKnown && (m.blur_score as number) >= 0.35;
  checks.push(c(E, "PHOTO-006", !blurKnown ? "NEEDS_REVIEW" : blurOk ? "PASS" : "BLOCKING", "Photo sharpness", blurOk ? "Photo is sufficiently sharp." : !blurKnown ? "Photo sharpness needs verification." : "Photo is too blurred. Retake it in good lighting.", { requires_human_review: !blurKnown, policy_version: p.policy_version }));
  if (p.require_frontal) checks.push(c(E, "PHOTO-007", m.frontal == null ? "NEEDS_REVIEW" : m.frontal ? "PASS" : "BLOCKING", "Head orientation", m.frontal ? "Head position is frontal." : m.frontal == null ? "Head orientation needs verification." : "Face the camera directly with your head straight.", { requires_human_review: m.frontal == null, policy_version: p.policy_version }));
  return buildEngineResult(E, checks, { metrics: m, policy: p });
}

// ---------- Engine 3: Eligibility projection ----------
export function evaluateEligibility(input: { eligible?: boolean | null; route?: string | null; reason?: string | null; policy_version?: string | null; verified?: boolean }): EngineResult {
  const E: EngineKey = "eligibility";
  const status: CheckStatus = input.eligible == null || !input.verified ? "NEEDS_REVIEW" : input.eligible ? "PASS" : "BLOCKING";
  return buildEngineResult(E, [c(E, "ELIG-001", status, "Visa route eligibility", status === "PASS" ? "You meet the configured eligibility rules for this route." : status === "BLOCKING" ? (input.reason || "You do not meet this route's eligibility conditions.") : "Eligibility rules require verification before this route can be offered.", { policy_version: input.policy_version, requires_human_review: status === "NEEDS_REVIEW", evidence: { route: input.route } })], input);
}

// ---------- Engine 6: Travel Consistency ----------
export function evaluateTravel(input: { arrival?: string; departure?: string; hotel_check_in?: string; hotel_check_out?: string; onward_date?: string; max_stay_days?: number | null }): EngineResult {
  const E: EngineKey = "travel_consistency", checks: EngineCheck[] = [];
  const a = isoDate(input.arrival), d = isoDate(input.departure);
  checks.push(c(E, "TRIP-001", a && d ? (d >= a ? "PASS" : "BLOCKING") : "NEEDS_REVIEW", "Trip dates", a && d && d >= a ? "Trip dates are in the correct order." : a && d ? "Departure must be after arrival." : "Travel dates are incomplete.", { requires_human_review: !(a && d) }));
  if (a && d && input.max_stay_days != null) {
    const days = Math.ceil((new Date(d).getTime() - new Date(a).getTime()) / 86400000);
    checks.push(c(E, "TRIP-002", days <= input.max_stay_days ? "PASS" : "BLOCKING", "Permitted stay", days <= input.max_stay_days ? "Trip duration is within the permitted stay." : `Trip exceeds the permitted ${input.max_stay_days}-day stay.`, { evidence: { days, max_stay_days: input.max_stay_days } }));
  } else checks.push(c(E, "TRIP-002", "NEEDS_REVIEW", "Permitted stay", "Permitted stay duration requires verification.", { requires_human_review: true }));
  const hi = isoDate(input.hotel_check_in), ho = isoDate(input.hotel_check_out);
  if (hi || ho) checks.push(c(E, "TRIP-003", hi && ho && a && d ? (hi <= a && ho >= d ? "PASS" : "WARNING") : "NEEDS_REVIEW", "Accommodation coverage", hi && ho && a && d && hi <= a && ho >= d ? "Accommodation covers the full trip." : "Accommodation does not clearly cover the full trip.", { requires_human_review: !(hi && ho && a && d) }));
  if (input.onward_date) { const od = isoDate(input.onward_date); checks.push(c(E, "TRIP-004", od && a && od >= a && (!d || od <= d) ? "PASS" : "WARNING", "Onward travel", od && a && od >= a ? "Onward/return travel is chronologically valid." : "Check the onward/return ticket date.")); }
  return buildEngineResult(E, checks, input);
}

// ---------- Engine 7: Supporting Visa / Residence Permit ----------
export interface SupportingVisaRequirement { allowed_issuers: string[]; must_be_valid_on: string; expected_holder_name?: string | null; policy_version?: string | null; }
export function evaluateSupportingVisa(doc: Record<string, any> | null, req: SupportingVisaRequirement): EngineResult {
  const E: EngineKey = "supporting_visa", checks: EngineCheck[] = [];
  if (!doc) return buildEngineResult(E, [c(E, "SUP-001", "BLOCKING", "Supporting visa required", "Upload the qualifying visa or residence permit required for this route.", { policy_version: req.policy_version })]);
  const issuer = norm(doc.issuing_country), allowed = req.allowed_issuers.map(norm);
  checks.push(c(E, "SUP-001", issuer && allowed.includes(issuer) ? "PASS" : "BLOCKING", "Qualifying issuer", issuer && allowed.includes(issuer) ? "Supporting document is from an accepted issuer." : "This supporting document is not from an accepted issuing country.", { evidence: { issuer, allowed }, policy_version: req.policy_version }));
  const exp = isoDate(doc.expiry_date), on = isoDate(req.must_be_valid_on);
  checks.push(c(E, "SUP-002", exp && on ? (exp >= on ? "PASS" : "BLOCKING") : "NEEDS_REVIEW", "Supporting document validity", exp && on && exp >= on ? "Supporting document is valid on the travel date." : exp && on ? "Supporting document expires before the required travel date." : "Supporting document validity requires verification.", { requires_human_review: !(exp && on), policy_version: req.policy_version }));
  const holder = norm(doc.holder_name), expectedHolder = norm(req.expected_holder_name);
  const holderStatus: CheckStatus = !holder ? "NEEDS_REVIEW" : expectedHolder && holder !== expectedHolder ? "BLOCKING" : "PASS";
  checks.push(c(E, "SUP-003", holderStatus, "Holder identity", holderStatus === "PASS" ? "Supporting document holder matches the traveler." : holderStatus === "BLOCKING" ? "Supporting document holder does not match the traveler." : "Holder identity must be verified manually.", { requires_human_review: holderStatus === "NEEDS_REVIEW", evidence: { holder, expected_holder: expectedHolder || null }, policy_version: req.policy_version }));
  return buildEngineResult(E, checks, doc);
}

// ---------- Engine 5: Arrival / Entry Declaration ----------
export interface ArrivalPolicy { country: string; form_code: string; policy_version: string; required_fields: string[]; active: boolean; source?: string; }
// Templates define reusable field shapes only. They are intentionally inactive so
// they can never be mistaken for currently verified immigration policy. Production
// routes must pass the versioned CountryCapability.arrival_policy explicitly.
export const ARRIVAL_POLICIES: Record<string, ArrivalPolicy> = {
  TH: { country: "TH", form_code: "TH_TDAC", policy_version: "TEMPLATE", required_fields: ["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address","purpose"], active: false },
  MY: { country: "MY", form_code: "MY_MDAC", policy_version: "TEMPLATE", required_fields: ["passport_number","surname","given_names","nationality","arrival_date","departure_date","transport_mode","accommodation_address"], active: false },
  ID: { country: "ID", form_code: "ID_ARRIVAL", policy_version: "TEMPLATE", required_fields: ["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address"], active: false },
  KH: { country: "KH", form_code: "KH_EARRIVAL", policy_version: "TEMPLATE", required_fields: ["passport_number","surname","given_names","nationality","arrival_date","flight_number","accommodation_address"], active: false },
};
export function evaluateArrivalCard(country: string, fields: Record<string, any>, policy: ArrivalPolicy | null = null): EngineResult {
  const E: EngineKey = "arrival_card";
  if (!policy) return buildEngineResult(E, [c(E, "ARR-000", "NEEDS_REVIEW", "Arrival declaration policy", "Arrival/declaration requirements are not verified for this route yet.", { requires_human_review: true })]);
  if (!policy.active) return buildEngineResult(E, [c(E, "ARR-000", "NOT_APPLICABLE", "Arrival declaration", "No active arrival declaration is required for this verified route.", { policy_version: policy.policy_version, source: policy.source })]);
  const missing = policy.required_fields.filter(k => !fields?.[k]);
  const checks = [c(E, "ARR-001", missing.length ? "BLOCKING" : "PASS", `${policy.form_code} completeness`, missing.length ? `Complete the arrival declaration fields: ${missing.join(", ")}.` : "Arrival declaration has all required fields.", { policy_version: policy.policy_version, evidence: { missing }, source: policy.source })];
  return buildEngineResult(E, checks, { form_code: policy.form_code, fields });
}

// ---------- Engine 4: Preflight projection ----------
export function aggregatePreflight(results: EngineResult[], extraChecks: EngineCheck[] = []): EngineResult {
  const E: EngineKey = "preflight";
  const checks: EngineCheck[] = [];
  for (const r of results) for (const x of r.checks) checks.push({ ...x, engine: x.engine });
  checks.push(...extraChecks);
  const base = buildEngineResult(E, checks as any, { engines: results.map(r => ({ engine: r.engine, status: r.status, score: r.score })) });
  return { ...base, engine: E };
}

// ---------- Engine 8: Submission + Tracking capability gate ----------
export function evaluateExecutionCapability(input: { submission_mode?: string | null; submission_provider_verified?: boolean; tracking_mode?: string | null; tracking_provider_verified?: boolean; manual_fallback?: boolean }): EngineResult {
  const E: EngineKey = "submission_tracking", checks: EngineCheck[] = [];
  const sm = norm(input.submission_mode), tm = norm(input.tracking_mode);
  const realSubmission = input.submission_provider_verified && sm && !sm.includes("MOCK");
  if (realSubmission) checks.push(c(E, "EXEC-001", "PASS", "Submission route", `Submission route is verified: ${sm}.`));
  else if (input.manual_fallback) checks.push(c(E, "EXEC-001", "WARNING", "Submission route", "Automated submission is not verified for this route; the case will use an audited manual-operator fallback.", { requires_human_review: true }));
  else checks.push(c(E, "EXEC-001", "BLOCKING", "Submission route", "No verified production submission route is configured."));
  const realTracking = input.tracking_provider_verified && tm && !tm.includes("MOCK");
  if (realTracking) checks.push(c(E, "EXEC-002", "PASS", "Tracking route", `Tracking route is verified: ${tm}.`));
  else if (input.manual_fallback) checks.push(c(E, "EXEC-002", "WARNING", "Tracking route", "Automatic tracking is not verified; status updates will use the audited manual fallback.", { requires_human_review: true }));
  else checks.push(c(E, "EXEC-002", "NEEDS_REVIEW", "Tracking route", "Tracking capability must be verified before promising automatic status updates.", { requires_human_review: true }));
  return buildEngineResult(E, checks, input);
}
