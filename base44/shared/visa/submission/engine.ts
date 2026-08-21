// Worldz Visa (Phase 8) — Submission engine.
//
// Orchestrates the provider-neutral submission lifecycle. Owns:
//   - Package integrity verification (§50): stored package_hash == recomputed.
//   - Stale-package guard (§51): answer/document/form changes block submission.
//   - Idempotent create + submit (§21): keyed by application_id + package_hash + provider_id.
//   - Status normalization + provider response recording (§12/§16/§17).
//   - Manual workflow: enterExternalReference + uploadReceipt (§25/§26).
//   - Audit (§44) via the existing AuditLog (documentAudit), never logging PII.
//
// The orchestrator owns execution + recovery; the provider owns external
// interaction. This engine is the visa-domain service the visaApi thin layer calls.

import { resolveSubmissionProvider, buildSubmissionContract, type ResolvedSubmissionProvider } from "./resolver.ts";
import { documentAudit, createDocument } from "../documents.ts";
import { getApplication } from "../application.ts";
import { getLatestSnapshot, checkSnapshotStaleness } from "../forms.ts";
import { categorizeError, normalizeStatus, submissionIdempotencyKey, type SubmissionContract, type SubmissionStatus, type SubmissionResult } from "./types.ts";
import { setApplicationLifecycle, recordCaseEvent } from "../application/caseStore.ts";

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Package integrity (§50) ----------
export async function verifyPackageIntegrity(svc: any, pkg: any): Promise<{ valid: boolean; reason?: string; recomputed?: string }> {
  if (!pkg) return { valid: false, reason: "NO_PACKAGE" };
  const items: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: pkg.id }).catch(() => []);
  const docIds = items.filter((i) => i.document_version_id).map((i) => i.document_version_id).sort();
  const form = items.find((i) => i.type === "FORM");
  let dataHash = "";
  if (form?.form_snapshot_id) {
    const snap = await svc.entities.ApplicationFormSnapshot.get(form.form_snapshot_id).catch(() => null);
    dataHash = snap?.data_hash || "";
  }
  const recomputed = await sha256(JSON.stringify({
    form_version: pkg.form_version,
    form_data_hash: dataHash,
    document_version_ids: docIds,
    version: pkg.version,
  }));
  if (recomputed !== pkg.package_hash) return { valid: false, reason: "PACKAGE_MODIFIED", recomputed };
  return { valid: true, recomputed };
}

// ---------- Stale-package guard (§51) ----------
export async function checkPackageStale(svc: any, app: any, pkg: any): Promise<{ stale: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const items: any[] = await svc.entities.SubmissionPackageItem.filter({ package_id: pkg.id }).catch(() => []);
  const form = items.find((i) => i.type === "FORM");
  if (form?.form_snapshot_id) {
    const snap = await svc.entities.ApplicationFormSnapshot.get(form.form_snapshot_id).catch(() => null);
    if (snap && snap.status !== "fresh") reasons.push("FORM_SNAPSHOT_STALE");
    if (snap) {
      const { stale } = await checkSnapshotStaleness(svc, app, snap);
      if (stale) reasons.push("FORM_ANSWERS_CHANGED");
    }
  }
  const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
  const activeVersions = new Set(attachments.filter((a) => a.status !== "detached").map((a) => a.document_version_id));
  for (const it of items.filter((i) => i.document_version_id)) {
    if (!activeVersions.has(it.document_version_id)) reasons.push(`DOCUMENT_VERSION_CHANGED:${it.document_type || it.document_id}`);
  }
  return { stale: reasons.length > 0, reasons };
}

// ---------- Helpers ----------
export async function getLatestReadyPackage(svc: any, app: any): Promise<any | null> {
  const pkgs: any[] = await svc.entities.SubmissionPackage.filter({ application_id: app.id }).catch(() => []);
  if (!pkgs.length) return null;
  pkgs.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return pkgs.find((p) => p.status === "ready") || pkgs[0];
}

