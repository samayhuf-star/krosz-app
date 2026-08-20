// Worldz Visa (Phase 32) — Operations Queue: pure work-management layer.
//
// This module is PURE (no DB, no network, no LLM). It owns the deterministic rules
// that decide WHAT work exists, on which queue, with which priority/SLA/assignment,
// and how task work-state transitions. It never owns application case state — the
// Phase 27/31 Case Engine remains the sole authority (§20). The durable store
// (taskStore.ts) wraps these pure functions with persistence.
//
// §6: tasks are generated from deterministic CaseEvent rules — never by an LLM.
// §7: task creation is idempotent (case_id + source_event_id + task_type).
// §10: priority is deterministic; admin override requires actor+reason+audit.
// §11: SLAs are operational expectations, NOT government visa guarantees.
// §12: assignment is deterministic by task type; no silent arbitrary assignment.
// §29: automation_class is classification only; autonomous execution is disabled.

export type TaskType =
  | "ELIGIBILITY_REVIEW" | "DOCUMENT_REVIEW" | "DOCUMENT_REQUEST" | "CASE_REVIEW"
  | "PAYMENT_REVIEW" | "SUBMISSION_REVIEW" | "PROVIDER_SUBMISSION" | "PROVIDER_STATUS_CHECK"
  | "ADDITIONAL_INFORMATION" | "TRAVELER_CONTACT" | "MANUAL_PROCESSING"
  | "EXCEPTION_HANDLING" | "REFUND_REVIEW" | "COMPLIANCE_REVIEW";

export type TaskQueue =
  | "DOCUMENTS" | "REVIEW" | "SUBMISSION" | "PROVIDER"
  | "ADDITIONAL_INFORMATION" | "PAYMENTS" | "EXCEPTIONS" | "MANUAL_PROCESSING";

export type TaskStatus = "QUEUED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type AutomationClass = "MANUAL" | "ASSISTED" | "AUTOMATABLE" | "AUTOMATED";

export const TASK_TYPES: TaskType[] = [
  "ELIGIBILITY_REVIEW", "DOCUMENT_REVIEW", "DOCUMENT_REQUEST", "CASE_REVIEW",
  "PAYMENT_REVIEW", "SUBMISSION_REVIEW", "PROVIDER_SUBMISSION", "PROVIDER_STATUS_CHECK",
  "ADDITIONAL_INFORMATION", "TRAVELER_CONTACT", "MANUAL_PROCESSING",
  "EXCEPTION_HANDLING", "REFUND_REVIEW", "COMPLIANCE_REVIEW",
];

export const QUEUES: TaskQueue[] = [
  "DOCUMENTS", "REVIEW", "SUBMISSION", "PROVIDER",
  "ADDITIONAL_INFORMATION", "PAYMENTS", "EXCEPTIONS", "MANUAL_PROCESSING",
];

export const TASK_STATUSES: TaskStatus[] = ["QUEUED", "ASSIGNED", "IN_PROGRESS", "WAITING", "BLOCKED", "COMPLETED", "CANCELLED"];
export const PRIORITIES: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

// §9 queue per task type
export const QUEUE_FOR_TYPE: Record<TaskType, TaskQueue> = {
  ELIGIBILITY_REVIEW: "REVIEW", DOCUMENT_REVIEW: "DOCUMENTS", DOCUMENT_REQUEST: "DOCUMENTS",
  CASE_REVIEW: "REVIEW", PAYMENT_REVIEW: "PAYMENTS", SUBMISSION_REVIEW: "SUBMISSION",
  PROVIDER_SUBMISSION: "SUBMISSION", PROVIDER_STATUS_CHECK: "PROVIDER",
  ADDITIONAL_INFORMATION: "ADDITIONAL_INFORMATION", TRAVELER_CONTACT: "DOCUMENTS",
  MANUAL_PROCESSING: "MANUAL_PROCESSING", EXCEPTION_HANDLING: "EXCEPTIONS",
  REFUND_REVIEW: "PAYMENTS", COMPLIANCE_REVIEW: "REVIEW",
};

