// Worldz Visa (Phase 29) — Admin control-plane presentation over the Phase 27
// Application Case Engine. PURE (no DB, no LLM). This never mutates case state and
// never recomputes visa truth; it derives deterministic admin-facing projections:
// allowed transitions (from the case engine, filtered by submission gating),
// case priority, SLA indicators, exceptions, quality signals, snapshot-vs-catalog
// drift, audit rows from case events, sensitive-field redaction, and role-based
// permissions. The admin UI consumes the backend `admin-case-*` actions which
// build these projections server-side — the client never derives truth and never
// bypasses the Case Engine (§26).

import {
  CASE_TRANSITIONS, TERMINAL_CASE, canTransitionCase, submissionAllowed,
  type CaseState, type ExecutionCapability, type ApplicationCase,
} from "./caseEngine.ts";
import {
  CASE_STATE_LABEL, EXECUTION_LABEL, nextActionFor, requiresSubmissionStep,
  feeForCase, eligibilityForCase, requiredDocsForCase,
} from "./presentation.ts";

export { CASE_STATE_LABEL, EXECUTION_LABEL, nextActionFor, requiresSubmissionStep, feeForCase, eligibilityForCase, requiredDocsForCase };

// ---- Allowed transitions (§12) ----
// Returns only states the case engine permits FROM the current state, with
// submission-gated states (SUBMISSION_PENDING/SUBMITTED) removed when the
// execution capability / provider authorization does not allow them. The UI
// asks the backend for this list rather than hardcoding the graph.
export function allowedTransitionsFor(c: any): CaseState[] {
  const from: CaseState = (c?.state || c?.case_state) as CaseState;
  const list: CaseState[] = CASE_TRANSITIONS[from] || [];
  return list.filter((to) => {
    if (to === "SUBMISSION_PENDING" || to === "SUBMITTED") {
      const s = submissionAllowed(c as ApplicationCase);
      return s.ok;
    }
    return true;
  });
}

export function isInvalidTransition(c: any, to: CaseState): boolean {
  return !allowedTransitionsFor(c).includes(to);
}

// ---- Permissions (§25/§26) ----
// Reuses the existing role system (admin | user). Admin = OPERATIONS + REVIEWER
// + ADMIN. We do not invent a new auth system. The ONE hard rule (§26): no role
// may turn GUIDANCE_ONLY into END_TO_END via a case UI override — execution
// capability is governed by the provider/execution system, never by admin fiat.
export interface AdminPermissions {
  can_list: boolean;
  can_view: boolean;
  can_transition: boolean;
  can_review: boolean;
  can_decide_documents: boolean;
  can_assign: boolean;
  can_note: boolean;
  can_set_priority: boolean;
  can_export: boolean;
  can_override_execution: boolean; // always false (§26)
  can_webhook: boolean;
}
export function adminPermissionsFor(role: string | undefined): AdminPermissions {
  const isAdmin = role === "admin";
  return {
    can_list: isAdmin,
    can_view: isAdmin,
    can_transition: isAdmin,
    can_review: isAdmin,
    can_decide_documents: isAdmin,
    can_assign: isAdmin,
    can_note: isAdmin,
    can_set_priority: isAdmin,
    can_export: isAdmin,
    can_override_execution: false,
    can_webhook: isAdmin,
  };
}
export function canOverrideExecution(): boolean { return false; }

// ---- Priority (§22) ----
// Deterministic. An admin may set URGENT/HIGH only with a recorded reason + actor;
// the override flag is persisted and audited. Business-rule priority is recomputed
// and never silently overridden.
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export function deterministicPriorityFor(c: any, opts: { now?: string; docs_attached?: number; payment_failed?: boolean; submission_failed?: boolean; days_in_state?: number } = {}): Priority {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const st: CaseState = (c?.state || c?.case_state) as CaseState;
  if (TERMINAL_CASE.includes(st)) return "LOW";
  if (st === "COMPLETED" || st === "APPROVED") return "LOW";
  if (st === "REVIEW_REQUIRED") return "HIGH";
  if (opts.payment_failed || opts.submission_failed) return "URGENT";
  const travel = c?.snapshot?.travel || c?.case_snapshot?.travel || (c as any)?.travel_start;
  if (travel) {
    const t = new Date(travel).getTime();
    if (!isNaN(t)) {
      const days = Math.ceil((t - now) / 86400000);
      if (days < 7 && st !== "SUBMITTED" && st !== "APPROVED") return "URGENT";
      if (days < 30 && st !== "SUBMITTED" && st !== "APPROVED") return "HIGH";
    }
  }
  if ((opts.days_in_state ?? 0) > 14 && (st === "DOCUMENTS_REVIEW" || st === "PROCESSING")) return "HIGH";
  if (st === "ADDITIONAL_INFORMATION_REQUIRED") return "HIGH";
  return "NORMAL";
}
export function applyPriorityOverride(base: Priority, override: Priority, reason: string | undefined, actor: string | undefined): { priority: Priority; overridden: boolean } {
  if (!reason || !actor) return { priority: base, overridden: false };
  // Never allow an override to silently *lower* an URGENT business rule.
  const rank: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };
  if (rank[override] < rank[base]) return { priority: base, overridden: false };
  return { priority: override, overridden: true };
}

