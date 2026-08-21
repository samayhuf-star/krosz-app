// Worldz Visa (Phase 13) — contract tests for the review engine.
// Deterministic rule assertions + AI guardrail assertions. Pure (no DB) so they
// run deterministically in the sandbox. Full Japan/France end-to-end review runs
// are exercised via the `run-review` action on a seeded application (gated section).
import { evaluateRules, ReviewInput, RawFinding, REVIEW_ENGINE_VERSION, RULE_VERSION } from "./rules.ts";
import { runAiReview } from "./ai.ts";

function ok(name: string, cond: boolean, detail = ""): { name: string; pass: boolean; detail: string } {
  return { name, pass: cond, detail: detail || (cond ? "ok" : "FAIL") };
}

function baseInput(overrides: Partial<ReviewInput> = {}): ReviewInput {
  const passportFields = { surname: "VASHISHT", given_names: "SAMAY", passport_number: "P1234567", nationality: "IND", date_of_birth: "1990-01-01", expiry_date: "2031-01-01" };
  const answers: Record<string, string> = { "personal.surname": "VASHISHT", "personal.given_names": "SAMAY", "personal.date_of_birth": "1990-01-01", "personal.nationality": "IND", "passport.passport_number": "P1234567", "passport.expiry_date": "2031-01-01", "passport.passport_number": "P1234567" };
  const formSnapshot = { id: "snap1", status: "fresh", data_hash: "x", fields: { "applicant.surname": "VASHISHT", "applicant.given_names": "SAMAY", "applicant.date_of_birth": "1990-01-01", "applicant.nationality": "IND", "applicant.passport_number": "P1234567", "applicant.passport_expiry": "2031-01-01" } };
  const requirements = [{ document_category: "passport", title: "Passport valid 6+ months from travel date", description: "" }];
  return {
    now: "2026-08-12T00:00:00Z",
    application: { id: "app1", travel_start: "2026-12-01", travel_end: "2026-12-10", appointment_required: false },
    traveler: { nationality: "IND" },
    requirementsVersion: "X-V1", requirements,
    progress: { items: [{ name: "Passport", document_type: "PASSPORT", document_types: ["PASSPORT"], state: "verified", mandatory_level: "mandatory", requirement_id: "r1", application_document: { id: "ad1", document_type: "PASSPORT", document_version_id: "v1" } }], total: 1, complete: 1, pending: 0 },
    passportFields, passportVersionId: "v1",
    answers, answersReady: true,
    formSnapshot, formStale: false,
    pkg: { id: "pkg1", package_hash: "h", status: "ready" }, packageStale: false, packageIntegrityValid: true,
    orders: [], paymentRequired: false, paymentPaid: true,
    appointments: [], appointmentBooked: true,
    resolvedProvider: { provider_id: "p1" },
    blockingDocumentFindings: [],
    ...overrides,
  } as ReviewInput;
}

function has(findings: RawFinding[], code: string): RawFinding | undefined { return findings.find((f) => f.code === code); }

function fakeAi(base44: any, aiFindings: any) {
  return { integrations: { Core: { InvokeLLM: async () => ({ data: { findings: aiFindings } }) } } } as any;
}