async function recordResponse(svc: any, user: any, submission: any, operation: string, result: SubmissionResult): Promise<void> {
  try {
    await svc.entities.SubmissionProviderResponse.create({
      submission_id: submission.id, application_id: submission.application_id, traveler_id: submission.traveler_id,
      provider_id: submission.provider_id, provider_key: submission.provider_key,
      operation, status: result.status || null, external_reference: result.external_reference || null,
      response_code: result.error_code || null,
      response_metadata: { success: result.success, error_category: result.error_category, retryable: result.retryable, provider_reference: result.provider_reference, ...(result.response_metadata || {}) },
      error_category: result.error_category || null, retryable: !!result.retryable, success: !!result.success,
      received_at: new Date().toISOString(),
    });
  } catch (e) { console.error("submission recordResponse failed", e?.message || e); }
  await documentAudit(svc, user, {
    action: `submission.${operation}`, entity_type: "Submission", entity_id: submission.id, application_id: submission.application_id,
    detail: { provider_id: submission.provider_id, success: result.success, status: result.status, external_reference: result.external_reference, error_code: result.error_code, error_category: result.error_category, package_hash: submission.package_hash },
  }).catch(() => {});
}

// Phase 31 \u00a73/\u00a75: status is now a DERIVED projection. The legacy 18-state value
// is mapped to a case_state and driven through the durable case engine. `status` is
// never written independently. current_step is derived from case_state.
async function setAppStatus(svc: any, app: any, status: string, _current_step: string) {
  const r = await setApplicationLifecycle(svc, app, status, { source: "submission", actor_id: "system" }).catch(() => null);
  return r?.case;
}

// ---------- Approval gate (§24/§52) ----------
export async function approveSubmission(svc: any, user: any, app: any): Promise<any> {
  const pkg = await getLatestReadyPackage(svc, app);
  if (!pkg || pkg.status !== "ready") throw Object.assign(new Error("No ready package to approve"), { code: "NO_READY_PACKAGE" });
  const integrity = await verifyPackageIntegrity(svc, pkg);
  if (!integrity.valid) throw Object.assign(new Error("Package integrity check failed"), { code: "PACKAGE_MODIFIED" });
  const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
  const row = await svc.entities.SubmissionApproval.create({
    application_id: app.id, submission_package_id: pkg.id, traveler_id: app.traveler_id,
    package_hash: pkg.package_hash, form_code: pkg.form_code, form_version: pkg.form_version,
    actor, approved_at: new Date().toISOString(), confirmed: true,
    warnings: integrity.valid ? [] : [integrity.reason || "PACKAGE_MODIFIED"], metadata: {},
  });
  await documentAudit(svc, user, { action: "submission.approved", entity_type: "SubmissionApproval", entity_id: row.id, application_id: app.id, detail: { package_hash: pkg.package_hash, form_version: pkg.form_version, actor } }).catch(() => {});
  await setAppStatus(svc, app, "submission_ready", "submission");
  return { approval: row };
}

async function requireApproval(svc: any, app: any, pkg: any): Promise<void> {
  const approvals: any[] = await svc.entities.SubmissionApproval.filter({ application_id: app.id, submission_package_id: pkg.id }).catch(() => []);
  if (!approvals.length) throw Object.assign(new Error("Submission not approved"), { code: "NOT_APPROVED" });
}

// ---------- Provider resolution ----------
export async function resolveProviderForApplication(svc: any, app: any, pkg?: any): Promise<{ resolved: ResolvedSubmissionProvider; contract: SubmissionContract }> {
  const pkg_ = pkg || await getLatestReadyPackage(svc, app);
  if (!pkg_) throw Object.assign(new Error("No submission package"), { code: "NO_PACKAGE" });
  const resolved = await resolveSubmissionProvider(svc, app, pkg_);
  const contract = await buildSubmissionContract(svc, app, pkg_, resolved);
  return { resolved, contract };
}

