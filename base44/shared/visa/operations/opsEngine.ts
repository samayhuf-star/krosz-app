// Krosz Phase 3 — Customer Operations Engine (deterministic).
//
// A NON-MUTATING projection layer. It reads the authoritative existing entities
// (VisaApplication, OperationsCase, Order, Payment, Refund, ApplicationAction,
// ApplicationTimelineEvent, PostPaymentReview) and derives, per application:
//   - one normalized operational stage (§1)
//   - the next action + action owner (§2)
//   - SLA state + time remaining (§5/§6)
//   - stuck flags + root-cause category (§18)
//   - payment reconciliation mismatches (§19)
//
// It NEVER mutates authoritative state and NEVER calls an LLM. Stage/next-action/
// SLA/stuck/reconciliation are 100% deterministic so credit is never burned on a
// status check (§34). AI is only used for customer-language generation elsewhere.

import { sumMinor } from "../payments/money.ts";

// ---------- §1 Normalized stage ----------
export type NormalizedStage =
  | "DRAFT" | "PROFILE_INCOMPLETE" | "DOCUMENTS_REQUIRED" | "DOCUMENTS_UPLOADED"
  | "AUTOMATED_CHECKS_RUNNING" | "ACTION_REQUIRED" | "READY_FOR_PAYMENT"
  | "PAYMENT_PENDING" | "PAID" | "HUMAN_REVIEW" | "READY_FOR_SUBMISSION"
  | "SUBMISSION_IN_PROGRESS" | "SUBMITTED" | "GOVERNMENT_PROCESSING"
  | "ADDITIONAL_INFORMATION_REQUIRED" | "APPROVED" | "REJECTED" | "CANCELLED"
  | "REFUND_REVIEW" | "REFUNDED";

export type ActionOwner =
  | "CUSTOMER" | "KROSZ_AUTOMATION" | "KROSZ_REVIEWER" | "KROSZ_SUPPORT"
  | "EXTERNAL_PROVIDER" | "GOVERNMENT" | "SYSTEM";

export type SlaState = "HEALTHY" | "DUE_SOON" | "OVERDUE" | "CRITICAL" | "N/A";

// Default SLA target hours per stage. Overridable by a SlaConfig entity row
// matching the stage key. NEVER promised to customers (§5).
const DEFAULT_SLA_HOURS: Record<string, number> = {
  PROFILE_INCOMPLETE: 72,
  DOCUMENTS_REQUIRED: 48,
  ACTION_REQUIRED: 24,
  PAYMENT_PENDING: 24,
  HUMAN_REVIEW: 24,
  READY_FOR_SUBMISSION: 8,
  SUBMISSION_IN_PROGRESS: 8,
  GOVERNMENT_PROCESSING: 240,
  ADDITIONAL_INFORMATION_REQUIRED: 48,
  REFUND_REVIEW: 72,
};

const ESCALATION_THRESHOLDS = { warning: 0.8, overdue: 1.0, critical_escalate: 1.25, critical: 1.5 };

function nowMs(): number { return Date.now(); }
function hoursBetween(a: string | null | undefined, b: number): number {
  if (!a) return 0;
  const t = new Date(a).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (b - t) / 3_600_000);
}

function openCustomerActions(actions: any[]): any[] {
  return (actions || []).filter((a) => a.status === "OPEN" && a.type !== "HUMAN_HANDOFF");
}
function openHandoff(actions: any[]): any[] {
  return (actions || []).filter((a) => a.status === "OPEN" && a.type === "HUMAN_HANDOFF");
}
function lastEvent(timeline: any[]): any | null {
  if (!timeline?.length) return null;
  return [...timeline].sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")))[0];
}

