// Worldz Visa (Phase 11) — execution contract suite.
//
// Validates the §87 "Definition of Done" tests against the execution engine via
// the mock browser + mock API adapters (the ONLY automated targets — §49/§50).
// Runs as service role against real entities. Admin-only via visaApi.

import { ensureExecutionCatalog } from "./catalog.ts";
import { resetMockPortal, setBehavior } from "./portal/mock_portal.ts";
import {
  startExecution, resumeExecution, resolveActionRequest, cancelExecution,
  recoverExecution, getExecutionStatus, listAllExecutions, switchToManual,
} from "./engine.ts";
import { resolveFormForApplication, ensureFormCatalog } from "../forms.ts";
import { getLatestReadyPackage } from "../submission/engine.ts";
import { canExecutePaidService, getQuote, createOrder, createCheckout, reconcilePayment } from "../payments/engine.ts";

interface Assertion { name: string; passed: boolean; detail?: any; }
function fail(name: string, detail: any): Assertion { return { name, passed: false, detail }; }
const ADMIN = { id: "contract-admin", email: "contract@worldz.test", role: "admin", full_name: "Contract Admin" };
function mkApp(destination: string, visa_type: string, purpose: string, extra: any = {}): any {
  return { id: `app-${destination}-${purpose}-${Math.random().toString(36).slice(2, 8)}`, destination, visa_type_key: visa_type, purpose, traveler_id: `trav-${Math.random().toString(36).slice(2, 8)}`, channel: "evisa", metadata: {}, appointment_required: false, ...extra };
}
async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Build an approved, ready package directly (bypassing the heavy readiness/intel
// pipeline) so the suite focuses on EXECUTION behavior. Documents omitted by
// default; the upload workflow steps simply no-op (selector validation still
// runs for mapped-but-absent optional items).
async function prep(svc: any, opts: { destination: string; visa_type_key: string; purpose: string; behaviors?: any; withPayment?: boolean }): Promise<any> {
  await ensureExecutionCatalog(svc).catch(() => {});
  await ensureFormCatalog(svc).catch(() => {});
  resetMockPortal();
  const app = mkApp(opts.destination, opts.visa_type_key, opts.purpose, { appointment_required: false });
  await svc.entities.VisaApplication.create({
    id: app.id, traveler_id: app.traveler_id, destination: app.destination, visa_type_key: app.visa_type_key,
    purpose: app.purpose, channel: "evisa", status: "submission_ready", current_step: "submission",
    appointment_required: false, metadata: {}, created_by: ADMIN.id,
  }).catch(() => {});
  const formDef = await resolveFormForApplication(svc, app);
  const fields: Record<string, string> = {
    "applicant.surname": "SMITH", "applicant.given_names": "JOHN", "applicant.date_of_birth": "1990-01-01",
    "applicant.nationality": "IN", "applicant.passport_number": "P12345", "applicant.passport_expiry": "2030-01-01",
    "travel.arrival_date": "2026-09-01", "travel.departure_date": "2026-09-10", "contact.email": "t@example.com",
  };
  const data_hash = await sha256(JSON.stringify({ form_version: formDef.version, fields }));
  const snap = await svc.entities.ApplicationFormSnapshot.create({
    application_id: app.id, traveler_id: app.traveler_id, form_definition_id: formDef.id,
    form_code: formDef.form_code, form_version: formDef.version, generated_at: new Date().toISOString(),
    data_hash, dependency_fingerprint: {}, fields, trace: [], validation: { valid: true, errors: [] }, missing: [], status: "fresh",
  });
  const version = 1;
  const package_hash = await sha256(JSON.stringify({ form_version: formDef.version, form_data_hash: data_hash, document_version_ids: [] as string[], version }));
  const pkg = await svc.entities.SubmissionPackage.create({
    application_id: app.id, traveler_id: app.traveler_id, form_snapshot_id: snap.id, form_code: formDef.form_code,
    form_version: formDef.version, version, status: "ready", package_hash, items_summary: { form: 1, documents: 0 }, metadata: {},
  });
  await svc.entities.SubmissionPackageItem.create({ package_id: pkg.id, application_id: app.id, type: "FORM", form_snapshot_id: snap.id, document_type: null, document_version_id: null, label: formDef.form_code }).catch(() => {});
  await svc.entities.SubmissionApproval.create({
    application_id: app.id, submission_package_id: pkg.id, traveler_id: app.traveler_id, package_hash,
    form_code: formDef.form_code, form_version: formDef.version, actor: "test", approved_at: new Date().toISOString(),
    confirmed: true, warnings: [], metadata: {},
  }).catch(() => {});
  if (opts.withPayment) {
    try {
      const { order } = await createOrder(svc, ADMIN, app);
      const co = await createCheckout(svc, ADMIN, order.id);
      await reconcilePayment(svc, ADMIN, { payment_id: co.payment.id });
    } catch (e) { /* payment may be no-fee; ignore */ }
  }
  return { app, pkg, formDef, snap };
}

async function latestSession(svc: any, appId: string): Promise<any> {
  const rows: any[] = await svc.entities.BrowserExecutionSession.filter({ application_id: appId }).catch(() => []);
  rows.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return rows[0];
}
async function openAction(svc: any, sessionId: string): Promise<any> {
  const rows: any[] = await svc.entities.ExecutionActionRequest.filter({ execution_session_id: sessionId, status: "OPEN" }).catch(() => []);
  return rows[0];
}
async function eventCount(svc: any, sessionId: string): Promise<any[]> {
  return await svc.entities.BrowserExecutionEvent.filter({ execution_session_id: sessionId }).catch(() => []);
}

// The suite runs as named sections so visaApi can run a subset (opts.tests) for
// faster, bounded verification without exceeding the function timeout.
const SECTION_NAMES = [
  "browser_e2e", "otp", "captcha", "drift", "injection", "unknown_state", "crash_recovery",
  "duplicate_parallel", "stale_package", "approval_gate", "payment_gate", "appointment_gate",
  "japan", "france", "switch_manual", "cancel", "ops_listing",
] as const;

export async function runExecutionContractTests(svc: any, _user?: any, opts: { tests?: string[] } = {}): Promise<any> {
  const assertions: Assertion[] = [];
  const A = (n: string, ok: boolean, d?: any) => assertions.push({ name: n, passed: ok, detail: d });
  const requested = opts.tests && opts.tests.length ? new Set(opts.tests) : null;
  const enable = (k: string) => !requested || requested.has(k);
  await ensureExecutionCatalog(svc).catch(() => {});

  if (enable("browser_e2e"))
  // §50 Mock portal happy path (browser automation).
  if (enable("browser_e2e")) try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    const r = await startExecution(svc, ADMIN, app);
    const s = await latestSession(svc, app.id);
    A("browser E2E: session COMPLETED", s?.status === "COMPLETED", { status: s?.status });
    A("browser E2E: external reference captured", !!s?.external_reference, { ref: s?.external_reference });
    A("browser E2E: receipt stored in vault", !!s?.receipt_document_id, { doc: s?.receipt_document_id });
    A("browser E2E: last checkpoint RECEIPT_CAPTURED", s?.last_checkpoint === "RECEIPT_CAPTURED", { cp: s?.last_checkpoint });
    const evs = await eventCount(svc, s.id);
    A("browser E2E: events recorded", evs.length >= 4, { events: evs.length });
    // Submission + application updated.
    const sub: any = await svc.entities.Submission.get(s.submission_id).catch(() => null);
    A("browser E2E: submission SUBMITTED", sub?.status === "SUBMITTED", { status: sub?.status });
    const va: any = await svc.entities.VisaApplication.get(app.id).catch(() => null);
    A("browser E2E: application status submitted", va?.status === "submitted", { status: va?.status });
  } catch (e: any) { assertions.push(fail("engine: browser E2E threw", { error: e.message, stack: e?.stack })); }

  // §74 OTP handoff.
  if (enable("otp")) try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", behaviors: { otpRequired: true } });
    await startExecution(svc, ADMIN, app, { behaviors: { otpRequired: true } });
    let s = await latestSession(svc, app.id);
    A("otp: session WAITING_FOR_USER", s?.status === "WAITING_FOR_USER", { status: s?.status });
    const ar = await openAction(svc, s.id);
    A("otp: action request OTP_REQUIRED", ar?.type === "OTP_REQUIRED", { type: ar?.type });
    // Resolve → resume → COMPLETED.
    await resolveActionRequest(svc, ADMIN, ar.id, "RESUME");
    s = await latestSession(svc, app.id);
    A("otp: resumed → COMPLETED", s?.status === "COMPLETED", { status: s?.status });
    const resolved: any = await svc.entities.ExecutionActionRequest.get(ar.id).catch(() => null);
    A("otp: action request RESOLVED", resolved?.status === "RESOLVED", { status: resolved?.status });
  } catch (e: any) { assertions.push(fail("engine: otp handoff threw", { error: e.message, stack: e?.stack })); }

  // §75 CAPTCHA handoff.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", behaviors: { captchaRequired: true } });
    await startExecution(svc, ADMIN, app, { behaviors: { captchaRequired: true } });
    const s = await latestSession(svc, app.id);
    A("captcha: session WAITING_FOR_USER", s?.status === "WAITING_FOR_USER", { status: s?.status });
    const ar = await openAction(svc, s.id);
    A("captcha: action request CAPTCHA_REQUIRED", ar?.type === "CAPTCHA_REQUIRED", { type: ar?.type });
  } catch (e: any) { assertions.push(fail("engine: captcha handoff threw", { error: e.message, stack: e?.stack })); }

  // §73 / §47 Workflow drift (selector not found) — pauses, no improvisation.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    await startExecution(svc, ADMIN, app, { behaviors: { driftField: "Surname" } });
    const s = await latestSession(svc, app.id);
    A("drift: session WAITING_FOR_USER", s?.status === "WAITING_FOR_USER", { status: s?.status });
    const ar = await openAction(svc, s.id);
    A("drift: action request WORKFLOW_DRIFT", ar?.type === "WORKFLOW_DRIFT", { type: ar?.type });
  } catch (e: any) { assertions.push(fail("engine: workflow drift threw", { error: e.message, stack: e?.stack })); }

  // §76 Prompt injection defense — injected page instructions are ignored.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    await startExecution(svc, ADMIN, app, { behaviors: { maliciousPrompt: true } });
    const s = await latestSession(svc, app.id);
    A("injection: agent ignores portal instructions → COMPLETED", s?.status === "COMPLETED", { status: s?.status });
    A("injection: reference captured normally", !!s?.external_reference, { ref: s?.external_reference });
  } catch (e: any) { assertions.push(fail("engine: prompt injection threw", { error: e.message, stack: e?.stack })); }

  // §28 Unknown external state after submit — no auto-retry.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    await startExecution(svc, ADMIN, app, { behaviors: { submitTimeout: true } });
    const s = await latestSession(svc, app.id);
    A("unknown-state: session UNKNOWN_EXTERNAL_STATE", s?.status === "UNKNOWN_EXTERNAL_STATE", { status: s?.status });
    const ar = await openAction(svc, s.id);
    A("unknown-state: action request UNKNOWN_EXTERNAL_STATE", ar?.type === "UNKNOWN_EXTERNAL_STATE", { type: ar?.type });
    const evs = await eventCount(svc, s.id);
    const submitEvents = evs.filter((e) => e.step === "SUBMIT").length;
    A("unknown-state: submit attempted exactly once (no retry)", submitEvents === 1, { submitEvents });
  } catch (e: any) { assertions.push(fail("engine: unknown external state threw", { error: e.message, stack: e?.stack })); }

  // §27 / §28 Crash recovery from an ambiguous post-submit checkpoint.
  try {
    const { app, snap } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    // Simulate a worker crash right after submit with no confirmation.
    const plan = await svc.entities.ExecutionPlan.filter({ application_id: app.id }).catch(() => []);
    await svc.entities.BrowserExecutionSession.create({
      application_id: app.id, traveler_id: app.traveler_id, submission_id: "crash-submission",
      provider_id: (await svc.entities.Provider.filter({ adapter_key: "visa.exec.browser_mock" }).catch(() => []))[0]?.id,
      provider_key: "visa.exec.mock_portal", execution_plan_id: plan[0]?.id || "synthetic",
      portal_definition_id: "synthetic", portal_workflow_id: "synthetic", portal_workflow_version: "v1",
      strategy: "BROWSER_AUTOMATION", status: "SUBMITTING", current_step: "SUBMIT", last_checkpoint: "SUBMITTED",
      external_reference: null, idempotency_key: "crash-" + Math.random(), lease_owner: null, lease_expires_at: null,
      error_code: null, error_category: null, started_at: new Date().toISOString(), ended_at: null, last_url: "", metadata: {},
    });
    const crashed = await latestSession(svc, app.id);
    const r = await recoverExecution(svc, ADMIN, crashed.id);
    const s = await svc.entities.BrowserExecutionSession.get(crashed.id).catch(() => null);
    A("recovery: ambiguous submit → UNKNOWN_EXTERNAL_STATE (no re-submit)", s?.status === "UNKNOWN_EXTERNAL_STATE", { status: s?.status });
    const evs = await eventCount(svc, crashed.id);
    A("recovery: no submit re-attempted on recovery", evs.filter((e) => e.step === "SUBMIT").length === 0, { submitEvents: evs.length });
  } catch (e: any) { assertions.push(fail("engine: crash recovery threw", { error: e.message, stack: e?.stack })); }

  // §77 / §44 Duplicate + parallel execution.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    const r1 = await startExecution(svc, ADMIN, app);
    const r2 = await startExecution(svc, ADMIN, app);
    A("duplicate: second start idempotent", r2.idempotent === true || r2.paused === true, { idempotent: r2.idempotent, paused: r2.paused });
    // Parallel worker guard: simulate an active lease on a fresh session.
    const a2 = mkApp("MOCK", "mock_visa", "tourism");
    await svc.entities.VisaApplication.create({ id: a2.id, traveler_id: a2.traveler_id, destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", channel: "evisa", status: "submission_ready", current_step: "submission", appointment_required: false, created_by: ADMIN.id }).catch(() => {});
    await prep2(svc, a2);
    const sub: any = (await svc.entities.Submission.filter({ application_id: a2.id }).catch(() => []))[0];
    await svc.entities.BrowserExecutionSession.create({ application_id: a2.id, traveler_id: a2.traveler_id, submission_id: sub.id, provider_id: (await svc.entities.Provider.filter({ adapter_key: "visa.exec.browser_mock" }).catch(() => []))[0]?.id, provider_key: "visa.exec.mock_portal", execution_plan_id: "x", portal_definition_id: "x", portal_workflow_id: "x", portal_workflow_version: "v1", strategy: "BROWSER_AUTOMATION", status: "FILLING", current_step: "FILL_IDENTITY", last_checkpoint: "PORTAL_OPENED", external_reference: null, idempotency_key: "exec|" + sub.id + "|BROWSER_AUTOMATION|leased", lease_owner: "other-worker", lease_expires_at: new Date(Date.now() + 60000).toISOString(), started_at: new Date().toISOString() });
    let active = false, code = "";
    try { await startExecution(svc, ADMIN, a2); } catch (e: any) { active = true; code = e.code; }
    A("parallel: second worker rejected (EXECUTION_ALREADY_ACTIVE)", active && code === "EXECUTION_ALREADY_ACTIVE", { code });
  } catch (e: any) { assertions.push(fail("engine: duplicate/parallel threw", { error: e.message, stack: e?.stack })); }

  // §78 Stale package blocks execution.
  try {
    const { app, snap } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism" });
    await svc.entities.ApplicationFormSnapshot.update(snap.id, { status: "stale" }).catch(() => {});
    let blocked = false, code = "";
    try { await startExecution(svc, ADMIN, app); } catch (e: any) { blocked = true; code = e.code; }
    A("stale package: execution blocked", blocked && code === "PACKAGE_STALE", { code });
  } catch (e: any) { assertions.push(fail("engine: stale package threw", { error: e.message, stack: e?.stack })); }

  // §55 Approval gate.
  try {
    resetMockPortal();
    const app = mkApp("MOCK", "mock_visa", "tourism");
    await svc.entities.VisaApplication.create({ id: app.id, traveler_id: app.traveler_id, destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", channel: "evisa", status: "submission_ready", current_step: "submission", appointment_required: false, created_by: ADMIN.id }).catch(() => {});
    await prep2(svc, app, { withoutApproval: true });
    let blocked = false, code = "";
    try { await startExecution(svc, ADMIN, app); } catch (e: any) { blocked = true; code = e.code; }
    A("approval gate: blocked without approval (NOT_APPROVED)", blocked && code === "NOT_APPROVED", { code });
  } catch (e: any) { assertions.push(fail("engine: approval gate threw", { error: e.message, stack: e?.stack })); }

  // §53 Payment gate.
  try {
    const { app } = await prep(svc, { destination: "FR", visa_type_key: "schengen_short_stay", purpose: "tourism" });
    let blocked = false, code = "";
    try { await startExecution(svc, ADMIN, app); } catch (e: any) { blocked = true; code = e.code; }
    A("payment gate: blocked without payment (PAYMENT_REQUIRED)", blocked && code === "PAYMENT_REQUIRED", { code });
  } catch (e: any) { assertions.push(fail("engine: payment gate threw", { error: e.message, stack: e?.stack })); }

  // §54 Appointment gate.
  try {
    resetMockPortal();
    const app = mkApp("MOCK", "mock_visa", "tourism", { appointment_required: true });
    await svc.entities.VisaApplication.create({ id: app.id, traveler_id: app.traveler_id, destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", channel: "evisa", status: "submission_ready", current_step: "appointment", appointment_required: true, created_by: ADMIN.id }).catch(() => {});
    await prep2(svc, app);
    let blocked = false, code = "";
    try { await startExecution(svc, ADMIN, app); } catch (e: any) { blocked = true; code = e.code; }
    A("appointment gate: blocked when appointment required (APPOINTMENT_REQUIRED)", blocked && code === "APPOINTMENT_REQUIRED", { code });
  } catch (e: any) { assertions.push(fail("engine: appointment gate threw", { error: e.message, stack: e?.stack })); }

  // §51 Japan regression (API strategy) + payment.
  try {
    resetMockPortal();
    const { app } = await prep(svc, { destination: "JP", visa_type_key: "evisa", purpose: "tourism", withPayment: true });
    const r = await startExecution(svc, ADMIN, app);
    const s = await latestSession(svc, app.id);
    A("japan: API execution COMPLETED", s?.status === "COMPLETED", { status: s?.status });
    A("japan: reference captured", !!s?.external_reference, { ref: s?.external_reference });
    A("japan: strategy API", s?.strategy === "API", { strategy: s?.strategy });
  } catch (e: any) { assertions.push(fail("engine: japan regression threw", { error: e.message, stack: e?.stack })); }

  // §52 France regression (browser automation, gate-satisfied-by-payment via the
  // browser portal). FR product requires payment; pay then execute.
  try {
    resetMockPortal();
    const { app } = await prep(svc, { destination: "FR", visa_type_key: "schengen_short_stay", purpose: "tourism", withPayment: true });
    const r = await startExecution(svc, ADMIN, app);
    const s = await latestSession(svc, app.id);
    A("france: browser execution COMPLETED", s?.status === "COMPLETED", { status: s?.status });
    A("france: strategy BROWSER_AUTOMATION", s?.strategy === "BROWSER_AUTOMATION", { strategy: s?.strategy });
    A("france: reference captured", !!s?.external_reference, { ref: s?.external_reference });
  } catch (e: any) { assertions.push(fail("engine: france regression threw", { error: e.message, stack: e?.stack })); }

  // §25 Switch to manual from a paused browser session.
  try {
    const { app } = await prep(svc, { destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", behaviors: { otpRequired: true } });
    await startExecution(svc, ADMIN, app, { behaviors: { otpRequired: true } });
    let s = await latestSession(svc, app.id);
    const ar = await openAction(svc, s.id);
    await resolveActionRequest(svc, ADMIN, ar.id, "SWITCH_MANUAL");
    s = await latestSession(svc, app.id);
    A("switch-to-manual: strategy MANUAL", s?.strategy === "MANUAL", { strategy: s?.strategy });
    const ar2 = await openAction(svc, s.id);
    A("switch-to-manual: pauses for MANUAL_REVIEW", ar2?.type === "MANUAL_REVIEW", { type: ar2?.type });
  } catch (e: any) { assertions.push(fail("engine: switch to manual threw", { error: e.message, stack: e?.stack })); }

  // Cancel a paused session.
  try {
    resetMockPortal();
    const app = mkApp("MOCK", "mock_visa", "tourism");
    await svc.entities.VisaApplication.create({ id: app.id, traveler_id: app.traveler_id, destination: "MOCK", visa_type_key: "mock_visa", purpose: "tourism", channel: "evisa", status: "submission_ready", current_step: "submission", appointment_required: false, created_by: ADMIN.id }).catch(() => {});
    await prep2(svc, app);
    await startExecution(svc, ADMIN, app, { behaviors: { otpRequired: true } });
    const s = await latestSession(svc, app.id);
    await cancelExecution(svc, ADMIN, s.id);
    const after = await svc.entities.BrowserExecutionSession.get(s.id).catch(() => null);
    A("cancel: session CANCELLED", after?.status === "CANCELLED", { status: after?.status });
  } catch (e: any) { assertions.push(fail("engine: cancel threw", { error: e.message, stack: e?.stack })); }

  // §64 Operator console listing surfaces executions.
  try {
    const rows = await listAllExecutions(svc, ADMIN).catch(() => []);
    A("ops: can list all executions", rows.length > 0, { count: rows.length });
    if (rows[0]) {
      const st = await getExecutionStatus(svc, ADMIN, rows[0].id);
      A("ops: getExecutionStatus returns events+actions", Array.isArray(st.events) && Array.isArray(st.actions), { events: st.events.length, actions: st.actions.length });
    }
  } catch (e: any) { assertions.push(fail("engine: ops listing threw", { error: e.message, stack: e?.stack })); }

  const passed = assertions.filter((a) => a.passed).length;
  const failedList = assertions.filter((a) => !a.passed).map((a) => a.name);
  const firstFail = assertions.find((a) => !a.passed);
  return { allPassed: failedList.length === 0, total: assertions.length, passed, failed: failedList, firstFailure: firstFail ? { name: firstFail.name, detail: firstFail.detail } : null, assertions };
}

// Lighter prep variant: build an approved package for an app whose
// VisaApplication row already exists (used by gate/parallel tests).
async function prep2(svc: any, app: any, opts: { withoutApproval?: boolean } = {}): Promise<void> {
  await ensureFormCatalog(svc).catch(() => {});
  const formDef = await resolveFormForApplication(svc, app);
  const fields: Record<string, string> = {
    "applicant.surname": "SMITH", "applicant.given_names": "JOHN", "applicant.date_of_birth": "1990-01-01",
    "applicant.nationality": "IN", "applicant.passport_number": "P12345", "applicant.passport_expiry": "2030-01-01",
    "travel.arrival_date": "2026-09-01", "travel.departure_date": "2026-09-10", "contact.email": "t@example.com",
  };
  const data_hash = await sha256(JSON.stringify({ form_version: formDef.version, fields }));
  const snap = await svc.entities.ApplicationFormSnapshot.create({
    application_id: app.id, traveler_id: app.traveler_id, form_definition_id: formDef.id, form_code: formDef.form_code,
    form_version: formDef.version, generated_at: new Date().toISOString(), data_hash, dependency_fingerprint: {}, fields, trace: [], validation: { valid: true, errors: [] }, missing: [], status: "fresh",
  });
  const package_hash = await sha256(JSON.stringify({ form_version: formDef.version, form_data_hash: data_hash, document_version_ids: [], version: 1 }));
  const pkg = await svc.entities.SubmissionPackage.create({ application_id: app.id, traveler_id: app.traveler_id, form_snapshot_id: snap.id, form_code: formDef.form_code, form_version: formDef.version, version: 1, status: "ready", package_hash, items_summary: { form: 1, documents: 0 }, metadata: {} });
  await svc.entities.SubmissionPackageItem.create({ package_id: pkg.id, application_id: app.id, type: "FORM", form_snapshot_id: snap.id, document_type: null, document_version_id: null, label: formDef.form_code }).catch(() => {});
  if (!opts.withoutApproval) {
    await svc.entities.SubmissionApproval.create({ application_id: app.id, submission_package_id: pkg.id, traveler_id: app.traveler_id, package_hash, form_code: formDef.form_code, form_version: formDef.version, actor: "test", approved_at: new Date().toISOString(), confirmed: true, warnings: [], metadata: {} }).catch(() => {});
  }
}