// §11 operational SLA hours per type (NOT government guarantees)
export const SLA_HOURS_FOR_TYPE: Partial<Record<TaskType, number>> = {
  ELIGIBILITY_REVIEW: 24, DOCUMENT_REVIEW: 24, DOCUMENT_REQUEST: 24, CASE_REVIEW: 48,
  PAYMENT_REVIEW: 24, SUBMISSION_REVIEW: 12, PROVIDER_SUBMISSION: 24, PROVIDER_STATUS_CHECK: 24,
  ADDITIONAL_INFORMATION: 48, TRAVELER_CONTACT: 24, MANUAL_PROCESSING: 72,
  EXCEPTION_HANDLING: 12, REFUND_REVIEW: 48, COMPLIANCE_REVIEW: 72,
};

// §12 deterministic auto-assignment team per type (null = unassigned QUEUED)
export const TEAM_FOR_TYPE: Partial<Record<TaskType, string | null>> = {
  ELIGIBILITY_REVIEW: "REVIEW", DOCUMENT_REVIEW: "DOCUMENTS", DOCUMENT_REQUEST: "DOCUMENTS",
  CASE_REVIEW: "REVIEW", PAYMENT_REVIEW: "PAYMENTS", SUBMISSION_REVIEW: "SUBMISSION",
  PROVIDER_SUBMISSION: "SUBMISSION", PROVIDER_STATUS_CHECK: "PROVIDER",
  ADDITIONAL_INFORMATION: "ADDITIONAL_INFORMATION", EXCEPTION_HANDLING: "OPERATIONS",
  REFUND_REVIEW: "PAYMENTS", COMPLIANCE_REVIEW: "REVIEW", MANUAL_PROCESSING: "OPERATIONS",
  TRAVELER_CONTACT: "DOCUMENTS",
};

// §21 required resolution decisions per type (null = generic "DONE"/"RESOLVED" allowed)
export const REQUIRED_RESOLUTIONS: Partial<Record<TaskType, string[] | null>> = {
  ELIGIBILITY_REVIEW: ["APPROVED", "REJECTED"],
  DOCUMENT_REVIEW: ["APPROVED", "REJECTED", "REQUEST_REPLACEMENT"],
  DOCUMENT_REQUEST: ["SENT", "RESOLVED"],
  CASE_REVIEW: ["APPROVED", "REJECTED", "REQUEST_CHANGES"],
  PAYMENT_REVIEW: ["VERIFIED", "FAILED", "REFUNDED"],
  SUBMISSION_REVIEW: ["APPROVED", "REJECTED", "REQUEST_CHANGES"],
  PROVIDER_SUBMISSION: ["SUBMITTED", "FAILED"],
  PROVIDER_STATUS_CHECK: ["REFRESHED", "NO_CHANGE", "EXCEPTION_CREATED"],
  ADDITIONAL_INFORMATION: ["SENT", "RECEIVED"],
  TRAVELER_CONTACT: ["CONTACTED", "NO_RESPONSE"],
  EXCEPTION_HANDLING: ["RESOLVED", "ESCALATED", "DISMISSED"],
  REFUND_REVIEW: ["APPROVED", "REJECTED"],
  COMPLIANCE_REVIEW: ["APPROVED", "REJECTED"],
  MANUAL_PROCESSING: null,
};

// §19 task actions per type (UI action codes)
export const ACTIONS_FOR_TYPE: Record<TaskType, string[]> = {
  ELIGIBILITY_REVIEW: ["APPROVE", "REJECT"],
  DOCUMENT_REVIEW: ["APPROVE", "REJECT", "REQUEST_REPLACEMENT"],
  DOCUMENT_REQUEST: ["SEND", "MARK_RESOLVED"],
  CASE_REVIEW: ["APPROVE", "REJECT", "REQUEST_CHANGES"],
  PAYMENT_REVIEW: ["VERIFY", "MARK_FAILED", "MARK_REFUNDED"],
  SUBMISSION_REVIEW: ["APPROVE", "REJECT", "REQUEST_CHANGES"],
  PROVIDER_SUBMISSION: ["MARK_SUBMITTED", "MARK_FAILED"],
  PROVIDER_STATUS_CHECK: ["REFRESH", "OPEN_PROVIDER", "CREATE_EXCEPTION"],
  ADDITIONAL_INFORMATION: ["SEND", "MARK_RECEIVED"],
  TRAVELER_CONTACT: ["MARK_CONTACTED", "MARK_NO_RESPONSE"],
  MANUAL_PROCESSING: ["MARK_DONE"],
  EXCEPTION_HANDLING: ["INVESTIGATE", "ASSIGN", "RESOLVE", "ESCALATE"],
  REFUND_REVIEW: ["APPROVE", "REJECT"],
  COMPLIANCE_REVIEW: ["APPROVE", "REJECT"],
};

