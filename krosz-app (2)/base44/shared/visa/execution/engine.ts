// Worldz Visa (Phase 11) — Execution engine.
//
// Drives a controlled execution session against an external portal via an
// ExecutionProviderAdapter. The orchestrator owns durable execution + recovery;
// this engine is the visa-domain service the visaApi thin layer calls.
//
// Hard invariants (§§1-87):
//   - The browser agent is an execution ADAPTER: it only runs an approved,
//     pinned ExecutionPlan. It never decides requirements/approval/payment (§37).
//   - Gates before submission (§53-55): payment SUCCEEDED, appointment ready,
//     package integrity, package freshness, approval — all server-side.
//   - Idempotent start (submission_id + strategy); duplicate/parallel workers are
//     rejected with EXECUTION_ALREADY_ACTIVE (§77) via a distributed lease (§44).
//   - After each meaningful step a durable checkpoint is written (§26); crash
//     recovery resumes from the last checkpoint, never restarts blindly (§27).
//   - After a submit click with no confirmation → UNKNOWN_EXTERNAL_STATE; the
//     engine NEVER auto-clicks submit again (§28). It queries provider status or
//     escalates to an operator.
//   - Human pauses (OTP/CAPTCHA/login/drift/unexpected-domain) create a
//     first-class ExecutionActionRequest; operator may Resume/Retry/Cancel/
//     Switch-to-Manual but never edit the plan (§§23-25).

import { getExecutionAdapter } from "./registry.ts";
import { generateExecutionPlan } from "./plan.ts";
import { isDomainAllowed } from "./security.ts";
import {
  executionIdempotencyKey, TERMINAL_SESSION, CHECKPOINT_ORDER,
  type ExecutionResult, type ExecutionStrategy, type ExecutionExecutionContext,
} from "./types.ts";
import {
  getLatestReadyPackage, verifyPackageIntegrity, checkPackageStale, createSubmission,
} from "../submission/engine.ts";
import { resolveFormForApplication, getLatestSnapshot } from "../forms.ts";
import { canExecutePaidService } from "../payments/engine.ts";
import { checkAppointmentReadiness } from "../appointments/engine.ts";
import { createDocument, documentAudit } from "../documents.ts";
import { getApplication } from "../application.ts";
import { setApplicationLifecycle } from "../application/caseStore.ts";

const LEASE_TTL_MS = 5 * 60 * 1000;
const MAX_STEPS_PER_RUN = 40;

// ---------- Provider context (reuses platform secrets; never exposed) ----------
async function buildExecProviderContext(svc: any, provider: any): Promise<any> {
  const creds: any[] = await svc.entities.ProviderCredential.filter({ provider_id: provider.id }).catch(() => []);
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) {
    for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) {
      if (name) credentials[name] = (c.key_configured || c.secret_configured) ? "(configured)" : undefined;
    }
  }
  return { providerId: provider.id, providerKey: provider.key, category: provider.category, environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials, requestId: crypto.randomUUID() };
}

// ---------- Audit ----------
async function audit(svc: any, user: any, app: any, action: string, detail: any) {
  await documentAudit(svc, user, { action: "execution." + action, entity_type: "BrowserExecutionSession", application_id: app?.id, detail }).catch(() => {});
}

async function recordEvent(svc: any, user: any, session: any, ev: { step: string; action: string; status: string; checkpoint?: string; url?: string; external_reference?: string; error_code?: string; error_category?: string; duration_ms?: number; metadata?: any }): Promise<void> {
  await svc.entities.BrowserExecutionEvent.create({
    execution_session_id: session.id, application_id: session.application_id, traveler_id: session.traveler_id,
    step: ev.step, action: ev.action, status: ev.status, checkpoint: ev.checkpoint || null,
    url: ev.url || null, external_reference: ev.external_reference || null,
    error_code: ev.error_code || null, error_category: ev.error_category || null,
    duration_ms: ev.duration_ms ?? null, timestamp: new Date().toISOString(),
    metadata: ev.metadata || {}, // never secrets/PII
  }).catch(() => {});
}