// ---------- §1/§2 core projection ----------
export function projectApplication(input: {
  app: any;
  opsCase?: any | null;
  order?: any | null;
  payments?: any[];
  refunds?: any[];
  actions?: any[];
  timeline?: any[];
  postPayReview?: any | null;
  slaConfig?: Record<string, number>;
}): {
  stage: NormalizedStage;
  stageLabel: string;
  nextAction: string;
  actionOwner: ActionOwner;
  blocked: boolean;
  lastUpdate: string | null;
  paymentStatus: string;
  refundActive: boolean;
  sla: { state: SlaState; targetHours: number; ageHours: number; remainingHours: number; pct: number };
  stuck: { flag: boolean; reasons: string[] };
  progressPct: number;
} {
  const { app, opsCase, order, payments = [], refunds = [], actions = [], timeline = [], postPayReview, slaConfig = {} } = input;
  const payment = (payments.find((p) => p.status === "SUCCEEDED") || payments.find((p) => ["CREATED", "PENDING", "AUTHORIZED"].includes(p.status)) || null);

  // Decision / terminal — refunds win if a refund is mid-flight.
  const activeRefund = (refunds || []).find((r) => ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"].includes(r.status));
  if (activeRefund) {
    return finalize("REFUND_REVIEW", "Refund under review", "Krosz is reviewing the refund request.", "KROSZ_SUPPORT", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }
  if (opsCase?.decision === "APPROVED" || app?.case_state === "APPROVED" || app?.status === "approved")
    return finalize("APPROVED", "Visa approved", "No action required from you.", "GOVERNMENT", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  if (opsCase?.decision === "REFUSED" || app?.case_state === "REJECTED" || app?.status === "refused")
    return finalize("REJECTED", "Visa refused", "No action required from you.", "GOVERNMENT", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  if (app?.status === "cancelled" || opsCase?.state === "CANCELLED")
    return finalize("CANCELLED", "Application cancelled", "No action required from you.", "SYSTEM", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  if ((refunds || []).some((r) => r.status === "COMPLETED"))
    return finalize("REFUNDED", "Refund completed", "No action required from you.", "SYSTEM", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  const cust = openCustomerActions(actions);
  const handoff = openHandoff(actions);

  // Additional information requested (open customer action or ops REQUEST_INFO).
  if (opsCase?.state === "DECISION_RECEIVED" && opsCase?.decision_needs_review)
    return finalize("HUMAN_REVIEW", "Decision needs review", "Krosz is reviewing an ambiguous decision from the government.", "KROSZ_REVIEWER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (opsCase?.state === "PROCESSING" || app?.case_state === "PROCESSING" || app?.status === "government_processing")
    return finalize("GOVERNMENT_PROCESSING", "Government processing", "Waiting for the government to process the application.", "GOVERNMENT", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (opsCase?.state === "SUBMITTED" || opsCase?.state === "SUBMISSION_CONFIRMED" || app?.case_state === "SUBMITTED" || app?.status === "submitted")
    return finalize("SUBMITTED", "Application submitted", "Krosz has submitted the application. Waiting for the government.", "GOVERNMENT", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (opsCase?.state === "SUBMISSION_IN_PROGRESS")
    return finalize("SUBMISSION_IN_PROGRESS", "Submission in progress", "Krosz is submitting the application.", "EXTERNAL_PROVIDER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (handoff.length) {
    return finalize("ACTION_REQUIRED", handoff[0].title || "Krosz needs more information", handoff[0].description || "Please follow the instructions we sent you.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }

  // Ready for / post-payment human review gate (the Phase 3 acceptance test).
  if (order && payment?.status === "SUCCEEDED" && order.status === "PAID") {
    const reviewPending = !postPayReview || !["APPROVED_FOR_SUBMISSION"].includes(postPayReview.status);
    if (reviewPending) {
      return finalize("HUMAN_REVIEW", "Post-payment review", "Krosz is reviewing your application before submission. No action required from you right now.", "KROSZ_REVIEWER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
    }
    if (opsCase?.state === "READY_TO_SUBMIT")
      return finalize("READY_FOR_SUBMISSION", "Ready for submission", "Your application is approved for submission. Krosz will submit it shortly.", "KROSZ_AUTOMATION", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
    // Paid but case hasn't advanced to review — still HUMAN_REVIEW ops-wise.
    return finalize("HUMAN_REVIEW", "Application under review", "Krosz is reviewing your application. No action required from you right now.", "KROSZ_REVIEWER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }

  if (cust.length) {
    // Customer-wise missing document / info.
    return finalize("ACTION_REQUIRED", cust[0].title || "Action required", cust[0].description || "Please complete the requested step.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }

  if (app?.case_state === "ADDITIONAL_INFORMATION_REQUIRED" || app?.status === "additional_documents")
    return finalize("ADDITIONAL_INFORMATION_REQUIRED", "Additional information required", "Please provide the requested information to continue.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  // Payment stage.
  if (order && order.status === "PENDING_PAYMENT") {
    if (payment && ["CREATED", "PENDING", "AUTHORIZED"].includes(payment.status))
      return finalize("PAYMENT_PENDING", "Payment pending", "Your payment is being confirmed. No action is needed right now.", "KROSZ_AUTOMATION", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
    return finalize("READY_FOR_PAYMENT", "Complete your payment", "Please complete payment to continue.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }
  if (order && order.status === "FAILED")
    return finalize("PAYMENT_PENDING", "Payment failed", "Your last payment attempt failed. Please try again.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  // Documents.
  if (opsCase?.state === "DOCUMENTS_REVIEW" || app?.case_state === "DOCUMENTS_REVIEW" || app?.status === "document_review")
    return finalize("DOCUMENTS_UPLOADED", "Documents received", "Krosz is reviewing your documents. No action required from you right now.", "KROSZ_REVIEWER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (opsCase?.state === "READY_FOR_REVIEW" || opsCase?.state === "UNDER_REVIEW")
    return finalize("HUMAN_REVIEW", "Application under review", "Krosz is reviewing your application. No action required from you right now.", "KROSZ_REVIEWER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  if (app?.case_state === "DOCUMENTS_REQUIRED" || app?.status === "documents_pending")
    return finalize("DOCUMENTS_REQUIRED", "Upload your documents", "Please upload the required documents to continue.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  // Intake / profile.
  if (!app?.case_state || app?.case_state === "DRAFT" || app?.status === "draft") {
    if (!app?.traveler_id) return finalize("PROFILE_INCOMPLETE", "Complete your profile", "Add your traveler details to continue.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
    return finalize("DRAFT", "Start your application", "Tell us where you'd like to go and we'll find your visa route.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
  }
  if (app?.case_state === "INTAKE" || app?.case_state === "ELIGIBILITY_REVIEW")
    return finalize("AUTOMATED_CHECKS_RUNNING", "Checking eligibility", "We're confirming your visa route. No action required from you right now.", "KROSZ_AUTOMATION", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);

  return finalize("DRAFT", "Application in progress", "Continue your application.", "CUSTOMER", order, opsCase, postPayReview, actions, timeline, slaConfig, app, payment, refunds);
}

const STAGE_PROGRESS: Record<NormalizedStage, number> = {
  DRAFT: 5, PROFILE_INCOMPLETE: 10, DOCUMENTS_REQUIRED: 25, DOCUMENTS_UPLOADED: 40,
  AUTOMATED_CHECKS_RUNNING: 20, ACTION_REQUIRED: 30, READY_FOR_PAYMENT: 45, PAYMENT_PENDING: 50,
  PAID: 55, HUMAN_REVIEW: 65, READY_FOR_SUBMISSION: 75, SUBMISSION_IN_PROGRESS: 80,
  SUBMITTED: 85, GOVERNMENT_PROCESSING: 92, ADDITIONAL_INFORMATION_REQUIRED: 35,
  APPROVED: 100, REJECTED: 100, CANCELLED: 100, REFUND_REVIEW: 60, REFUNDED: 100,
};

const STAGE_LABEL: Record<NormalizedStage, string> = {
  DRAFT: "Draft", PROFILE_INCOMPLETE: "Profile incomplete", DOCUMENTS_REQUIRED: "Documents required",
  DOCUMENTS_UPLOADED: "Documents received", AUTOMATED_CHECKS_RUNNING: "Automated checks",
  ACTION_REQUIRED: "Action required", READY_FOR_PAYMENT: "Payment required",
  PAYMENT_PENDING: "Payment pending", PAID: "Paid", HUMAN_REVIEW: "Krosz review",
  READY_FOR_SUBMISSION: "Ready for submission", SUBMISSION_IN_PROGRESS: "Submission in progress",
  SUBMITTED: "Submitted", GOVERNMENT_PROCESSING: "Government processing",
  ADDITIONAL_INFORMATION_REQUIRED: "Additional information required", APPROVED: "Approved",
  REJECTED: "Refused", CANCELLED: "Cancelled", REFUND_REVIEW: "Refund under review", REFUNDED: "Refunded",
};

function finalize(stage: NormalizedStage, nextAction: string, _customerBlurb: string, owner: ActionOwner, order: any, opsCase: any, postPayReview: any, actions: any[], timeline: any[], slaConfig: Record<string, number>, app: any, payment: any, refunds: any[]): any {
  const targetHours = slaConfig[stage] ?? DEFAULT_SLA_HOURS[stage] ?? 0;
  const anchor = opsCase?.state_changed_at || app?.updated_date || app?.created_date;
  const ageHours = anchor ? hoursBetween(anchor, nowMs()) : 0;
  const pct = targetHours ? ageHours / targetHours : 0;
  let slaState: SlaState = "N/A";
  if (targetHours) {
    if (pct >= ESCALATION_THRESHOLDS.critical) slaState = "CRITICAL";
    else if (pct >= ESCALATION_THRESHOLDS.overdue) slaState = "OVERDUE";
    else if (pct >= ESCALATION_THRESHOLDS.warning) slaState = "DUE_SOON";
    else slaState = "HEALTHY";
  }
  const stuck = detectStuck({ app, opsCase, order, payment, postPayReview, actions, timeline, refunds, ageHours, slaPct: pct });
  return {
    stage, stageLabel: STAGE_LABEL[stage] || stage, nextAction, actionOwner: owner,
    blocked: stuck.flag || !!openCustomerActions(actions).length,
    lastUpdate: lastEvent(timeline)?.occurred_at || anchor || app?.updated_date || app?.created_date || null,
    paymentStatus: payment?.status || order?.status || (app?.metadata?.payment_status) || "NONE",
    refundActive: (refunds || []).some((r) => ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"].includes(r.status)),
    sla: { state: slaState, targetHours, ageHours, remainingHours: targetHours ? Math.max(0, targetHours - ageHours) : 0, pct: Math.round(pct * 100) },
    stuck: { flag: stuck.flag, reasons: stuck.reasons },
    progressPct: STAGE_PROGRESS[stage] ?? 0,
  };
}

// ---------- §18 Stuck detector (deterministic) ----------
function detectStuck(ctx: {
  app: any; opsCase?: any; order?: any; payment?: any; postPayReview?: any;
  actions: any[]; timeline: any[]; refunds: any[]; ageHours: number; slaPct: number;
}): { flag: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { app, opsCase, order, payment, postPayReview, refunds, slaPct } = ctx;
  // Payment succeeded but case never advanced past review.
  if (payment?.status === "SUCCEEDED" && order?.status === "PAID") {
    const inReview = opsCase && ["PREPARING", "READY_FOR_REVIEW", "UNDER_REVIEW"].includes(opsCase.state);
    const noApprove = !postPayReview || !["APPROVED_FOR_SUBMISSION"].includes(postPayReview.status);
    if (inReview && noApprove && slaPct >= 1)
      reasons.push("PAID_BUT_NOT_ADVANCED");
  }
  // Ready for submission sitting too long.
  if (opsCase?.state === "READY_TO_SUBMIT" && slaPct >= 1) reasons.push("SUBMISSION_QUEUE_STUCK");
  // Submission in progress beyond SLA.
  if (opsCase?.state === "SUBMISSION_IN_PROGRESS" && slaPct >= 1) reasons.push("SUBMISSION_STUCK");
  // Refund approved but not processing beyond SLA.
  const r = (refunds || []).find((x) => x.status === "APPROVED");
  if (r && slaPct >= 1 && opsCase?.state) reasons.push("REFUND_APPROVED_NOT_PROCESSED");
  // No meaningful state change beyond 1.5× SLA window.
  if (slaPct >= ESCALATION_THRESHOLDS.critical && opsCase && !["COMPLETED", "CANCELLED", "DECISION_RECEIVED"].includes(opsCase.state) && !ctx.timeline.some((e: any) => e.event_type === "VISA_APPROVED" || e.event_type === "VISA_REFUSED"))
    reasons.push("NO_MEANINGFUL_STATE_CHANGE");
  return { flag: reasons.length > 0, reasons: Array.from(new Set(reasons)) };
}

// ---------- §19 Payment reconciliation (deterministic) ----------
export type ReconcileMismatch = {
  type: "PAID_BUT_APPLICATION_UNPAID" | "APPLICATION_PAID_BUT_PAYMENT_MISSING" | "DUPLICATE_PAYMENT" | "PAYMENT_AMOUNT_MISMATCH" | "PAYMENT_WORKFLOW_FAILED" | "PAID_BUT_NO_REVIEW_ACTION" | "REFUND_MISMATCH";
  application_id: string; order_id?: string; payment_id?: string; refund_id?: string;
  detail: string; severity: "CRITICAL" | "HIGH";
};

export function reconcileApplication(input: { app: any; order?: any; payments?: any[]; refunds?: any[]; opsCase?: any; postPayReview?: any; actions?: any[] }): ReconcileMismatch[] {
  const { app, order, payments = [], refunds = [], opsCase, postPayReview, actions = [] } = input;
  const out: ReconcileMismatch[] = [];
  const succeeded = payments.filter((p) => p.status === "SUCCEEDED");
  if (succeeded.length > 1) out.push({ type: "DUPLICATE_PAYMENT", application_id: app?.id, payment_id: succeeded[1].id, detail: `${succeeded.length} succeeded payments on one order`, severity: "CRITICAL" });
  if (order?.status === "PAID" && !succeeded.length) out.push({ type: "APPLICATION_PAID_BUT_PAYMENT_MISSING", application_id: app?.id, order_id: order?.id, detail: "Order marked PAID with no succeeded payment record", severity: "CRITICAL" });
  if (succeeded.length && order && order.status !== "PAID" && order.status !== "COMPLETED" && !["REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(order.status))
    out.push({ type: "PAYMENT_WORKFLOW_FAILED", application_id: app?.id, order_id: order?.id, payment_id: succeeded[0].id, detail: `Payment succeeded but order is ${order.status}`, severity: "CRITICAL" });
  if (succeeded.length && order && succeeded[0].amount_minor != null && order.total_minor != null && succeeded[0].amount_minor !== order.total_minor)
    out.push({ type: "PAYMENT_AMOUNT_MISMATCH", application_id: app?.id, order_id: order?.id, payment_id: succeeded[0].id, detail: `paid ${succeeded[0].amount_minor} vs order ${order.total_minor}`, severity: "HIGH" });
  // Paid but no review/action generated.
  if (order?.status === "PAID" && succeeded.length) {
    const reviewMissing = !postPayReview || ["NOT_DOABLE_PENDING_CEO", "REJECTED"].includes(postPayReview.status);
    const noOpCase = !opsCase;
    const noActions = !(actions || []).some((a) => a.status === "OPEN");
    if (reviewMissing || noOpCase || noActions) out.push({ type: "PAID_BUT_NO_REVIEW_ACTION", application_id: app?.id, order_id: order?.id, detail: "Paid application without a post-payment review Kleenex or open operations action.", severity: "CRITICAL" });
  }
  const completedRefund = (refunds || []).find((r) => r.status === "COMPLETED");
  if (completedRefund && order && !["REFUNDED", "PARTIALLY_REFUNDED"].includes(order.status))
    out.push({ type: "REFUND_MISMATCH", application_id: app?.id, refund_id: completedRefund.id, order_id: order?.id, detail: `Refund COMPLETED but order is ${order.status}`, severity: "HIGH" });
  return out;
}

export function priorityScore(p: { sla: any; stuck: any; travelDate?: string; paid: boolean; refundActive: boolean; handoffOpen: boolean }): number {
  // Deterministic priority (§9). Lower = higher priority.
  let score = 100;
  if (p.stuck?.flag) score -= 30;
  if (p.sla?.state === "CRITICAL") score -= 25;
  else if (p.sla?.state === "OVERDUE") score -= 18;
  else if (p.sla?.state === "DUE_SOON") score -= 8;
  if (p.travelDate) {
    const days = (new Date(p.travelDate).getTime() - nowMs()) / 86_400_000;
    if (days < 7) score -= 20; else if (days < 14) score -= 12; else if (days < 30) score -= 5;
  }
  if (p.refundActive) score -= 10;
  if (p.paid) score -= 4;
  if (p.handoffOpen) score -= 6;
  return Math.max(0, score);
}

export const __test = { sumMinor, STAGE_LABEL, DEFAULT_SLA_HOURS };