// §4 work-state transition graph
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  QUEUED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "QUEUED", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "BLOCKED", "COMPLETED", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "QUEUED", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "QUEUED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export const TERMINAL_TASK: TaskStatus[] = ["COMPLETED", "CANCELLED"];

export function canTransitionTask(from: TaskStatus | string, to: TaskStatus | string): boolean {
  return (TASK_TRANSITIONS[from as TaskStatus] || []).includes(to as TaskStatus);
}

export const TITLE_FOR_TYPE: Record<TaskType, string> = {
  ELIGIBILITY_REVIEW: "Review eligibility",
  DOCUMENT_REVIEW: "Review documents",
  DOCUMENT_REQUEST: "Request document",
  CASE_REVIEW: "Review case",
  PAYMENT_REVIEW: "Review payment",
  SUBMISSION_REVIEW: "Review submission",
  PROVIDER_SUBMISSION: "Provider submission",
  PROVIDER_STATUS_CHECK: "Check provider status",
  ADDITIONAL_INFORMATION: "Send additional information request",
  TRAVELER_CONTACT: "Contact traveler",
  MANUAL_PROCESSING: "Manual processing",
  EXCEPTION_HANDLING: "Handle exception",
  REFUND_REVIEW: "Review refund",
  COMPLIANCE_REVIEW: "Compliance review",
};

// §6/§8 deterministic rule resolver: CaseEvent + case -> tasks to create.
export interface ResolvedTask { task_type: TaskType; queue: TaskQueue; source_rule: string; }
export function resolveTasksForEvent(event: any, app: any): ResolvedTask[] {
  const ns: string | undefined = event?.new_case_state;
  const ec: string = (app?.execution_capability as string) || (app?.case_snapshot?.execution_capability as string) || "GUIDANCE_ONLY";
  const out: ResolvedTask[] = [];
  if (ns === "ELIGIBILITY_REVIEW") out.push({ task_type: "ELIGIBILITY_REVIEW", queue: "REVIEW", source_rule: "state:ELIGIBILITY_REVIEW" });
  if (ns === "DOCUMENTS_REVIEW") out.push({ task_type: "DOCUMENT_REVIEW", queue: "DOCUMENTS", source_rule: "state:DOCUMENTS_REVIEW" });
  if (ns === "ADDITIONAL_INFORMATION_REQUIRED") out.push({ task_type: "ADDITIONAL_INFORMATION", queue: "ADDITIONAL_INFORMATION", source_rule: "state:ADDITIONAL_INFORMATION_REQUIRED" });
  if (ns === "REVIEW_REQUIRED") out.push({ task_type: "CASE_REVIEW", queue: "REVIEW", source_rule: "state:REVIEW_REQUIRED" });
  if (ns === "READY_FOR_SUBMISSION" && (ec === "PARTIAL_ASSIST" || ec === "APPLICATION_ASSIST")) out.push({ task_type: "SUBMISSION_REVIEW", queue: "SUBMISSION", source_rule: "state:READY_FOR_SUBMISSION:human_review" });
  if (ns === "SUBMISSION_PENDING" && ec === "END_TO_END") out.push({ task_type: "PROVIDER_SUBMISSION", queue: "SUBMISSION", source_rule: "state:SUBMISSION_PENDING:end_to_end" });
  if (ns === "SUBMITTED") out.push({ task_type: "PROVIDER_STATUS_CHECK", queue: "PROVIDER", source_rule: "state:SUBMITTED" });
  return out;
}

// §7 deterministic idempotency key
export function taskKey(caseId: string, sourceEventId: string | null | undefined, taskType: TaskType | string): string {
  return `task:${caseId}:${sourceEventId || "nosrc"}:${taskType}`;
}