// ---------- Create submission (idempotent) ----------
export async function createSubmission(svc: any, user: any, app: any): Promise<any> {
  const pkg = await getLatestReadyPackage(svc, app);
  if (!pkg) throw Object.assign(new Error("No submission package"), { code: "NO_PACKAGE" });
  await requireApproval(svc, app, pkg);
  const integrity = await verifyPackageIntegrity(svc, pkg);
  if (!integrity.valid) throw Object.assign(new Error("Package integrity check failed"), { code: integrity.reason || "PACKAGE_MODIFIED" });
  const { stale, reasons } = await checkPackageStale(svc, app, pkg);
  if (stale) throw Object.assign(new Error("Package is stale: " + reasons.join(",")), { code: "PACKAGE_STALE", reasons });

  const { resolved, contract } = await resolveProviderForApplication(svc, app, pkg);
  const existing: any[] = await svc.entities.Submission.filter({ idempotency_key: resolved.idempotency_key }).catch(() => []);
  const live = existing.find((s) => s.status !== "CANCELLED" && s.status !== "FAILED") || existing[0];
  if (live) return { submission: live, idempotent: true };

  const ctx = await buildProviderContext(svc, resolved.provider);
  const vresult = await resolved.adapter.validatePackage(ctx, contract).catch((e: any) => ({ success: false, error_code: "VALIDATE_FAILED", error_message: String(e?.message || e), error_category: "PERMANENT" } as SubmissionResult));
  if (!vresult.success) throw Object.assign(new Error("Provider validation failed: " + vresult.error_message), { code: vresult.error_code || "VALIDATE_FAILED", error_category: vresult.error_category });

  const row = await svc.entities.Submission.create({
    application_id: app.id, submission_package_id: pkg.id, traveler_id: app.traveler_id,
    provider_id: resolved.provider_id, provider_key: resolved.provider_key, provider_type: resolved.provider_type,
    provider_version: pkg.form_version, channel: resolved.channel, environment: resolved.environment,
    status: "READY", external_reference: null, external_application_id: null, provider_reference: null,
    idempotency_key: resolved.idempotency_key, form_snapshot_id: pkg.form_snapshot_id,
    form_code: pkg.form_code, form_version: pkg.form_version, package_hash: pkg.package_hash,
    receipt_document_id: null, receipt_document_version_id: null, submitted_at: null, completed_at: null,
    last_status: "READY", error_code: null, error_category: null, metadata: { route_id: resolved.route?.id || null },
  });
  await recordResponse(svc, user, row, "created", vresult);
  await documentAudit(svc, user, { action: "submission.created", entity_type: "Submission", entity_id: row.id, application_id: app.id, detail: { provider_id: resolved.provider_id, provider_type: resolved.provider_type, idempotency_key: resolved.idempotency_key, package_hash: pkg.package_hash } }).catch(() => {});
  return { submission: row, idempotent: false };
}

