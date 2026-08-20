// Worldz Visa (Phase 19) — operations engine. Owns the operational case
// lifecycle (§2): preparing → ready_for_review → under_review → ready_to_submit
// → submission_in_progress → submitted → submission_confirmed → processing →
// decision. Reuses the Phase 13 review engine as automated QC (§6), the Phase 8
// submission engine for the actual submission act (§16/§17), the Phase 12
// timeline/notifications for unified events (§29), and the Phase 19 tracking
// engine for post-submission status (§19). Submission/Order/Payment/Application
// state is NEVER mutated directly from here — only the OperationsCase + audit
// + tracking + timeline + traveler action records.
//
// RBAC (§34): every mutating op requires user.role === 'admin' (operations/
// reviewer are admin-equivalent under the platform role model). The RLS on
// OperationsCase/OperationsAuditEvent enforces read/write admin-only; this
// engine adds a second server-side check before acting. Travelers are excluded.

import { RISK_WEIGHTS, levelFromScore, REVIEWER_ACTIONS } from "./catalog.ts";
import { canSubmitApplication, listFindings } from "../review/engine.ts";
import { getWorkspace } from "../workspace/engine.ts";
import { recordTimelineEvent } from "../journey/events.ts";
import { enterTrackingUpdate, listTrackingEvents, statusToCaseState, isDecisionStatus, recordTrackingTimeline } from "../tracking/engine.ts";
import { createSubmission, submitSubmission, enterExternalReference, uploadReceipt, approveSubmission, getLatestReadyPackage, listSubmissions } from "../submission/engine.ts";