// §10 deterministic priority (no AI). Inputs: travel date proximity, SLA risk, exception severity, task age.
export function deterministicTaskPriority(task: any, app: any, ctx: { now?: string; exception_severity?: string } = {}): Priority {
  if (TERMINAL_TASK.includes(task?.status as TaskStatus)) return "LOW";
  const now = ctx?.now ? new Date(ctx.now) : new Date();
  let urgent = false, high = false;
  const travel: string | undefined = app?.travel_start || app?.case_snapshot?.travel?.start || (app?.case_snapshot?.travel || null);
  if (travel) {
    const days = Math.ceil((new Date(travel).getTime() - now.getTime()) / 86400000);
    if (days >= 0 && days <= 7) urgent = true;
    else if (days >= 0 && days <= 14) high = true;
  }
  if (task?.due_at && new Date(task.due_at) < now) high = true; // overdue
  const sev = ctx?.exception_severity;
  if (sev === "CRITICAL") urgent = true;
  else if (sev === "HIGH") high = true;
  // Task age beyond SLA window raises priority.
  const slaHours = SLA_HOURS_FOR_TYPE[task?.task_type as TaskType];
  if (slaHours && task?.created_at) {
    const ageH = (now.getTime() - new Date(task.created_at).getTime()) / 3600000;
    if (ageH > slaHours * 1.5) high = true;
  }
  if (urgent) return "URGENT";
  if (high) return "HIGH";
  return "NORMAL";
}

// §10 admin override: requires actor + reason; cannot lower URGENT.
export function applyTaskPriorityOverride(current: Priority | string, requested: Priority | string, reason: string | null | undefined, actor: string | null | undefined): { overridden: boolean; priority: Priority | string; record: { actor: string; reason: string; at: string } | null } {
  if (requested === current) return { overridden: false, priority: current, record: null };
  if (!reason || !actor) return { overridden: false, priority: current, record: null };
  if (current === "URGENT" && requested !== "URGENT") return { overridden: false, priority: "URGENT", record: null };
  return { overridden: true, priority: requested, record: { actor, reason, at: new Date().toISOString() } };
}

// §11 operational SLA (NOT a government guarantee)
export function slaForTaskType(type: TaskType | string): { hours: number | null; label: string } {
  const hours = SLA_HOURS_FOR_TYPE[type as TaskType] ?? null;
  return { hours, label: hours ? `Operational SLA: ${hours}h` : "Operational SLA: not configured" };
}
export function computeDueAt(task: any, now?: string): string | null {
  const sla = slaForTaskType(task?.task_type);
  if (!sla.hours) return task?.due_at || null;
  const base = now ? new Date(now) : new Date();
  return new Date(base.getTime() + sla.hours * 3600000).toISOString();
}
export function isOverdue(task: any, now?: string): boolean {
  if (TERMINAL_TASK.includes(task?.status as TaskStatus)) return false;
  if (!task?.due_at) return false;
  return new Date(task.due_at) < (now ? new Date(now) : new Date());
}
export function slaRisk(task: any, now?: string): "LOW" | "MEDIUM" | "HIGH" {
  if (TERMINAL_TASK.includes(task?.status as TaskStatus)) return "LOW";
  if (!task?.due_at) return "LOW";
  const slaH = slaForTaskType(task.task_type).hours || 24;
  const remainingH = (new Date(task.due_at).getTime() - (now ? new Date(now).getTime() : Date.now())) / 3600000;
  if (remainingH < 0) return "HIGH";
  if (remainingH < slaH * 0.25) return "HIGH";
  if (remainingH < slaH * 0.5) return "MEDIUM";
  return "LOW";
}

// §21 resolution gating
export function resolutionRequired(type: TaskType | string): boolean {
  return REQUIRED_RESOLUTIONS[type as TaskType] != null;
}
export function canResolve(type: TaskType | string, decision: string): boolean {
  const allowed = REQUIRED_RESOLUTIONS[type as TaskType];
  if (allowed == null) return decision === "DONE" || decision === "RESOLVED";
  return allowed.includes(decision);
}

// §36 permissions
export function opsPermissions(role: string | null | undefined): {
  can_list: boolean; can_view: boolean; can_claim: boolean; can_assign: boolean;
  can_reassign: boolean; can_release: boolean; can_act: boolean;
  can_override_priority: boolean; can_bulk: boolean; can_export: boolean;
} {
  const ok = role === "admin";
  return { can_list: ok, can_view: ok, can_claim: ok, can_assign: ok, can_reassign: ok, can_release: ok, can_act: ok, can_override_priority: ok, can_bulk: ok, can_export: ok };
}
export function canAccessTask(_task: any, user: { id: string; role?: string } | null | undefined): boolean {
  return !!user && user.role === "admin"; // travelers never access ops tasks
}