// ---- SLA (§23) ----
// Deterministic operational expectation. Wording never implies a government
// guarantee. Overdue means processing time exceeded the *configured operational*
// expectation, not "the visa is late".
export interface Sla { age_days: number; expected_days: number; overdue: boolean; sla_risk: "LOW" | "MEDIUM" | "HIGH"; }
export function slaFor(c: any, opts: { now?: string; expected_days?: number } = {}): Sla {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const created = c?.created_at || c?.created_date;
  const age_ms = created ? now - new Date(created).getTime() : 0;
  const age_days = Math.max(0, Math.floor(age_ms / 86400000));
  const st: CaseState = (c?.state || c?.case_state) as CaseState;
  const expected = opts.expected_days ?? Number(c?.ops_expected_duration_days) ?? Number(c?.snapshot?.processing?.expected_days) ?? 15;
  const terminal = TERMINAL_CASE.includes(st);
  const processing = st === "SUBMITTED" || st === "PROCESSING";
  const overdue = !terminal && processing && age_days > expected;
  const sla_risk: Sla["sla_risk"] = overdue ? "HIGH" : (processing && age_days > expected * 0.8 ? "MEDIUM" : "LOW");
  return { age_days, expected_days: expected, overdue, sla_risk };
}

// ---- Exceptions (§21) ----
export interface CaseExceptionSignal { type: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; message: string; }
export function exceptionsFor(c: any, opts: { docs_attached?: number; payment_failed?: boolean; submission_failed?: boolean; webhook_failed?: boolean; days_in_state?: number; current_catalog?: any } = {}): CaseExceptionSignal[] {
  const out: CaseExceptionSignal[] = [];
  const st: CaseState = (c?.state || c?.case_state) as CaseState;
  const ec: ExecutionCapability = (c?.execution_capability || c?.snapshot?.execution_capability || "GUIDANCE_ONLY") as ExecutionCapability;
  const route = c?.route_status || c?.snapshot?.route_status;
  const snap = c?.snapshot || c?.case_snapshot || {};
  // Provider unavailable
  if (ec === "END_TO_END" && (route === "PROVIDER_UNVERIFIED" || route === "PROVIDER_UNAVAILABLE" || route === "NO_PROVIDER")) {
    out.push({ type: "provider_unavailable", severity: "HIGH", message: "Execution route is END_TO_END but no verified production provider is available." });
  }
  // Stale verification
  if (snap.verification_status && snap.verification_status !== "VERIFIED") {
    out.push({ type: "stale_verification", severity: "MEDIUM", message: `Case snapshot verification is ${snap.verification_status}, not VERIFIED.` });
  }
  // Missing document
  if (st === "DOCUMENTS_REQUIRED" && Number(opts.docs_attached ?? 0) === 0) {
    out.push({ type: "missing_document", severity: "HIGH", message: "Documents are required but none have been uploaded." });
  }
  // Payment failure
  if (opts.payment_failed) out.push({ type: "payment_failure", severity: "HIGH", message: "A payment attempt failed for this case." });
  // Submission failure
  if (opts.submission_failed) out.push({ type: "submission_failure", severity: "CRITICAL", message: "A submission attempt failed for this case." });
  // Eligibility conflict
  const el = eligibilityForCase(c);
  if (el === "ineligible") out.push({ type: "eligibility_conflict", severity: "HIGH", message: "Engine reports the traveler is not eligible." });
  if (el === "unknown") out.push({ type: "eligibility_conflict", severity: "MEDIUM", message: "Eligibility could not be confirmed at case creation." });
  // Snapshot drift
  if (opts.current_catalog && snapshotDiffers(c, opts.current_catalog).differs) {
    out.push({ type: "data_mismatch", severity: "MEDIUM", message: "Journey data has changed since this case was created." });
  }
  // Case stuck
  if ((opts.days_in_state ?? 0) > 14 && (st === "DOCUMENTS_REVIEW" || st === "PROCESSING" || st === "REVIEW_REQUIRED")) {
    out.push({ type: "case_stuck", severity: "HIGH", message: "Case has not progressed for an extended period." });
  }
  // Manual intervention
  if (st === "REVIEW_REQUIRED") out.push({ type: "manual_intervention_required", severity: "HIGH", message: "A review gate requires a decision to proceed." });
  // Webhook failure
  if (opts.webhook_failed) out.push({ type: "webhook_failure", severity: "MEDIUM", message: "A provider webhook could not be processed." });
  // Blocked (guidance-only claiming submit is impossible — sanity)
  if (ec === "GUIDANCE_ONLY" && (st === "SUBMISSION_PENDING" || st === "SUBMITTED")) {
    out.push({ type: "submission_unavailable", severity: "CRITICAL", message: "Case is guidance-only but reached a submission state — this should never happen." });
  }
  return out;
}