const ALLOWED: Record<string, string[]> = {
  PREPARING: ["READY_FOR_REVIEW", "CANCELLED"],
  READY_FOR_REVIEW: ["UNDER_REVIEW", "PREPARING", "CANCELLED"],
  UNDER_REVIEW: ["READY_TO_SUBMIT", "PREPARING", "CANCELLED"],
  READY_TO_SUBMIT: ["SUBMISSION_IN_PROGRESS", "UNDER_REVIEW", "CANCELLED"],
  SUBMISSION_IN_PROGRESS: ["SUBMITTED", "FAILED", "CANCELLED"],
  SUBMITTED: ["SUBMISSION_CONFIRMED", "FAILED", "CANCELLED"],
  SUBMISSION_CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DECISION_RECEIVED", "CANCELLED"],
  DECISION_RECEIVED: ["COMPLETED", "UNDER_REVIEW", "CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

function assertAdmin(user: any) { if (!user || user.role !== "admin") throw Object.assign(new Error("Operations access required"), { code: "FORBIDDEN" }); }

function assertTransition(from: string, to: string) {
  if (from === to) return;
  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(to)) throw Object.assign(new Error(`Invalid transition ${from} → ${to}`), { code: "BAD_TRANSITION" });
}

async function audit(svc: any, user: any, c: any, action: string, previous: string, next: string, reason = "", metadata: any = {}) {
  await svc.entities.OperationsAuditEvent.create({
    case_id: c.id, application_id: c.application_id, traveler_id: c.traveler_id,
    actor_id: user?.id || "system", actor_name: user?.email || "system", actor_role: adminRole(user),
    action, previous_state: previous, new_state: next, reason, metadata, occurred_at: new Date().toISOString(),
  }).catch(() => {});
}
function adminRole(u: any): "ADMIN" | "SYSTEM" { return u?.role === "admin" ? "ADMIN" : "SYSTEM"; }

export async function ensureCase(svc: any, app: any): Promise<any> {
  const existing: any[] = await svc.entities.OperationsCase.filter({ application_id: app.id }).catch(() => []);
  if (existing[0]) return existing[0];
  return await svc.entities.OperationsCase.create({
    application_id: app.id, traveler_id: app.traveler_id, organization_id: app.organization_id,
    destination: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose,
    state: "PREPARING", review_state: "UNASSIGNED", qc_status: "NOT_RUN", priority: "NORMAL",
  });
}

export async function getCase(svc: any, application_id: string): Promise<any> {
  const rows: any[] = await svc.entities.OperationsCase.filter({ application_id }).catch(() => []);
  return rows[0] || null;
}

// ---------- QC, checklist, risk (§5/§6/§7) ----------

function computeRisk(review: any, wp: any): { score: number; level: string; factors: any[] } {
  const sections = wp?.sections || [];
  const doneSec = sections.filter((s: any) => s?.complete).length;
  const completeness = sections.length ? doneSec / sections.length : 1;
  const docs = wp?.documents || { verified: 0, total: 0 };
  const docRatio = docs.total ? docs.verified / docs.total : 1;
  const blocking = review?.blocking_count || 0;
  const warning = review?.warning_count || 0;
  const consistencyPenalty = Math.min(RISK_WEIGHTS.consistency, blocking * 15 + warning * 5);
  const reqCov = docs.total ? docs.verified / docs.total : completeness;
  let score = 100 - Math.round((1 - completeness) * RISK_WEIGHTS.completeness + (1 - docRatio) * RISK_WEIGHTS.documents + consistencyPenalty + (1 - reqCov) * RISK_WEIGHTS.requirement_coverage);
  score = Math.max(0, Math.min(100, score));
  const factors = [
    { code: "completeness", weight: RISK_WEIGHTS.completeness, detail: `${doneSec}/${sections.length} sections complete` },
    { code: "documents", weight: RISK_WEIGHTS.documents, detail: `${docs.verified}/${docs.total} documents verified` },
    { code: "consistency", weight: RISK_WEIGHTS.consistency, detail: `${blocking} blocking, ${warning} warnings` },
    { code: "requirement_coverage", weight: RISK_WEIGHTS.requirement_coverage, detail: `${Math.round(reqCov * 100)}% coverage` },
  ];
  return { score, level: levelFromScore(score), factors };
}

function buildChecklist(wp: any, review: any): any[] {
  const items: any[] = [];
  for (const s of wp?.sections || []) items.push({ code: `section.${s.key}`, label: s.label, status: s.complete ? "PASS" : "MISSING", requirement_id: null });
  for (const d of wp?.documents?.items || []) items.push({ code: `doc.${d.requirement_id || d.document_type}`, label: d.label || d.document_type, status: d.verified ? "PASS" : d.attached ? "WARNING" : "MISSING", requirement_id: d.requirement_id });
  if (review?.blocking_count > 0) items.push({ code: "consistency.blocking", label: "Consistency (blocking findings)", status: "BLOCKER", requirement_id: null });
  else if (review?.warning_count > 0) items.push({ code: "consistency.warning", label: "Consistency (warnings)", status: "WARNING", requirement_id: null });
  else items.push({ code: "consistency", label: "Consistency checks", status: "PASS", requirement_id: null });
  items.push({ code: "declarations", label: "Required declarations", status: "PASS", requirement_id: null });
  return items;
}

export async function prepareForSubmission(base44: any, svc: any, user: any, app: any, opts: { ai?: boolean } = {}): Promise<any> {
  assertAdmin(user);
  const c = await ensureCase(svc, app);
  const gate = await canSubmitApplication(base44, svc, user, app.id);
  const review = gate?.review || null;
  const qc_status = (review?.blocking_count || 0) > 0 ? "BLOCKER" : (review?.warning_count || 0) > 0 ? "WARNING" : "PASS";
  const wp = await getWorkspace(svc, user, app).catch(() => null);
  const risk = computeRisk(review, wp);
  const checklist = buildChecklist(wp, review);
  const pkg = await getLatestReadyPackage(svc, app).catch(() => null);
  const previous = c.state;
  const target = qc_status === "BLOCKER" ? "PREPARING" : "READY_FOR_REVIEW";
  const patch: any = {
    qc_status, qc_review_id: review?.id || null, quality_score: risk.score, risk_level: risk.level,
    risk_factors: risk.factors, checklist, review_state: target === "READY_FOR_REVIEW" && c.review_state === "UNASSIGNED" ? "UNASSIGNED" : c.review_state,
    submission_package_id: pkg?.id || c.submission_package_id, package_version: pkg?.version || c.package_version, package_hash: pkg?.package_hash || c.package_hash,
    submission_method: pickMethod(app),
  };
  if (c.state === "PREPARING" || c.state === "READY_FOR_REVIEW") {
    try { assertTransition(c.state, target); patch.state = target; patch.previous_state = previous; patch.state_changed_at = new Date().toISOString(); }
    catch {}
  }
  const updated = await svc.entities.OperationsCase.update(c.id, patch);
  await audit(svc, user, { ...c, application_id: c.application_id, traveler_id: c.traveler_id, id: c.id }, "QC_RUN", previous, patch.state || previous, qc_status, { review_id: review?.id });
  return { case: updated, qc: { status: qc_status, review_id: review?.id, blocking: review?.blocking_count, warnings: review?.warning_count }, blocked: qc_status === "BLOCKER", reasons: gate?.reasons || [], risk, checklist };
}

function pickMethod(app: any): string {
  const ch = app?.channel; if (ch === "evisa") return "API"; if (ch === "vac") return "MANUAL"; if (ch === "embassy") return "EMBASSY_APPOINTMENT"; return "OTHER";
}

// ---------- Assignment & review (§8/§9/§11) ----------

export async function listQueue(svc: any, user: any, filters: any = {}): Promise<any[]> {
  assertAdmin(user);
  const q: any = {};
  if (filters.state) q.state = filters.state;
  if (filters.assigned_to) q.assigned_to = filters.assigned_to;
  if (filters.review_state) q.review_state = filters.review_state;
  if (filters.destination) q.destination = filters.destination;
  if (filters.priority) q.priority = filters.priority;
  let rows: any[] = await svc.entities.OperationsCase.filter(q, "-state_changed_at", 200).catch(() => []);
  if (filters.issue_type) rows = rows.filter((r) => (r.checklist || []).some((i: any) => i.status === filters.issue_type));
  return rows;
}

async function transition(svc: any, user: any, c: any, to: string, reason = "", metadata: any = {}, action: string, extra: any = {}): Promise<any> {
  assertAdmin(user);
  const previous = c.state;
  assertTransition(previous, to);
  const patch = { state: to, previous_state: previous, state_changed_at: new Date().toISOString(), ...extra };
  const updated = await svc.entities.OperationsCase.update(c.id, patch);
  await audit(svc, user, c, action, previous, to, reason, metadata);
  return updated;
}

export async function assignCase(svc: any, user: any, caseId: string, assigneeId: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  if (!c) throw Object.assign(new Error("Case not found"), { code: "NOT_FOUND" });
  const updated = await svc.entities.OperationsCase.update(c.id, { assigned_to: assigneeId, assigned_at: new Date().toISOString(), assigned_by: user.id, review_state: "ASSIGNED" });
  await audit(svc, user, c, "ASSIGNED", c.state, c.state, "", { assignee_id: assigneeId });
  return updated;
}

export async function startReview(svc: any, user: any, caseId: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const updated = await transition(svc, user, c, "UNDER_REVIEW", "", {}, "REVIEW_STARTED", { review_state: "IN_REVIEW", assigned_to: c.assigned_to || user.id });
  return updated;
}

async function applicantAction(svc: any, user: any, app: any, type: string, title: string, description: string, metadata: any = {}): Promise<any> {
  const action_key = `ops:${type}:${app.id}:${Math.random().toString(36).slice(2, 8)}`;
  return await svc.entities.ApplicationAction.create({
    application_id: app.id, traveler_id: app.traveler_id, action_key, type: type === "DOCUMENT" ? "DOCUMENT" : "HUMAN_HANDOFF",
    title, description, priority: type === "DOCUMENT" ? "DOCUMENTS" : "MISSING_REQUIRED_DATA", status: "OPEN",
    source: "SUBMISSION", source_ref: user.id, cta_link: metadata.cta_link || `/applications/${app.id}/workspace`,
  }).catch(() => null);
}

export async function requestInformation(svc: any, user: any, caseId: string, message: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  await applicantAction(svc, user, app, "HUMAN_HANDOFF", "Additional information requested", message);
  await recordTimelineEvent(svc, app, { event_type: "ADDITIONAL_INFORMATION_REQUIRED", source_ref: c.id, actor_type: "OPERATOR", visibility: "CUSTOMER", metadata: { message } }).catch(() => {});
  await audit(svc, user, c, "REQUEST_INFO", c.state, c.state, message, {});
  return { ok: true, state: c.state };
}

export async function requestDocument(svc: any, user: any, caseId: string, message: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  await applicantAction(svc, user, app, "DOCUMENT", "New document requested", message);
  await recordTimelineEvent(svc, app, { event_type: "ADDITIONAL_INFORMATION_REQUIRED", source_ref: c.id, actor_type: "OPERATOR", visibility: "CUSTOMER", metadata: { message, document_request: true } }).catch(() => {});
  await audit(svc, user, c, "REQUEST_DOCUMENT", c.state, c.state, message, {});
  return { ok: true };
}

export async function flagIssue(svc: any, user: any, caseId: string, reason: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const updated = await svc.entities.OperationsCase.update(c.id, { priority: "HIGH" });
  await audit(svc, user, c, "FLAG_ISSUE", c.state, c.state, reason, {});
  return updated;
}

export async function rejectPackage(svc: any, user: any, caseId: string, reason: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  const updated = await transition(svc, user, c, "PREPARING", reason, {}, "REJECT_PACKAGE", { review_state: "UNASSIGNED" });
  await applicantAction(svc, user, app, "HUMAN_HANDOFF", "Application package rejected", reason);
  return updated;
}

export async function returnToApplicant(svc: any, user: any, caseId: string, reason: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  const updated = await transition(svc, user, c, "PREPARING", reason, {}, "RETURN_TO_APPLICANT", { review_state: "UNASSIGNED" });
  await applicantAction(svc, user, app, "HUMAN_HANDOFF", "Application returned for changes", reason);
  return updated;
}

export async function escalate(svc: any, user: any, caseId: string, reason: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const updated = await svc.entities.OperationsCase.update(c.id, { escalated: true, escalated_by: user.id, escalated_at: new Date().toISOString(), escalation_reason: reason, review_state: "ESCALATED", priority: "URGENT" });
  await audit(svc, user, c, "ESCALATE", c.state, c.state, reason, {});
  return updated;
}

// Approval gate (§31): only UNDER_REVIEW + QC PASS/WARNING may go READY_TO_SUBMIT.
export async function approveForSubmission(svc: any, user: any, caseId: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  if (c.state !== "UNDER_REVIEW") throw Object.assign(new Error("Case must be under review"), { code: "BAD_STATE" });
  if (c.qc_status === "BLOCKER") throw Object.assign(new Error("QC has blocking findings"), { code: "QC_BLOCKED" });
  // Krosz locked MVP: payment is followed by an explicit Visa Approver Manager review.
  // No case may enter the submission queue until that post-payment review is APPROVED_FOR_SUBMISSION.
  const pp: any[] = await svc.entities.PostPaymentReview.filter({ application_id: c.application_id }).catch(() => []);
  pp.sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  const latest = pp[0];
  if (!latest) throw Object.assign(new Error("Post-payment Visa Approver Manager review is required"), { code: "VISA_APPROVER_REVIEW_REQUIRED" });
  if (latest.status !== "APPROVED_FOR_SUBMISSION") {
    throw Object.assign(new Error(`Visa Approver Manager review not approved (${latest.status})`), { code: latest.status === "NOT_DOABLE_PENDING_CEO" ? "CEO_REVIEW_REQUIRED" : "VISA_APPROVER_REVIEW_REQUIRED", post_payment_review_id: latest.id });
  }
  const app = await svc.entities.VisaApplication.get(c.application_id);
  try { await approveSubmission(svc, user, app); } catch {}
  const updated = await transition(svc, user, c, "READY_TO_SUBMIT", "", { post_payment_review_id: latest.id, verifier_id: latest.verifier_id }, "APPROVE_FOR_SUBMISSION", { review_state: "REVIEWED" });
  return updated;
}

// ---------- Manual submission workflow (§16/§17) ----------

export async function startSubmission(svc: any, user: any, caseId: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  if (c.state !== "READY_TO_SUBMIT") throw Object.assign(new Error("Case must be ready to submit"), { code: "BAD_STATE" });
  const app = await svc.entities.VisaApplication.get(c.application_id);
  const subRes: any = await createSubmission(svc, user, app);
  const sub = subRes?.submission || subRes;
  const updated = await transition(svc, user, c, "SUBMISSION_IN_PROGRESS", "", {}, "SUBMISSION_STARTED", { submission_id: sub?.id });
  return { case: updated, submission: sub };
}

export async function confirmManualSubmission(svc: any, user: any, caseId: string, payload: { government_reference?: string; embassy_reference?: string; courier_tracking_id?: string; appointment_reference?: string; notes?: string; receipt?: { storage_uri: string; mime_type: string; file_size: number; display_name?: string } }): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  if (!c.submission_id) throw Object.assign(new Error("No submission record; start submission first"), { code: "NO_SUBMISSION" });
  const app = await svc.entities.VisaApplication.get(c.application_id);
  if (payload.government_reference) await enterExternalReference(svc, user, c.submission_id, payload.government_reference).catch(() => {});
  if (payload.receipt) await uploadReceipt(svc, user, c.submission_id, payload.receipt).catch(() => {});
  await submitSubmission(svc, user, app).catch(() => {});
  const refPatch: any = {};
  if (payload.government_reference) refPatch.government_reference = payload.government_reference;
  if (payload.embassy_reference) refPatch.embassy_reference = payload.embassy_reference;
  if (payload.courier_tracking_id) refPatch.courier_tracking_id = payload.courier_tracking_id;
  if (payload.appointment_reference) refPatch.appointment_reference = payload.appointment_reference;
  const submitted = await transition(svc, user, c, "SUBMITTED", payload.notes || "", {}, "SUBMISSION_CONFIRMED", refPatch);
  await recordTimelineEvent(svc, app, { event_type: "SUBMISSION_COMPLETED", source_ref: c.submission_id, actor_type: "OPERATOR", visibility: "CUSTOMER", metadata: { government_reference: payload.government_reference } }).catch(() => {});
  // Advance to SUBMISSION_CONFIRMED + begin tracking.
  const confirmed = await transition(svc, user, { ...submitted, application_id: c.application_id, traveler_id: c.traveler_id, id: c.id }, "SUBMISSION_CONFIRMED", "", {}, "SUBMISSION_CONFIRMED");
  const processing = await transition(svc, user, { ...confirmed, application_id: c.application_id, traveler_id: c.traveler_id, id: c.id }, "PROCESSING", "", {}, "SUBMISSION_CONFIRMED", { normalized_status: "SUBMITTED" });
  return processing;
}