// ---------- Submit (idempotent, irreversible-safe) ----------
export async function submitSubmission(svc: any, user: any, app: any): Promise<any> {
  const pkg = await getLatestReadyPackage(svc, app);
  if (!pkg) throw Object.assign(new Error("No submission package"), { code: "NO_PACKAGE" });
  let sub: any = (await svc.entities.Submission.filter({ application_id: app.id, submission_package_id: pkg.id }).catch(() => []))
    .sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")))[0];
  if (!sub) { const created = await createSubmission(svc, user, app); sub = created.submission; }
  if (["SUBMITTED", "PROCESSING", "COMPLETED", "REJECTED"].includes(sub.status)) return { submission: sub, idempotent: true };

  const integrity = await verifyPackageIntegrity(svc, pkg);
  if (!integrity.valid) { await failSubmission(svc, user, app, sub, "PACKAGE_MODIFIED", "Package integrity check failed", "PERMANENT"); throw Object.assign(new Error("Package integrity check failed"), { code: "PACKAGE_MODIFIED" }); }
  const { stale, reasons } = await checkPackageStale(svc, app, pkg);
  if (stale) { await failSubmission(svc, user, app, sub, "PACKAGE_STALE", reasons.join(","), "PERMANENT"); throw Object.assign(new Error("Package stale"), { code: "PACKAGE_STALE", reasons }); }

  const { resolved, contract } = await resolveProviderForApplication(svc, app, pkg);
  contract.submission_id = sub.id;
  await svc.entities.Submission.update(sub.id, { status: "SUBMITTING" }).catch(() => {});
  const ctx = await buildProviderContext(svc, resolved.provider);
  let result: SubmissionResult;
  try { result = await resolved.adapter.submit(ctx, contract); }
  catch (e: any) { result = { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT", retryable: true, status: "FAILED" }; }

  const status = result.status || (result.success ? "SUBMITTED" : "FAILED");
  const update: any = {
    status, last_status: status,
    external_reference: result.external_reference || sub.external_reference || null,
    external_application_id: result.external_application_id || null,
    provider_reference: result.provider_reference || sub.provider_reference || null,
    error_code: result.success ? null : (result.error_code || null),
    error_category: result.success ? null : (result.error_category || categorizeError(result.error_code, result.retryable)),
    submitted_at: result.success && status === "SUBMITTED" ? new Date().toISOString() : sub.submitted_at,
  };
  sub = await svc.entities.Submission.update(sub.id, update).catch(() => sub);
  await recordResponse(svc, user, sub, "submitted", result);

  if (result.success && status === "SUBMITTED") await setAppStatus(svc, app, "submitted", "submission");
  else if (status === "ACTION_REQUIRED") await setAppStatus(svc, app, "additional_documents", "submission");
  else if (!result.success) await setAppStatus(svc, app, "additional_documents", "submission");
  return { submission: sub, result };
}

async function failSubmission(svc: any, user: any, app: any, sub: any, code: string, message: string, category: string): Promise<void> {
  await svc.entities.Submission.update(sub.id, { status: "FAILED", last_status: "FAILED", error_code: code, error_category: category }).catch(() => {});
  await recordResponse(svc, user, { ...sub, status: "FAILED" }, "failed", { success: false, error_code: code, error_message: message, error_category: category as any, retryable: false });
}

// ---------- Manual workflow: operator enters external reference + uploads receipt ----------
export async function enterExternalReference(svc: any, user: any, submissionId: string, externalRef: string): Promise<any> {
  const sub: any = await svc.entities.Submission.get(submissionId).catch(() => null);
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, sub.application_id);
  if (!externalRef) throw Object.assign(new Error("external_reference required"), { code: "BAD_REQUEST" });
  const now = new Date().toISOString();
  const updated = await svc.entities.Submission.update(submissionId, {
    external_reference: externalRef, external_application_id: externalRef, status: "SUBMITTED", last_status: "SUBMITTED", submitted_at: sub.submitted_at || now,
  }).catch(() => sub);
  await recordResponse(svc, user, updated, "external_reference_entered", { success: true, status: "SUBMITTED", external_reference: externalRef });
  await setAppStatus(svc, app, "submitted", "submission");
  return { submission: updated };
}

export async function uploadReceipt(svc: any, user: any, submissionId: string, opts: { storage_uri: string; mime_type: string; file_size: number; display_name?: string }): Promise<any> {
  const sub: any = await svc.entities.Submission.get(submissionId).catch(() => null);
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "NOT_FOUND" });
  await getApplication(svc, user, sub.application_id);
  const { document, version } = await createDocument(svc, user, {
    traveler_id: sub.traveler_id, document_type: "SUBMISSION_RECEIPT",
    display_name: opts.display_name || `Receipt ${sub.form_code || sub.id.slice(-6)}`,
    storage_uri: opts.storage_uri, mime_type: opts.mime_type, file_size: opts.file_size,
  });
  await svc.entities.Submission.update(submissionId, { receipt_document_id: document.id, receipt_document_version_id: version.id }).catch(() => {});
  await recordResponse(svc, user, { ...sub, id: submissionId }, "receipt_uploaded", { success: true, status: "SUBMITTED", receipt: { document_id: document.id } });
  const fresh = await svc.entities.Submission.get(submissionId);
  await documentAudit(svc, user, { action: "submission.receipt_received", entity_type: "Submission", entity_id: submissionId, application_id: sub.application_id, detail: { document_id: document.id, version_id: version.id } }).catch(() => {});
  return { submission: fresh, document_id: document.id, version_id: version.id };
}