// ---- Snapshot vs current catalog (§9) ----
export function snapshotDiffers(c: any, current: any): { differs: boolean; changed_fields: string[] } {
  const snap = c?.snapshot || c?.case_snapshot || {};
  const cur = current || {};
  const fields = ["journey", "verification_status", "execution_capability"];
  const changed: string[] = [];
  for (const f of fields) {
    const a = snap[f];
    const b = cur[f];
    if (a && b && String(a) !== String(b)) changed.push(f);
  }
  const feeA = snap.fee?.government_minor;
  const feeB = cur.fee?.government_minor;
  if (feeA != null && feeB != null && Number(feeA) !== Number(feeB)) changed.push("fee_government_minor");
  return { differs: changed.length > 0, changed_fields: changed };
}

// ---- Quality signals (§30) ----
export function qualitySignals(c: any, opts: { docs_attached?: number; payment_failed?: boolean; current_catalog?: any; overdue?: boolean } = {}): { level: "ok" | "warn" | "alert"; messages: string[] } {
  const msgs: string[] = [];
  const ex = exceptionsFor(c, { docs_attached: opts.docs_attached, payment_failed: opts.payment_failed, current_catalog: opts.current_catalog });
  for (const e of ex) msgs.push(`⚠ ${e.message}`);
  if (opts.overdue) msgs.push("⚠ Processing time exceeded the configured operational expectation.");
  const na = nextActionFor(c);
  if (na.blocked) msgs.push(`⚠ Action required: ${na.label}.`);
  if (opts.docs_attached != null && opts.docs_attached < requiredDocsForCase(c).length && (c?.state || c?.case_state) === "DOCUMENTS_REQUIRED") msgs.push("⚠ Missing required document(s).");
  if (!requiresSubmissionStep(c) && (c?.state || c?.case_state) === "READY_FOR_SUBMISSION") msgs.push("⚠ Submission unavailable — continue on the official portal.");
  if (msgs.length === 0) return { level: "ok", messages: [] };
  const hasCritical = ex.some((e) => e.severity === "CRITICAL");
  return { level: hasCritical ? "alert" : "warn", messages: msgs };
}

// ---- Audit rows from case events (§20) ----
export interface AuditRow { actor: string; action: string; occurred_at: string; previous_state: string | null; new_state: string | null; reason: string | null; source: string | null; idempotency_key: string | null; }
export function auditFromEvents(events: any[]): AuditRow[] {
  return [...events].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).map((e) => ({
    actor: e.actor || "system",
    action: e.event_type || "UNKNOWN",
    occurred_at: e.occurred_at,
    previous_state: e.from_state ?? null,
    new_state: e.to_state ?? null,
    reason: e.reason ?? null,
    source: e.source ?? null,
    idempotency_key: e.idempotency_key ?? null,
  }));
}

// ---- Sensitive-field redaction (§27) ----
export function redactPassport(num: string | undefined | null): string {
  if (!num) return "—";
  const s = String(num);
  if (s.length <= 4) return "•".repeat(s.length);
  return s.slice(0, 2) + "•".repeat(s.length - 4) + s.slice(-2);
}
export function redactEmail(email: string | undefined | null): string {
  if (!email) return "—";
  const [u, d] = String(email).split("@");
  if (!d) return "—";
  return u.slice(0, 2) + "•".repeat(Math.max(2, u.length - 2)) + "@" + d;
}
export function redactPhone(phone: string | undefined | null): string {
  if (!phone) return "—";
  const s = String(phone).replace(/\s+/g, "");
  if (s.length <= 4) return "•".repeat(s.length);
  return s.slice(0, 2) + "•".repeat(s.length - 4) + s.slice(-2);
}