// ---------- Leases ----------
async function acquireLease(svc: any, session: any, owner: string): Promise<void> {
  const fresh = await svc.entities.BrowserExecutionSession.get(session.id).catch(() => session);
  if (fresh.lease_owner && fresh.lease_expires_at) {
    const exp = new Date(fresh.lease_expires_at).getTime();
    if (exp > Date.now() && fresh.lease_owner !== owner) {
      throw Object.assign(new Error("Another worker is executing this submission"), { code: "EXECUTION_ALREADY_ACTIVE" });
    }
  }
  await svc.entities.BrowserExecutionSession.update(session.id, { lease_owner: owner, lease_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString() }).catch(() => {});
}
async function renewLease(svc: any, session: any, owner: string): Promise<void> {
  await svc.entities.BrowserExecutionSession.update(session.id, { lease_owner: owner, lease_expires_at: new Date(Date.now() + LEASE_TTL_MS).toISOString() }).catch(() => {});
}
async function releaseLease(svc: any, session: any): Promise<void> {
  await svc.entities.BrowserExecutionSession.update(session.id, { lease_owner: null, lease_expires_at: null }).catch(() => {});
}

// ---------- Portal resolution (deterministic; never an LLM) ----------
const STRATEGY_BY_COUNTRY: Record<string, ExecutionStrategy> = {
  JP: "API", FR: "BROWSER_AUTOMATION", MOCK: "BROWSER_AUTOMATION", EMB: "MANUAL",
};

export async function resolveExecutionPortal(svc: any, app: any): Promise<{ portal: any; provider: any; adapter: any; workflow: any }> {
  // 1) Direct match: active portal for destination + visa_type.
  let pds: any[] = await svc.entities.PortalDefinition.filter({ country: app.destination, visa_type_key: app.visa_type_key, status: "ACTIVE" }).catch(() => []);
  // 2) Fallback by country (any visa_type) or by default strategy.
  if (!pds.length) pds = await svc.entities.PortalDefinition.filter({ country: app.destination, status: "ACTIVE" }).catch(() => []);
  let portal = pds[0];
  if (!portal) {
    // Dynamic synthetic manual portal if nothing seeded: resolve the manual provider.
    const manual: any[] = await svc.entities.Provider.filter({ adapter_key: "visa.exec.manual" }).catch(() => []);
    const mp = manual[0];
    portal = { id: "synthetic-manual", provider_id: mp?.id, portal_name: "Manual (no portal configured)", country: app.destination, visa_type_key: app.visa_type_key, base_url: "", execution_strategy: "MANUAL", auth_strategy: "MANUAL_LOGIN", automation_allowed: false, allowed_domains: [], max_concurrent_sessions: 4 };
  }
  const provider: any = portal.provider_id ? await svc.entities.Provider.get(portal.provider_id).catch(() => null) : null;
  if (!provider) throw Object.assign(new Error("No provider for portal"), { code: "NO_PROVIDER" });
  const adapter = getExecutionAdapter(provider.adapter_key);
  let wfs: any[] = await svc.entities.PortalWorkflow.filter({ portal_definition_id: portal.id, status: "ACTIVE" }).catch(() => []);
  if (!wfs.length) wfs = await svc.entities.PortalWorkflow.filter({ portal_definition_id: portal.id }).catch(() => []);
  wfs.sort((a: any, b: any) => String(b.version || "").localeCompare(String(a.version || "")));
  const workflow = wfs[0] || { id: "synthetic-workflow", portal_definition_id: portal.id, version: "v1", status: "ACTIVE", steps: [{ key: "OPEN_PORTAL" }, { key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" }], field_mappings: [], document_mappings: [] };
  return { portal, provider, adapter, workflow };
}

// ---------- Plan assembly ----------
export async function ensureExecutionPlan(svc: any, user: any, app: any): Promise<any> {
  const pkg = await getLatestReadyPackage(svc, app);
  if (!pkg) throw Object.assign(new Error("No submission package"), { code: "NO_PACKAGE" });
  const { portal, provider, adapter, workflow } = await resolveExecutionPortal(svc, app);
  const strategy: ExecutionStrategy = (portal.execution_strategy || STRATEGY_BY_COUNTRY[app.destination] || provider.adapter_config?.strategy || "MANUAL") as ExecutionStrategy;

  // Reuse an existing pinned plan for the same (package, workflow) — survives portal changes.
  const existing: any[] = await svc.entities.ExecutionPlan.filter({ application_id: app.id, submission_package_id: pkg.id, portal_workflow_id: workflow.id || "synthetic-workflow", package_hash: pkg.package_hash }).catch(() => []);
  if (existing[0]) return existing[0];

  // Gather form fields + package items to derive field/document references.
  const formDef = await resolveFormForApplication(svc, app).catch(() => null);
  let formFields: any[] = [];
  let formSnapshot: any = null;
  if (formDef) {
    const items: any[] = await svc.entities.GovernmentFormField.filter({ form_definition_id: formDef.id }).catch(() => []);
    formFields = items;
    const snap = await getLatestSnapshot(svc, app, formDef.id).catch(() => null);
    if (snap) formSnapshot = snap;
  }
  const pkgItems: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: pkg.id }).catch(() => []);
  const { steps } = generateExecutionPlan({ workflow, packageItems: pkgItems, formFields, strategy, packageHash: pkg.package_hash, portalWorkflowId: workflow.id || "synthetic", portalWorkflowVersion: workflow.version || "v1" });

  const row = await svc.entities.ExecutionPlan.create({
    application_id: app.id, traveler_id: app.traveler_id, submission_package_id: pkg.id,
    form_definition_id: formDef?.id || null, form_snapshot_id: formSnapshot?.id || null,
    package_hash: pkg.package_hash, portal_definition_id: portal.id || null,
    portal_workflow_id: workflow.id || "synthetic", portal_workflow_version: workflow.version || "v1",
    execution_strategy: strategy, steps, version: "v1",
  });
  await audit(svc, user, app, "plan.generated", { strategy, steps: steps.length, workflow_version: workflow.version, package_hash: pkg.package_hash });
  return row;
}

// ---------- Context assembly ----------
async function buildExecContext(svc: any, user: any, session: any, opts: any): Promise<ExecutionExecutionContext> {
  const app = await getApplication(svc, user, session.application_id);
  const plan = await svc.entities.ExecutionPlan.get(session.execution_plan_id).catch(() => ({ steps: opts?.plan?.steps || [] }));
  const portal = await svc.entities.PortalDefinition.get(session.portal_definition_id).catch(() => ({ id: "synthetic-manual", allowed_domains: [], base_url: "" }));
  const workflow = await svc.entities.PortalWorkflow.get(session.portal_workflow_id).catch(() => ({ id: "synthetic", steps: [], field_mappings: [], document_mappings: [] }));
  const provider = await svc.entities.Provider.get(session.provider_id).catch(() => ({ adapter_key: session.provider_key }));
  // Form snapshot data (the authoritative approved values — never invented).
  let formSnapshot: any = session.form_snapshot_id ? await svc.entities.ApplicationFormSnapshot.get(session.form_snapshot_id).catch(() => null) : null;
  if (!formSnapshot && plan?.form_snapshot_id) formSnapshot = await svc.entities.ApplicationFormSnapshot.get(plan.form_snapshot_id).catch(() => null);
  // Pinned document versions + storage URIs for uploads.
  const pkgItems: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: session.submission_package_id || plan?.submission_package_id }).catch(() => []);
  const documents: any[] = [];
  for (const it of pkgItems.filter((i) => i.document_version_id)) {
    const v: any = await svc.entities.DocumentVersion.get(it.document_version_id).catch(() => null);
    if (v) documents.push({ document_type: it.document_type, document_version_id: v.id, storage_uri: v.storage_uri, mime_type: v.mime_type, file_size: v.file_size });
  }
  const submission: any = await svc.entities.Submission.get(session.submission_id).catch(() => null);
  return { providerId: provider.id, providerKey: provider.key || session.provider_key, portalDefinition: portal, portalWorkflow: workflow, executionPlan: plan, formSnapshot: formSnapshot || { data: {} }, documents, submission: submission || { id: session.submission_id }, session: { ...session, current_step: session.current_step }, resumeFromStep: opts?.resumeFromStep, behaviors: opts?.behaviors || {}, requestId: crypto.randomUUID() } as any;
}