// ---------- Tracking & decision (§19/§24/§26) ----------

export async function enterTracking(svc: any, user: any, caseId: string, update: { raw_status: string; source: string; description?: string; provider_key?: string }): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  const { event, duplicate, normalized_status } = await enterTrackingUpdate(svc, { application_id: c.application_id, traveler_id: c.traveler_id, submission_id: c.submission_id }, update);
  if (normalized_status === "TRACKING_UNAVAILABLE") {
    // §24: tracking failure must NOT become APPLICATION_FAILED. Keep case state.
    await svc.entities.OperationsCase.update(c.id, { raw_status: update.raw_status, normalized_status, last_tracking_at: new Date().toISOString() }).catch(() => {});
    await audit(svc, user, c, "TRACKING_UPDATED", c.state, c.state, "tracking unavailable", { raw_status: update.raw_status });
    return { case: c, event, duplicate, normalized_status, tracking_unavailable: true };
  }
  if (isDecisionStatus(normalized_status)) {
    const decision = normalized_status as "APPROVED" | "REFUSED" | "WITHDRAWN" | "CANCELLED";
    const out = await handleDecision(svc, user, caseId, { decision, raw_status: update.raw_status });
    return { ...out, event, duplicate };
  }
  const target = statusToCaseState(normalized_status) || "PROCESSING";
  const cur = c.state === "SUBMISSION_CONFIRMED" || c.state === "PROCESSING" ? c : await svc.entities.OperationsCase.get(caseId);
  let updated = cur;
  if (cur.state !== target && ALLOWED[cur.state]?.includes(target)) {
    updated = await transition(svc, user, cur, target, "", {}, "TRACKING_UPDATED", { normalized_status, raw_status: update.raw_status, last_tracking_at: new Date().toISOString() });
  } else {
    updated = await svc.entities.OperationsCase.update(c.id, { normalized_status, raw_status: update.raw_status, last_tracking_at: new Date().toISOString() });
  }
  if (!duplicate) await recordTrackingTimeline(svc, app, normalized_status, update.raw_status, event?.occurred_at || new Date().toISOString());
  await audit(svc, user, c, "TRACKING_UPDATED", cur.state, updated.state || cur.state, "", { normalized_status, raw_status: update.raw_status });
  return { case: updated, event, duplicate, normalized_status };
}