// §18 case-context projection (read-only, from the case — never a second SOT)
export function projectCaseContext(task: any, app: any): any {
  if (!app) return null;
  const snap = app.case_snapshot || {};
  const travelerNext = app.case_state ? `${app.case_state}` : null;
  return {
    case_id: app.id,
    destination: app.destination || snap.country || null,
    journey: app.visa_type_key || snap.journey || null,
    nationality: app.nationality || snap.nationality || null,
    travel_date: app.travel_start || snap.travel?.start || null,
    case_state: app.case_state || null,
    normalized_status: app.normalized_status || app.case_state || null,
    execution_capability: app.execution_capability || snap.execution_capability || null,
    provider_key: app.provider_key || null,
    provider_snapshot: (app.metadata || {}).provider_snapshot || null,
    paid_at: app.paid_at || null,
    case_snapshot_version: app.data_version || null,
    traveler_next_action: travelerNext,
  };
}

// §26 exception mapping from a case event / signal
export function mapExceptionFromEvent(event: any): { type: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; message: string } | null {
  const et = event?.event_type || "";
  const meta = event?.metadata || {};
  if (et === "PROVIDER_WEBHOOK" && meta.normalized === "ADDITIONAL_INFORMATION_REQUIRED") return { type: "status_mismatch", severity: "MEDIUM", message: "Provider requests additional information" };
  if (et === "STATUS_CHANGED" && meta.raw && /fail|error|unable/i.test(String(meta.raw))) return { type: "webhook_failure", severity: "HIGH", message: `Provider status failure: ${meta.raw}` };
  if (et === "SUBMISSION_REQUESTED") return null;
  if (meta.normalized === "REJECTED" || meta.normalized === "CANCELLED") return null; // decisions are not exceptions
  return null;
}

// §37 export row (no PII, no secrets/tokens/document content)
export function exportTaskRow(task: any): any {
  return {
    id: task.id, case_id: task.case_id, task_type: task.task_type, queue: task.queue,
    priority: task.priority, status: task.status, assigned_to: task.assigned_to || null,
    assigned_team: task.assigned_team || null, destination: task.destination || null,
    journey_type: task.journey_type || null, provider_key: task.provider_key || null,
    due_at: task.due_at || null, created_at: task.created_at || task.created_date || null,
    completed_at: task.completed_at || null, resolution_decision: task.resolution?.decision || null,
    sla_overdue: isOverdue(task), source_rule: task.source_rule || null,
  };
}

// §32 allowed bulk actions (no case-state transitions)
export const BULK_ACTIONS = ["ASSIGN", "PRIORITY", "MOVE_QUEUE", "MARK_WAITING"] as const;
export function isBulkAllowed(action: string): boolean {
  return (BULK_ACTIONS as readonly string[]).includes(action);
}

// §29 automation classification (Phase 32: classification only — never activated)
export function automationClassFor(type: TaskType | string, app: any): AutomationClass {
  const ec = (app?.execution_capability as string) || (app?.case_snapshot?.execution_capability as string) || "GUIDANCE_ONLY";
  if (type === "PROVIDER_STATUS_CHECK" || type === "PROVIDER_SUBMISSION") return ec === "END_TO_END" ? "AUTOMATABLE" : "MANUAL";
  if (type === "DOCUMENT_REVIEW" || type === "CASE_REVIEW" || type === "SUBMISSION_REVIEW" || type === "ELIGIBILITY_REVIEW") return "ASSISTED";
  if (type === "EXCEPTION_HANDLING" || type === "MANUAL_PROCESSING" || type === "TRAVELER_CONTACT") return "MANUAL";
  return "MANUAL";
}