// ---- Review gate projection (§11) ----
export interface ReviewGateView { gate_type: string; status: "OPEN" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "NOT_REQUIRED"; requested_by?: string; assigned_to?: string; created_at?: string; resolved_at?: string; notes?: string; }
export function reviewGatesFor(c: any): ReviewGateView[] {
  const gates: ReviewGateView[] = [];
  const st: CaseState = (c?.state || c?.case_state) as CaseState;
  const review = c?.review;
  if (review && review.status) {
    gates.push({ gate_type: review.gate_type || "REVIEW", status: review.status, requested_by: review.requested_by, assigned_to: review.assigned_to, created_at: review.created_at, resolved_at: review.resolved_at, notes: review.notes });
  }
  // Eligibility review gate: implicit while ELIGIBILITY_REVIEW or when eligibility unknown
  const el = eligibilityForCase(c);
  if (st === "ELIGIBILITY_REVIEW" || el === "requires_review" || el === "unknown") {
    gates.push({ gate_type: "ELIGIBILITY_REVIEW", status: st === "ELIGIBILITY_REVIEW" ? "OPEN" : "NOT_REQUIRED", requested_by: "system" });
  }
  // Document review gate: implicit while DOCUMENTS_REVIEW
  if (st === "DOCUMENTS_REVIEW") gates.push({ gate_type: "DOCUMENT_REVIEW", status: "OPEN", requested_by: "system" });
  // Submission review gate: required for partial-assist before submit
  if ((c?.execution_capability === "PARTIAL_ASSIST" || c?.execution_capability === "APPLICATION_ASSIST") && st === "READY_FOR_SUBMISSION" && !c?.review_approved) {
    gates.push({ gate_type: "SUBMISSION_REVIEW", status: "OPEN", requested_by: "system" });
  }
  if (gates.length === 0) gates.push({ gate_type: "NONE", status: "NOT_REQUIRED" });
  return gates;
}

// ---- List row projection (§3) ----
export function adminListRow(r: any): any {
  const na = nextActionFor({ state: r.case_state || r.state, execution_capability: r.execution_capability, snapshot: r.case_snapshot });
  return {
    id: r.id,
    traveler_id: r.traveler_id,
    destination: r.destination,
    journey: r.visa_type_key,
    nationality: r.nationality,
    case_status: r.case_state,
    state_label: CASE_STATE_LABEL[r.case_state as CaseState] || r.case_state,
    normalized_status: r.normalized_status || r.case_state,
    execution_capability: r.execution_capability,
    provider: r.provider_key,
    ops_owner_id: r.ops_owner_id || null,
    ops_priority: r.ops_priority || "NORMAL",
    paid_at: r.paid_at || null,
    created_at: r.created_date,
    updated_at: r.updated_date,
    closed_at: r.closed_at || null,
    next_action: na,
  };
}

// ---- Dashboard summary (§29) ----
export function dashboardSummary(rows: any[]): any {
  const s = { total_active: 0, action_required: 0, in_review: 0, processing: 0, submitted: 0, approved: 0, rejected: 0, blocked: 0, unassigned: 0, overdue: 0,
    ec: { GUIDANCE_ONLY: 0, INTELLIGENCE_ONLY: 0, PARTIAL_ASSIST: 0, DOCUMENT_ASSIST: 0, APPLICATION_ASSIST: 0, END_TO_END: 0, UNKNOWN: 0 } };
  for (const r of rows) {
    const st = r.case_state || r.state;
    if (!TERMINAL_CASE.includes(st)) s.total_active++;
    if (st === "REVIEW_REQUIRED" || st === "ADDITIONAL_INFORMATION_REQUIRED") s.action_required++;
    if (st === "DOCUMENTS_REVIEW" || st === "ELIGIBILITY_REVIEW") s.in_review++;
    if (st === "PROCESSING") s.processing++;
    if (st === "SUBMITTED") s.submitted++;
    if (st === "APPROVED") s.approved++;
    if (st === "REJECTED") s.rejected++;
    if (st === "REVIEW_REQUIRED") s.blocked++;
    if (!r.ops_owner_id) s.unassigned++;
    const ec = r.execution_capability || "UNKNOWN";
    if (s.ec[ec as keyof typeof s.ec] != null) (s.ec as any)[ec]++;
  }
  return s;
}

export const __adminPresentation = {
  allowedTransitionsFor, isInvalidTransition, adminPermissionsFor, canOverrideExecution,
  deterministicPriorityFor, applyPriorityOverride, slaFor, exceptionsFor, snapshotDiffers,
  qualitySignals, auditFromEvents, redactPassport, redactEmail, redactPhone, reviewGatesFor,
  adminListRow, dashboardSummary,
};