export async function handleDecision(svc: any, user: any, caseId: string, payload: { decision: "APPROVED" | "REFUSED" | "WITHDRAWN" | "CANCELLED" | "NEEDS_REVIEW"; decision_date?: string; raw_status?: string }): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  const app = await svc.entities.VisaApplication.get(c.application_id);
  if (payload.decision === "NEEDS_REVIEW") {
    const updated = await transition(svc, user, c, "UNDER_REVIEW", "ambiguous decision", {}, "DECISION_RECEIVED", { decision: "NEEDS_REVIEW", decision_needs_review: true, raw_status: payload.raw_status });
    await recordTimelineEvent(svc, app, { event_type: "DECISION_RECEIVED", source_ref: c.id, actor_type: "OPERATOR", visibility: "OPERATOR", metadata: { needs_review: true } }).catch(() => {});
    return updated;
  }
  const decision = await transition(svc, user, c, "DECISION_RECEIVED", payload.raw_status || "", {}, "DECISION_RECEIVED", { decision: payload.decision, decision_date: payload.decision_date, raw_status: payload.raw_status });
  const completed = await transition(svc, user, { ...decision, application_id: c.application_id, traveler_id: c.traveler_id, id: c.id }, "COMPLETED", "", {}, "DECISION_RECEIVED");
  const eventType = payload.decision === "APPROVED" ? "VISA_APPROVED" : payload.decision === "REFUSED" ? "VISA_REFUSED" : "APPLICATION_CANCELLED";
  await recordTimelineEvent(svc, app, { event_type: eventType, source_ref: c.id, actor_type: "PROVIDER", visibility: "CUSTOMER", metadata: { decision: payload.decision, decision_date: payload.decision_date } }).catch(() => {});
  return completed;
}