export async function runReviewContractTests(): Promise<any> {
  const results: any[] = [];

  // §77 passport name mismatch → BLOCKING identity
  let f = evaluateRules(baseInput({ passportFields: { surname: "VASHISHT", given_names: "SAMAY", passport_number: "P1234567", nationality: "IND", date_of_birth: "1990-01-01", expiry_date: "2031-01-01" }, answers: { "personal.surname": "VASHIST", "personal.given_names": "SAMAY", "personal.date_of_birth": "1990-01-01", "personal.nationality": "IND", "passport.passport_number": "P1234567" } as any, formSnapshot: { id: "s", status: "fresh", fields: { "applicant.surname": "VASHISHT", "applicant.given_names": "SAMAY", "applicant.passport_number": "P1234567" } } as any } as any));
  let n = has(f, "IDENTITY_NAME_MISMATCH"); results.push(ok("77.passport_name_mismatch_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §79 passport expiry violates 6-month threshold
  f = evaluateRules(baseInput({ passportFields: { surname: "VASHISHT", given_names: "SAMAY", passport_number: "P1234567", nationality: "IND", date_of_birth: "1990-01-01", expiry_date: "2027-01-01" }, application: { id: "a", travel_start: "2026-12-01", travel_end: "2026-12-10", appointment_required: false } as any } as any));
  n = has(f, "PASSPORT_EXPIRY"); results.push(ok("79.passport_expiry_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §79b passport expired
  f = evaluateRules(baseInput({ now: "2026-08-12T00:00:00Z", passportFields: { surname: "V", given_names: "S", passport_number: "P1", nationality: "IND", date_of_birth: "1990-01-01", expiry_date: "2020-01-01" } as any, answers: { "personal.surname": "V", "personal.given_names": "S", "personal.date_of_birth": "1990-01-01", "personal.nationality": "IND", "passport.passport_number": "P1", "passport.expiry_date": "2020-01-01" } as any, formSnapshot: { status: "fresh", fields: { "applicant.surname": "V", "applicant.given_names": "S", "applicant.passport_number": "P1", "applicant.passport_expiry": "2020-01-01" } } as any } as any));
  n = has(f, "PASSPORT_EXPIRED"); results.push(ok("79b.passport_expired_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §80 missing document
  f = evaluateRules(baseInput({ progress: { items: [{ name: "Bank statements", document_type: "BANK_STATEMENT", document_types: ["BANK_STATEMENT"], state: "missing", mandatory_level: "mandatory", requirement_id: "r2" }], total: 1, complete: 0, pending: 1 } } as any));
  n = has(f, "DOCUMENT_REQUIRED"); results.push(ok("80.missing_document_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §18 wrong document type
  f = evaluateRules(baseInput({ progress: { items: [{ name: "Bank statements", document_type: "BANK_STATEMENT", document_types: ["BANK_STATEMENT"], state: "verified", mandatory_level: "mandatory", requirement_id: "r2", application_document: { id: "ad2", document_type: "PASSPORT", document_version_id: "v2" } }], total: 1, complete: 1, pending: 0 } } as any));
  n = has(f, "DOCUMENT_TYPE_MISMATCH"); results.push(ok("18.wrong_document_type_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §81 stale form
  f = evaluateRules(baseInput({ formSnapshot: { id: "s", status: "stale", fields: {}, } as any, formStale: true } as any));
  n = has(f, "FORM_STALE"); results.push(ok("81.stale_form_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §82 stale package
  f = evaluateRules(baseInput({ packageStale: true } as any));
  n = has(f, "PACKAGE_STALE"); results.push(ok("82.stale_package_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §82b package hash mismatch
  f = evaluateRules(baseInput({ packageIntegrityValid: false } as any));
  n = has(f, "PACKAGE_HASH"); results.push(ok("82b.package_hash_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §83 payment required blocking
  f = evaluateRules(baseInput({ paymentRequired: true, paymentPaid: false } as any));
  n = has(f, "PAYMENT_REQUIRED"); results.push(ok("83.payment_required_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §84 appointment required blocking
  f = evaluateRules(baseInput({ application: { id: "a", travel_start: "2026-12-01", travel_end: "2026-12-10", appointment_required: true } as any, appointmentBooked: false } as any));
  n = has(f, "APPOINTMENT_REQUIRED"); results.push(ok("84.appointment_required_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §12 dob mismatch critical
  f = evaluateRules(baseInput({ passportFields: { surname: "V", given_names: "S", passport_number: "P1", nationality: "IND", date_of_birth: "1990-01-01", expiry_date: "2031-01-01" }, answers: { "personal.surname": "V", "personal.given_names": "S", "personal.date_of_birth": "1991-02-02", "personal.nationality": "IND", "passport.passport_number": "P1", "passport.expiry_date": "2031-01-01" } as any, formSnapshot: { status: "fresh", fields: { "applicant.surname": "V", "applicant.given_names": "S", "applicant.date_of_birth": "1990-01-01", "applicant.passport_number": "P1" } } as any } as any));
  n = has(f, "DATE_OF_BIRTH_MISMATCH"); results.push(ok("12.dob_mismatch_critical", !!n && n.severity === "CRITICAL", n?.description_operator || ""));

  // §13 nationality mismatch critical
  f = evaluateRules(baseInput({ passportFields: { surname: "V", given_names: "S", passport_number: "P1", nationality: "PAK", date_of_birth: "1990-01-01", expiry_date: "2031-01-01" }, answers: { "personal.surname": "V", "personal.given_names": "S", "personal.date_of_birth": "1990-01-01", "personal.nationality": "IND", "passport.passport_number": "P1", "passport.expiry_date": "2031-01-01" } as any, formSnapshot: { status: "fresh", fields: { "applicant.surname": "V", "applicant.given_names": "S", "applicant.nationality": "IND" } } as any } as any));
  n = has(f, "NATIONALITY_MISMATCH"); results.push(ok("13.nationality_mismatch_critical", !!n && n.severity === "CRITICAL", n?.description_operator || ""));

  // travel date order
  f = evaluateRules(baseInput({ application: { id: "a", travel_start: "2026-12-10", travel_end: "2026-12-01", appointment_required: false } as any } as any));
  n = has(f, "TRAVEL_DATE_ORDER"); results.push(ok("24.travel_date_order_blocking", !!n && n.severity === "BLOCKING", n?.description_operator || ""));

  // §86 AI conflict: AI tries to BLOCK; must be downgraded to WARNING.
  const aiBlock = await runAiReview(fakeAi(null, [{ code: "VISA_APPROVED", severity: "BLOCKING", description: "Applicant is visa eligible and guaranteed approval.", evidence: ["x"] }]), baseInput());
  results.push(ok("86.ai_cannot_block", aiBlock.length === 0, JSON.stringify(aiBlock.map((x) => x.code))));

  // §87 AI hallucination: no evidence → dropped.
  const aiNoEv = await runAiReview(fakeAi(null, [{ code: "POSSIBLE_X", severity: "WARNING", description: "something inconsistent", evidence: [] }]), baseInput());
  results.push(ok("87.ai_no_evidence_dropped", aiNoEv.length === 0, JSON.stringify(aiNoEv)));

  // §85 AI valid warning accepted (capped WARNING, human review).
  const aiOk = await runAiReview(fakeAi(null, [{ code: "POSSIBLE_NAME_VARIATION", severity: "WARNING", description: "Name spelling varies slightly across documents.", evidence: ["passport.surname=VASHISHT", "form.surname=VASHIST"] }]), baseInput());
  results.push(ok("85.ai_warning_accepted_human_review", aiOk.length === 1 && aiOk[0].severity === "WARNING" && aiOk[0].requires_human_review === true, JSON.stringify(aiOk)));

  // Clean application → no blocking/critical → overall PASSED (computed via overallStatus logic).
  f = evaluateRules(baseInput());
  const anyBlock = f.some((x) => x.severity === "BLOCKING" || x.severity === "CRITICAL");
  results.push(ok("clean.application_no_blockers", !anyBlock, JSON.stringify(f.map((x) => `${x.code}:${x.severity}`))));

  const pass = results.every((r) => r.pass);
  return { pass, engine_version: REVIEW_ENGINE_VERSION, rule_version: RULE_VERSION, total: results.length, passed: results.filter((r) => r.pass).length, results };
}

// Light end-to-end harness — requires a seeded application id; gated by env to
// avoid sandbox timeouts. Invoke via run-review action (admin) on a real app.
export async function runReviewE2E(svc: any, user: any, base44: any, applicationId: string): Promise<any> {
  const { canSubmitApplication } = await import("./engine.ts");
  const res = await canSubmitApplication(base44, svc, user, applicationId);
  return { allowed: res.allowed, reasons: res.reasons, review_status: res.review?.status };
}