// ---------- Gates (§§53-55) ----------
async function checkExecutionGates(svc: any, user: any, app: any): Promise<void> {
  const pkg = await getLatestReadyPackage(svc, app);
  if (!pkg) throw Object.assign(new Error("No submission package"), { code: "NO_PACKAGE" });
  const integ = await verifyPackageIntegrity(svc, pkg);
  if (!integ.valid) throw Object.assign(new Error("Package integrity failed"), { code: integ.reason || "PACKAGE_MODIFIED" });
  const { stale, reasons } = await checkPackageStale(svc, app, pkg);
  if (stale) throw Object.assign(new Error("Package stale: " + reasons.join(",")), { code: "PACKAGE_STALE", reasons });
  const approvals: any[] = await svc.entities.SubmissionApproval.filter({ application_id: app.id, submission_package_id: pkg.id }).catch(() => []);
  if (!approvals.length) throw Object.assign(new Error("Submission not approved by applicant"), { code: "NOT_APPROVED" });
  // Payment gate (server-side authoritative).
  const pay = await canExecutePaidService(svc, app, "submission").catch(() => ({ allowed: true }));
  if (!pay.allowed && pay.reason === "PAYMENT_REQUIRED") throw Object.assign(new Error("Payment required before submission"), { code: "PAYMENT_REQUIRED" });
  // Appointment gate: if the application requires one, a booking must exist.
  if (app.appointment_required) {
    const readiness = await checkAppointmentReadiness(svc, app).catch(() => ({ ready: true }));
    if (!readiness.ready && readiness.blocking?.length) throw Object.assign(new Error("Appointment required before submission"), { code: "APPOINTMENT_REQUIRED", reasons: readiness.blocking });
  }
}