// ---------- Context bundles (§10/§35/§36/§37) ----------

export async function getCaseDetail(svc: any, user: any, caseId: string): Promise<any> {
  assertAdmin(user);
  const c = await svc.entities.OperationsCase.get(caseId);
  if (!c) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  const [app, auditRows, tracking, actions, findings] = await Promise.all([
    svc.entities.VisaApplication.get(c.application_id).catch(() => null),
    svc.entities.OperationsAuditEvent.filter({ case_id: caseId }, "-occurred_at", 100).catch(() => []),
    listTrackingEvents(svc, user, c.application_id),
    svc.entities.ApplicationAction.filter({ application_id: c.application_id, status: "OPEN" }).catch(() => []),
    c.qc_review_id ? listFindings(svc, user, c.qc_review_id) : Promise.resolve([]),
  ]);
  return { case: c, application: app, audit: auditRows, tracking, actions, findings, qc_review_id: c.qc_review_id };
}

export async function getOpsDashboard(svc: any, user: any): Promise<any> {
  assertAdmin(user);
  const cases: any[] = await svc.entities.OperationsCase.list("-state_changed_at", 500).catch(() => []);
  const counts: Record<string, number> = {};
  for (const c of cases) counts[c.state] = (counts[c.state] || 0) + 1;
  const openActions: any[] = await svc.entities.ApplicationAction.filter({ status: "OPEN" }).catch(() => []);
  return {
    metrics: {
      awaiting_review: (counts.READY_FOR_REVIEW || 0) + (counts.UNDER_REVIEW || 0),
      needs_user_action: openActions.length,
      ready_to_submit: counts.READY_TO_SUBMIT || 0,
      submission_in_progress: counts.SUBMISSION_IN_PROGRESS || 0,
      submitted: counts.SUBMITTED || 0 + (counts.SUBMISSION_CONFIRMED || 0) + (counts.PROCESSING || 0),
      processing: counts.PROCESSING || 0,
      decisions_received: counts.DECISION_RECEIVED || 0 + (counts.COMPLETED || 0),
      completed: counts.COMPLETED || 0,
    },
    counts,
    total: cases.length,
  };
}