// §20 task action -> case-engine transition target (+ resolution decision).
// A null target means the action does NOT advance case state; the task is just resolved.
export interface TaskActionPlan { case_target: any | null; decision: string; create_exception?: { type: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; message: string } | null; }
export function planTaskAction(taskType: TaskType | string, actionCode: string): TaskActionPlan | null {
  const map: Record<string, TaskActionPlan> = {
    "ELIGIBILITY_REVIEW.APPROVE": { case_target: "DOCUMENTS_REQUIRED", decision: "APPROVED" },
    "ELIGIBILITY_REVIEW.REJECT": { case_target: "REJECTED", decision: "REJECTED" },
    "DOCUMENT_REVIEW.APPROVE": { case_target: "READY_FOR_SUBMISSION", decision: "APPROVED" },
    "DOCUMENT_REVIEW.REJECT": { case_target: "DOCUMENTS_REQUIRED", decision: "REJECTED" },
    "DOCUMENT_REVIEW.REQUEST_REPLACEMENT": { case_target: "DOCUMENTS_REQUIRED", decision: "REQUEST_REPLACEMENT" },
    "CASE_REVIEW.APPROVE": { case_target: "READY_FOR_SUBMISSION", decision: "APPROVED" },
    "CASE_REVIEW.REJECT": { case_target: "DOCUMENTS_REQUIRED", decision: "REJECTED" },
    "CASE_REVIEW.REQUEST_CHANGES": { case_target: "DOCUMENTS_REQUIRED", decision: "REQUEST_CHANGES" },
    "SUBMISSION_REVIEW.APPROVE": { case_target: "SUBMISSION_PENDING", decision: "APPROVED" },
    "SUBMISSION_REVIEW.REJECT": { case_target: "DOCUMENTS_REVIEW", decision: "REJECTED" },
    "SUBMISSION_REVIEW.REQUEST_CHANGES": { case_target: "DOCUMENTS_REQUIRED", decision: "REQUEST_CHANGES" },
    "PROVIDER_SUBMISSION.MARK_SUBMITTED": { case_target: "SUBMITTED", decision: "SUBMITTED" },
    "PROVIDER_SUBMISSION.MARK_FAILED": { case_target: null, decision: "FAILED", create_exception: { type: "submission_failure", severity: "HIGH", message: "Provider submission failed" } },
    "PROVIDER_STATUS_CHECK.REFRESH": { case_target: null, decision: "REFRESHED" },
    "PROVIDER_STATUS_CHECK.OPEN_PROVIDER": { case_target: null, decision: "NO_CHANGE" },
    "PROVIDER_STATUS_CHECK.CREATE_EXCEPTION": { case_target: null, decision: "EXCEPTION_CREATED", create_exception: { type: "status_mismatch", severity: "MEDIUM", message: "Status check flagged an exception" } },
    "ADDITIONAL_INFORMATION.SEND": { case_target: null, decision: "SENT" },
    "ADDITIONAL_INFORMATION.MARK_RECEIVED": { case_target: "DOCUMENTS_REQUIRED", decision: "RECEIVED" },
    "PAYMENT_REVIEW.VERIFY": { case_target: null, decision: "VERIFIED" },
    "PAYMENT_REVIEW.MARK_FAILED": { case_target: null, decision: "FAILED", create_exception: { type: "payment_failure", severity: "HIGH", message: "Payment failed" } },
    "PAYMENT_REVIEW.MARK_REFUNDED": { case_target: null, decision: "REFUNDED" },
    "REFUND_REVIEW.APPROVE": { case_target: null, decision: "APPROVED" },
    "REFUND_REVIEW.REJECT": { case_target: null, decision: "REJECTED" },
    "COMPLIANCE_REVIEW.APPROVE": { case_target: null, decision: "APPROVED" },
    "COMPLIANCE_REVIEW.REJECT": { case_target: null, decision: "REJECTED" },
    "TRAVELER_CONTACT.MARK_CONTACTED": { case_target: null, decision: "CONTACTED" },
    "TRAVELER_CONTACT.MARK_NO_RESPONSE": { case_target: null, decision: "NO_RESPONSE" },
    "DOCUMENT_REQUEST.SEND": { case_target: null, decision: "SENT" },
    "DOCUMENT_REQUEST.MARK_RESOLVED": { case_target: null, decision: "RESOLVED" },
    "MANUAL_PROCESSING.MARK_DONE": { case_target: null, decision: "DONE" },
    "EXCEPTION_HANDLING.INVESTIGATE": { case_target: null, decision: "RESOLVED" },
    "EXCEPTION_HANDLING.RESOLVE": { case_target: null, decision: "RESOLVED" },
    "EXCEPTION_HANDLING.ESCALATE": { case_target: null, decision: "ESCALATED", create_exception: { type: "manual_intervention_required", severity: "HIGH", message: "Exception escalated" } },
  };
  return map[`${taskType}.${actionCode}`] || null;
}