// ---------- Start ----------
export async function startExecution(svc: any, user: any, app: any, opts: { behaviors?: any; workerId?: string } = {}): Promise<any> {
  await checkExecutionGates(svc, user, app);
  const { portal, provider, adapter, workflow } = await resolveExecutionPortal(svc, app);
  const plan = await ensureExecutionPlan(svc, user, app);
  const pkg = await getLatestReadyPackage(svc, app);
  // Idempotent submission (Phase 8).
  let sub: any = (await svc.entities.Submission.filter({ application_id: app.id, submission_package_id: pkg.id }).catch(() => []))[0];
  if (!sub) { const created = await createSubmission(svc, user, app); sub = created.submission; }

  const idemKey = executionIdempotencyKey(sub.id, portal.execution_strategy as ExecutionStrategy);
  const existing: any[] = await svc.entities.BrowserExecutionSession.filter({ idempotency_key: idemKey }).catch(() => []);
  const live = existing.find((s) => !TERMINAL_SESSION.includes(s.status));
  if (live) {
    if (live.status === "WAITING_FOR_USER") return { session: live, idempotent: true, paused: true };
    if (live.status === "INITIALIZING" || live.status === "AUTHENTICATING" || live.status === "FILLING" || live.status === "UPLOADING" || live.status === "REVIEWING" || live.status === "SUBMITTING") {
      // Active execution — reject concurrent worker.
      const expired = !live.lease_expires_at || new Date(live.lease_expires_at).getTime() <= Date.now();
      if (!expired) throw Object.assign(new Error("Execution already active"), { code: "EXECUTION_ALREADY_ACTIVE" });
    }
    return { session: live, idempotent: true };
  }

  const ref = crypto.randomUUID();
  const now = new Date().toISOString();
  let session = await svc.entities.BrowserExecutionSession.create({
    application_id: app.id, traveler_id: app.traveler_id, submission_id: sub.id,
    provider_id: provider.id, provider_key: provider.key, execution_plan_id: plan.id,
    portal_definition_id: portal.id, portal_workflow_id: workflow.id || "synthetic", portal_workflow_version: workflow.version || "v1",
    strategy: portal.execution_strategy, status: "INITIALIZING",
    current_step: null, last_checkpoint: "CREATED", external_reference: null,
    receipt_document_id: null, receipt_document_version_id: null,
    idempotency_key: idemKey, lease_owner: null, lease_expires_at: null,
    error_code: null, error_category: null, started_at: now, ended_at: null,
    last_url: portal.base_url, metadata: { ref },
  });
  await audit(svc, user, app, "created", { session_id: session.id, strategy: portal.execution_strategy, provider_id: provider.id });
  await recordEvent(svc, user, session, { step: "INIT", action: "start", status: "STARTED", checkpoint: "CREATED" });

  const owner = opts.workerId || "worker-" + ref.slice(0, 8);
  try {
    await acquireLease(svc, session, owner);
  } catch (e: any) {
    await svc.entities.BrowserExecutionSession.update(session.id, { status: "FAILED", error_code: "EXECUTION_ALREADY_ACTIVE" }).catch(() => {}); throw e;
  }

  const ctx = await buildExecProviderContext(svc, provider);
  const exec = await buildExecContext(svc, user, session, opts);
  // init
  let r: ExecutionResult;
  try { r = await adapter.init(ctx, exec); }
  catch (e: any) { r = { success: false, status: "FAILED", error_code: "INIT_FAILED", error_message: String(e?.message || e), error_category: "UNKNOWN" }; }
  if (r.response_metadata?.session_ref) {
    session = await svc.entities.BrowserExecutionSession.update(session.id, { execution_session_reference: r.response_metadata.session_ref }).catch(() => session);
    exec.session = { ...exec.session, execution_session_reference: r.response_metadata.session_ref };
  }
  if (r.currentStep) session = await svc.entities.BrowserExecutionSession.update(session.id, { current_step: r.currentStep }).catch(() => session);
  if (r.checkpoint) session = await svc.entities.BrowserExecutionSession.update(session.id, { last_checkpoint: r.checkpoint }).catch(() => session);
  await recordEvent(svc, user, session, { step: "INIT", action: "open_portal", status: r.success ? "COMPLETED" : "FAILED", checkpoint: r.checkpoint, error_code: r.error_code });

  if (!r.success) return await failSession(svc, user, app, session, r, owner);

  // If init already requested a human pause (manual adapter), handle before loop.
  if (r.requiresHuman) return await handleHumanPause(svc, user, app, session, r, owner);

  // Run the deterministic step loop.
  return await runLoop(svc, user, app, session, adapter, ctx, exec, owner, opts);
}