// Support context (§36): a single lookup, no duplicated state.
export async function getSupportContext(svc: any, user: any, application_id: string): Promise<any> {
  assertAdmin(user);
  const app = await svc.entities.VisaApplication.get(application_id).catch(() => null);
  if (!app) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  const [c, orders, submissions, actions] = await Promise.all([
    getCase(svc, application_id),
    svc.entities.Order.filter({ application_id }, "-created_date", 10).catch(() => []),
    listSubmissions(svc, user, application_id).then((r: any) => r.submissions || []).catch(() => []),
    svc.entities.ApplicationAction.filter({ application_id, status: "OPEN" }).catch(() => []),
  ]);
  const order = orders[0];
  const payment = order ? (await svc.entities.Payment.filter({ order_id: order.id }).catch(() => []))[0] : null;
  return {
    customer: { traveler_id: app.traveler_id },
    application: { id: app.id, destination: app.destination, purpose: app.purpose, visa_type_key: app.visa_type_key, status: app.status },
    order: order ? { id: order.id, order_number: order.order_number, status: order.status, total_minor: order.total_minor, currency: order.currency } : null,
    payment: payment ? { id: payment.id, status: payment.status } : null,
    submission: submissions[0] ? { id: submissions[0].id, status: submissions[0].status, external_reference: submissions[0].external_reference } : null,
    operations_case: c ? { id: c.id, state: c.state, normalized_status: c.normalized_status, decision: c.decision } : null,
    outstanding_action: actions[0] ? { title: actions[0].title, type: actions[0].type } : null,
  };
}