// ---------- Status polling ----------
export async function getSubmissionStatus(svc: any, user: any, submissionId: string): Promise<any> {
  const sub: any = await svc.entities.Submission.get(submissionId).catch(() => null);
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, sub.application_id);
  if (!sub.external_reference) return { submission: sub, status: sub.status, note: "No external reference yet" };
  const provider: any = await svc.entities.Provider.get(sub.provider_id).catch(() => null);
  if (!provider) throw Object.assign(new Error("Provider not found"), { code: "NO_PROVIDER" });
  const { getSubmissionAdapter } = await import("./registry.ts");
  const adapter = getSubmissionAdapter(provider.adapter_key);
  if (!adapter.getStatus) return { submission: sub, status: sub.status, note: "Provider does not support STATUS" };
  const ctx = await buildProviderContext(svc, provider);
  let result: SubmissionResult;
  try { result = await adapter.getStatus(ctx, { external_reference: sub.external_reference, submission_id: sub.id, submitted_at: sub.submitted_at }); }
  catch (e: any) { result = { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT", retryable: true }; }
  const status = (result.status || normalizeStatus(result.status as any, sub.status as SubmissionStatus)) as SubmissionStatus;
  const update: any = { status, last_status: status, error_code: result.success ? null : (result.error_code || null) };
  if (status === "COMPLETED") update.completed_at = new Date().toISOString();
  const updated = await svc.entities.Submission.update(submissionId, update).catch(() => sub);
  await recordResponse(svc, user, updated, "status", result);
  if (status === "COMPLETED") await setAppStatus(svc, app, "approved", "decision");
  else if (status === "REJECTED") await setAppStatus(svc, app, "refused", "decision");
  else if (status === "PROCESSING") await setAppStatus(svc, app, "government_processing", "decision");
  else if (status === "ACTION_REQUIRED") await setAppStatus(svc, app, "additional_documents", "submission");
  return { submission: updated, status, result };
}

// ---------- Cancel ----------
export async function cancelSubmission(svc: any, user: any, submissionId: string): Promise<any> {
  const sub: any = await svc.entities.Submission.get(submissionId).catch(() => null);
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "NOT_FOUND" });
  if (["COMPLETED", "REJECTED", "CANCELLED"].includes(sub.status)) throw Object.assign(new Error("Cannot cancel terminal submission"), { code: "TERMINAL" });
  const provider: any = await svc.entities.Provider.get(sub.provider_id).catch(() => null);
  let result: SubmissionResult = { success: true, status: "CANCELLED" };
  if (provider && sub.external_reference) {
    const { getSubmissionAdapter } = await import("./registry.ts");
    const adapter = getSubmissionAdapter(provider.adapter_key);
    if (adapter.cancel) {
      const ctx = await buildProviderContext(svc, provider);
      result = await adapter.cancel(ctx, { external_reference: sub.external_reference, submission_id: sub.id }).catch(() => ({ success: true, status: "CANCELLED" }));
    }
  }
  const updated = await svc.entities.Submission.update(submissionId, { status: "CANCELLED", last_status: "CANCELLED" }).catch(() => sub);
  await recordResponse(svc, user, updated, "cancelled", { success: true, status: "CANCELLED", external_reference: sub.external_reference });
  return { submission: updated };
}

// ---------- Listing ----------
export async function listSubmissions(svc: any, user: any, applicationId: string): Promise<any[]> {
  const app = await getApplication(svc, user, applicationId);
  const rows: any[] = await svc.entities.Submission.filter({ application_id: app.id }).catch(() => []);
  rows.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return rows;
}

export async function getSubmission(svc: any, user: any, submissionId: string): Promise<any> {
  const sub: any = await svc.entities.Submission.get(submissionId).catch(() => null);
  if (!sub) throw Object.assign(new Error("Submission not found"), { code: "NOT_FOUND" });
  await getApplication(svc, user, sub.application_id); // ownership check
  const responses: any[] = await svc.entities.SubmissionProviderResponse.filter({ submission_id: sub.id }).catch(() => []);
  responses.sort((a, b) => String(b.received_at || "").localeCompare(String(a.received_at || "")));
  return { submission: sub, responses };
}

// ---------- Provider context builder (reuses platform secrets; never exposed) ----------
async function buildProviderContext(svc: any, provider: any): Promise<any> {
  const creds: any[] = await svc.entities.ProviderCredential.filter({ provider_id: provider.id }).catch(() => []);
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) {
    for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) {
      if (!name) continue;
      credentials[name] = (c.key_configured || c.secret_configured) ? "(configured)" : undefined;
    }
  }
  return {
    providerId: provider.id, providerKey: provider.key, category: provider.category,
    environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials,
    requestId: crypto.randomUUID(),
  };
}