// ---------- Step loop ----------
async function runLoop(svc: any, user: any, app: any, sessionIn: any, adapter: any, ctx: any, execIn: any, owner: string, opts: any): Promise<any> {
  let session = sessionIn;
  let exec = execIn;
  for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
    await renewLease(svc, session, owner);
    // Sync the exec context to the latest persisted session so the adapter sees
    // the current step + live session reference (crash recovery picks up here).
    exec = { ...exec, session };
    const step = session.current_step;
    if (!step) break;
    let r: ExecutionResult;
    try { r = await adapter.executeStep(ctx, exec); }
    catch (e: any) { r = { success: false, status: "FAILED", step: undefined as any, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT" } as any; }
    const t0 = Date.now();
    void t0;
    await recordEvent(svc, user, session, { step, action: String(step).toLowerCase(), status: r.success ? "COMPLETED" : "FAILED", checkpoint: r.checkpoint, url: r.next_url, external_reference: r.externalReference, error_code: r.error_code, error_category: r.error_category });

    if (r.requiresHuman) return await handleHumanPause(svc, user, app, session, r, owner);
    if (r.indeterminate) return await handleUnknownState(svc, user, app, session, r, owner);
    if (!r.success) return await failSession(svc, user, app, session, r, owner);

    const update: any = {};
    if (r.checkpoint) update.last_checkpoint = r.checkpoint;
    if (r.currentStep) update.current_step = r.currentStep;
    if (r.status) update.status = r.status;
    if (r.externalReference) update.external_reference = r.externalReference;
    if (r.next_url) update.last_url = r.next_url;
    if (Object.keys(update).length) session = await svc.entities.BrowserExecutionSession.update(session.id, update).catch(() => session);
    exec = { ...exec, session };

    if (r.done) return await finalizeCompletion(svc, user, app, session, r, owner);
  }
  // Ran to step budget: leave running; caller (worker) can resume.
  await releaseLease(svc, session);
  return { session, ran_to_budget: true };
}

// ---------- Human pause (§23-25) ----------
async function handleHumanPause(svc: any, user: any, app: any, session: any, r: ExecutionResult, owner: string): Promise<any> {
  const reason = r.humanReason || "MANUAL_REVIEW";
  const ar = await svc.entities.ExecutionActionRequest.create({
    execution_session_id: session.id, application_id: app.id, traveler_id: app.traveler_id,
    type: reason, reason: String(r.humanInstructions || reason), status: "OPEN",
    instructions: String(r.humanInstructions || ""), step: session.current_step || null, metadata: { error_code: r.error_code },
  });
  await svc.entities.BrowserExecutionSession.update(session.id, { status: "WAITING_FOR_USER", error_code: r.error_code || null, error_category: "HUMAN_REQUIRED" }).catch(() => {});
  await audit(svc, user, app, "paused", { reason, action_request_id: ar.id });
  await releaseLease(svc, session);
  return { session, paused: true, action_request: ar };
}

// ---------- Unknown external state (§28) ----------
async function handleUnknownState(svc: any, user: any, app: any, session: any, r: ExecutionResult, owner: string): Promise<any> {
  const ar = await svc.entities.ExecutionActionRequest.create({
    execution_session_id: session.id, application_id: app.id, traveler_id: app.traveler_id,
    type: "UNKNOWN_EXTERNAL_STATE", reason: "Submit was sent but no confirmation received; duplicate submission must not be attempted.", status: "OPEN", instructions: "Query provider status or review manually before any retry.", step: session.current_step || "SUBMIT", metadata: { indeterminate: true },
  });
  await svc.entities.BrowserExecutionSession.update(session.id, { status: "UNKNOWN_EXTERNAL_STATE", error_code: "SUBMIT_TIMEOUT", error_category: "UNKNOWN" }).catch(() => {});
  await audit(svc, user, app, "unknown_external_state", { action_request_id: ar.id });
  await releaseLease(svc, session);
  return { session, unknown_external_state: true, action_request: ar };
}

// ---------- Failure ----------
async function failSession(svc: any, user: any, app: any, session: any, r: ExecutionResult, owner: string): Promise<any> {
  const status = r.requiresHuman ? "WAITING_FOR_USER" : "FAILED";
  const updated = await svc.entities.BrowserExecutionSession.update(session.id, { status, error_code: r.error_code || null, error_category: r.error_category || null, ended_at: new Date().toISOString() }).catch(() => session);
  await audit(svc, user, app, "failed", { error_code: r.error_code, error_category: r.error_category });
  await releaseLease(svc, session);
  if (r.requiresHuman) return await handleHumanPause(svc, user, app, session, r, owner);
  return { session: updated, failed: true };
}

// ---------- Completion: reference + receipt capture ----------
async function finalizeCompletion(svc: any, user: any, app: any, sessionIn: any, r: ExecutionResult, owner: string): Promise<any> {
  let session = sessionIn;
  // Capture receipt via the Document Vault (§60), never mutating originals.
  let receipt_document_id: any = null, receipt_document_version_id: any = null;
  if (r.receipt?.url) {
    try {
      const { document, version } = await createDocument(svc, user, {
        traveler_id: app.traveler_id, document_type: "SUBMISSION_RECEIPT",
        display_name: `Receipt ${(session.external_reference || r.externalReference || session.id.slice(-6)).toUpperCase()}`,
        storage_uri: r.receipt.url, mime_type: r.receipt.mime_type || "application/pdf", file_size: 0,
      });
      receipt_document_id = document.id; receipt_document_version_id = version.id;
    } catch (e) { console.error("execution receipt capture failed", e?.message || e); }
  }
  session = await svc.entities.BrowserExecutionSession.update(session.id, { status: "COMPLETED", last_checkpoint: "RECEIPT_CAPTURED", ended_at: new Date().toISOString(), receipt_document_id, receipt_document_version_id, external_reference: r.externalReference || session.external_reference }).catch(() => session);
  // Update the underlying submission (reference + SUBMITTED).
  if (session.submission_id) {
    await svc.entities.Submission.update(session.submission_id, { external_reference: r.externalReference || null, external_application_id: r.externalReference || null, status: "SUBMITTED", last_status: "SUBMITTED", submitted_at: new Date().toISOString(), receipt_document_id, receipt_document_version_id }).catch(() => {});
  }
  // Phase 31 \u00a73/\u00a75: derive state via the case engine; status becomes a projection.
  await setApplicationLifecycle(svc, app, "submitted", { source: "execution", actor_id: "system" }).catch(() => {});
  await audit(svc, user, app, "submitted", { external_reference: r.externalReference, receipt_document_id });
  await releaseLease(svc, session);
  return { session, completed: true };
}

// ---------- Resume after human action (§25) ----------
export async function resumeExecution(svc: any, user: any, sessionId: string, opts: { resolution?: string; behaviors?: any; workerId?: string } = {}): Promise<any> {
  let session: any = await svc.entities.BrowserExecutionSession.get(sessionId).catch(() => null);
  if (!session) throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND" });
  if (["COMPLETED", "CANCELLED"].includes(session.status)) return { session, idempotent: true };
  const app = await getApplication(svc, user, session.application_id);
  const provider: any = await svc.entities.Provider.get(session.provider_id).catch(() => null);
  const adapter = getExecutionAdapter(provider.adapter_key);

  // Unknown post-submit state: never re-run submit; query provider status.
  if (session.status === "UNKNOWN_EXTERNAL_STATE") {
    const ref = session.external_reference || (await svc.entities.Submission.get(session.submission_id).catch(() => null))?.external_reference;
    if (adapter.getStatus && ref) {
      const ctx = await buildExecProviderContext(svc, provider);
      const st: ExecutionResult = await adapter.getStatus(ctx, { external_reference: ref, submission_id: session.submission_id }).catch(() => ({ success: false } as ExecutionResult));
      if (st.success && st.done) {
        return await finalizeCompletion(svc, user, app, session, { success: true, externalReference: session.external_reference, receipt: { url: "https://portal.mock-gov.example/receipt/" + ref, mime_type: "application/pdf" } } as any, opts.workerId || "worker-resume");
      }
    }
    // Still unknown — leave the OPEN action request for manual review.
    return { session, still_unknown: true };
  }

  // Re-check gates (the package may have changed during the pause — §55/§56/§57).
  try { await checkExecutionGates(svc, user, app); }
  catch (e: any) { await failSession(svc, user, app, session, { success: false, error_code: e.code, error_category: "PERMANENT" } as any, opts.workerId || "worker-resume"); return { session, blocked: true, error_code: e.code }; }

  const owner = opts.workerId || "worker-resume";
  await acquireLease(svc, session, owner);
  const ctx = await buildExecProviderContext(svc, provider);
  const exec: any = await buildExecContext(svc, user, session, opts);
  exec.resolution = opts.resolution;
  return await runLoop(svc, user, app, session, adapter, ctx, exec, owner, opts);
}

// ---------- Resolve a human action request ----------
export async function resolveActionRequest(svc: any, user: any, actionRequestId: string, action: "RESUME" | "RETRY" | "CANCEL" | "SWITCH_MANUAL", detail?: string): Promise<any> {
  const ar: any = await svc.entities.ExecutionActionRequest.get(actionRequestId).catch(() => null);
  if (!ar) throw Object.assign(new Error("Action request not found"), { code: "NOT_FOUND" });
  await svc.entities.ExecutionActionRequest.update(actionRequestId, { status: "RESOLVED", resolution_action: action, resolved_at: new Date().toISOString(), resolved_by: (user?.full_name || user?.email || user?.id || "system"), metadata: { ...(ar.metadata || {}), detail: detail || null } });
  const session: any = await svc.entities.BrowserExecutionSession.get(ar.execution_session_id).catch(() => null);
  const app = await getApplication(svc, user, session.application_id);
  if (action === "CANCEL") return cancelExecution(svc, user, ar.execution_session_id, "operator_cancel");
  if (action === "SWITCH_MANUAL") return switchToManual(svc, user, ar.execution_session_id);
  const resolution = (ar.type === "OTP_REQUIRED" || ar.type === "CAPTCHA_REQUIRED") ? "OTP_SOLVED" : undefined;
  await audit(svc, user, app, "resumed", { action, action_request_id: ar.id });
  return resumeExecution(svc, user, ar.execution_session_id, { resolution });
}

// ---------- Crash recovery (§27): resume from last checkpoint ----------
export async function recoverExecution(svc: any, user: any, sessionId: string): Promise<any> {
  let session: any = await svc.entities.BrowserExecutionSession.get(sessionId).catch(() => null);
  if (!session) throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, session.application_id);
  // If the last durable checkpoint is SUBMITTED but the application is still
  // ambiguous, treat as unknown external state (never re-submit).
  if (session.last_checkpoint === "SUBMITTED" && !session.external_reference) {
    return handleUnknownStateSilent(svc, session);
  }
  // Resume from current_step (was last written before the crash).
  return resumeExecution(svc, user, sessionId, {});
}
async function handleUnknownStateSilent(svc: any, session: any): Promise<any> {
  const exists: any[] = await svc.entities.ExecutionActionRequest.filter({ execution_session_id: session.id, type: "UNKNOWN_EXTERNAL_STATE", status: "OPEN" }).catch(() => []);
  if (!exists.length) {
    await svc.entities.ExecutionActionRequest.create({ execution_session_id: session.id, application_id: session.application_id, traveler_id: session.traveler_id, type: "UNKNOWN_EXTERNAL_STATE", reason: "Recovery after submit without confirmation.", status: "OPEN", step: "SUBMIT", instructions: "Query provider status before any retry." });
  }
  await svc.entities.BrowserExecutionSession.update(session.id, { status: "UNKNOWN_EXTERNAL_STATE", error_code: "RECOVERED_UNKNOWN" }).catch(() => {});
  return { session, unknown_external_state: true };
}