// Traveler status (§37): the post-payment customer view, built from timeline +
// tracking + outstanding actions + decision. Never exposes internal ops records.
export async function getTravelerStatus(svc: any, user: any, application_id: string): Promise<any> {
  const app = await svc.entities.VisaApplication.get(application_id).catch(() => null);
  if (!app) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  if (app.created_by_id !== user.id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const [tracking, actions, timeline] = await Promise.all([
    listTrackingEvents(svc, user, application_id),
    svc.entities.ApplicationAction.filter({ application_id, status: "OPEN" }).catch(() => []),
    svc.entities.ApplicationTimelineEvent.filter({ application_id, visibility: "CUSTOMER" }, "-occurred_at", 100).catch(() => []),
  ]);
  const c = user.role === "admin" ? await getCase(svc, application_id) : null;
  return {
    application: app,
    current_status: c?.normalized_status || (timeline[0]?.event_type || "SUBMITTED"),
    decision: c?.decision || null,
    decision_date: c?.decision_date || null,
    tracking_events: tracking,
    outstanding_actions: actions,
    timeline,
  };
}

// Pure helpers exported for contract tests.
export function canTransition(from: string, to: string): boolean { return from === to || (ALLOWED[from] || []).includes(to); }
export const TRANSITIONS_MAP = ALLOWED;
export { computeRisk, buildChecklist };
export { REVIEWER_ACTIONS };