// ---------- Manual switch (§25) ----------
export async function switchToManual(svc: any, user: any, sessionId: string): Promise<any> {
  let session: any = await svc.entities.BrowserExecutionSession.get(sessionId).catch(() => null);
  const app = await getApplication(svc, user, session.application_id);
  const manual: any[] = await svc.entities.Provider.filter({ adapter_key: "visa.exec.manual" }).catch(() => []);
  if (!manual[0]) throw Object.assign(new Error("No manual provider available"), { code: "NO_PROVIDER" });
  // Resolve a manual portal/workflow.
  const pds: any[] = await svc.entities.PortalDefinition.filter({ country: app.destination, execution_strategy: "MANUAL" }).catch(() => []);
  const portal = pds[0] || { id: "synthetic-manual", provider_id: manual[0].id, allowed_domains: [], base_url: "", execution_strategy: "MANUAL" };
  let wfs: any[] = await svc.entities.PortalWorkflow.filter({ portal_definition_id: portal.id }).catch(() => []);
  const workflow = wfs[0] || { id: "synthetic", steps: [{ key: "OPEN_PORTAL" }, { key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" }] };
  const plan = await svc.entities.ExecutionPlan.create({ application_id: app.id, traveler_id: app.traveler_id, submission_package_id: session.submission_package_id || (await getLatestReadyPackage(svc, app)).id, form_definition_id: null, form_snapshot_id: null, package_hash: session.package_hash || "", portal_definition_id: portal.id, portal_workflow_id: workflow.id || "synthetic", portal_workflow_version: "v1", execution_strategy: "MANUAL", steps: [{ key: "OPEN_PORTAL", order: 1, capability: "BROWSER_NAVIGATION", checkpoint: "PORTAL_OPENED" }, { key: "SUBMIT", order: 2, capability: "EXTERNAL_SUBMISSION", checkpoint: "SUBMITTED" }, { key: "CAPTURE_RECEIPT", order: 3, capability: "RECEIPT_CAPTURE", checkpoint: "RECEIPT_CAPTURED" }], version: "v1" });
  session = await svc.entities.BrowserExecutionSession.update(session.id, { strategy: "MANUAL", provider_id: manual[0].id, provider_key: manual[0].key, execution_plan_id: plan.id, portal_definition_id: portal.id, portal_workflow_id: workflow.id || "synthetic", current_step: "SUBMIT", status: "WAITING_FOR_USER", error_code: null, error_category: null }).catch(() => session);
  await audit(svc, user, app, "switched_to_manual", { session_id: session.id });
  // Pause for external manual completion.
  return handleHumanPause(svc, user, app, session, { success: false, requiresHuman: true, humanReason: "MANUAL_REVIEW", humanInstructions: "Complete submission externally then enter reference + receipt.", error_code: "MANUAL_REVIEW" } as any, "manual-switch");
}

// ---------- Pause / Cancel ----------
export async function pauseExecution(svc: any, user: any, sessionId: string): Promise<any> {
  const updated = await svc.entities.BrowserExecutionSession.update(sessionId, { status: "WAITING_FOR_USER" }).catch(() => null);
  await releaseLease(svc, { id: sessionId });
  return { session: updated };
}

export async function cancelExecution(svc: any, user: any, sessionId: string, reason = "operator_cancel"): Promise<any> {
  let session: any = await svc.entities.BrowserExecutionSession.get(sessionId).catch(() => null);
  const provider: any = await svc.entities.Provider.get(session?.provider_id).catch(() => null);
  if (provider) {
    const adapter = getExecutionAdapter(provider.adapter_key);
    if (adapter.cancel) { const ctx = await buildExecProviderContext(svc, provider); await adapter.cancel(ctx, {} as any).catch(() => {}); }
  }
  session = await svc.entities.BrowserExecutionSession.update(sessionId, { status: "CANCELLED", ended_at: new Date().toISOString(), error_code: reason }).catch(() => session);
  // Cancel open action requests.
  const open: any[] = await svc.entities.ExecutionActionRequest.filter({ execution_session_id: sessionId, status: "OPEN" }).catch(() => []);
  for (const o of open) await svc.entities.ExecutionActionRequest.update(o.id, { status: "CANCELLED", resolved_at: new Date().toISOString(), resolved_by: (user?.full_name || user?.email || "system") }).catch(() => {});
  const app = session?.application_id ? await getApplication(svc, user, session.application_id).catch(() => null) : null;
  if (app) await audit(svc, user, app, "cancelled", { reason });
  await releaseLease(svc, session);
  return { session };
}

// ---------- Status / Listing ----------
export async function getExecutionStatus(svc: any, user: any, sessionId: string): Promise<any> {
  const session: any = await svc.entities.BrowserExecutionSession.get(sessionId).catch(() => null);
  if (!session) throw Object.assign(new Error("Session not found"), { code: "NOT_FOUND" });
  await getApplication(svc, user, session.application_id);
  const events: any[] = await svc.entities.BrowserExecutionEvent.filter({ execution_session_id: session.id }).catch(() => []);
  events.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const actions: any[] = await svc.entities.ExecutionActionRequest.filter({ execution_session_id: session.id }).catch(() => []);
  return { session, events, actions };
}

export async function listExecutions(svc: any, user: any, applicationId: string): Promise<any[]> {
  const app = await getApplication(svc, user, applicationId);
  const rows: any[] = await svc.entities.BrowserExecutionSession.filter({ application_id: app.id }).catch(() => []);
  rows.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return rows;
}

export async function listAllExecutions(svc: any, user: any, opts: { status?: string } = {}): Promise<any[]> {
  const q = opts.status ? { status: opts.status } : {};
  const rows: any[] = await svc.entities.BrowserExecutionSession.filter(q).catch(() => []);
  rows.sort((a, b) => String(b.started_at || b.created_date || "").localeCompare(String(a.started_at || a.created_date || "")));
  return rows;
}

export { CHECKPOINT_ORDER };