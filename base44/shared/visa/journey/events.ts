// Worldz Visa — Phase 12: Timeline event ingestion + dedup (§3/§4/§5).
// recordTimelineEvent is the single write path for customer-facing timeline
// rows. It dedupes by event_id (application_id + event_type + source_ref),
// never emits internal task/worker noise to customers (visibility gate), and
// best-effort dispatches notifications via the notification service.

import { dispatchForEvent } from "../notifications/service.ts";

function buildEventId(appId: string, eventType: string, sourceRef?: string): string {
  const base = [appId, eventType, sourceRef || ""].join("|");
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  return `tle_${h.toString(36)}`;
}

const CUSTOMER_VISIBLE = new Set([
  "APPLICATION_CREATED", "REQUIREMENTS_READY", "DOCUMENTS_STARTED", "DOCUMENTS_COMPLETED",
  "QUESTIONS_REQUIRED", "QUESTIONS_COMPLETED", "APPLICATION_READY", "PAYMENT_REQUIRED", "PAYMENT_COMPLETED",
  "FORM_GENERATED", "FORM_VALIDATED", "SUBMISSION_PACKAGE_READY", "SUBMISSION_APPROVED",
  "SUBMISSION_STARTED", "SUBMISSION_COMPLETED", "APPOINTMENT_REQUIRED", "APPOINTMENT_BOOKED",
  "BIOMETRICS_COMPLETED", "INTERVIEW_COMPLETED", "PASSPORT_SUBMITTED", "APPLICATION_PROCESSING",
  "ADDITIONAL_INFORMATION_REQUIRED", "DECISION_RECEIVED", "VISA_APPROVED", "VISA_REFUSED",
  "PASSPORT_RETURNED", "APPLICATION_CANCELLED",
  "ORDER_CREATED", "PAYMENT_INITIATED", "PAYMENT_SUCCESSFUL", "PAYMENT_FAILED",
  "FINAL_REVIEW_COMPLETED", "READY_FOR_SUBMISSION",
]);

export interface TimelineInput {
  event_type: string;
  title?: string;
  description?: string;
  actor_type?: "TRAVELER" | "OPERATOR" | "SYSTEM" | "PROVIDER" | "PORTAL";
  source_ref?: string;
  source?: string;
  visibility?: "CUSTOMER" | "OPERATOR" | "INTERNAL" | "SYSTEM";
  metadata?: any;
}

// Reconcile missing canonical milestone events from current application state.
// Idempotent (dedup by event_id) and record-only — never bulk-dispatches. Called
// by the journey projection so the timeline is accurate even for apps created
// before Phase 12 or transitioned by background workers (§55).
export async function reconcileTimeline(svc: any, app: any, ctx: any): Promise<void> {
  const rec = (et: string, opts: Partial<TimelineInput> = {}) =>
    recordTimelineEvent(svc, app, { event_type: et, ...opts }, false).catch(() => {});
  await rec("APPLICATION_CREATED", { source_ref: app.id });
  if (app.requirements_version) await rec("REQUIREMENTS_READY");
  if (ctx?.requirementProgress) {
    const rp = ctx.requirementProgress;
    if (rp.total && (rp.verified || 0) > 0) await rec("DOCUMENTS_STARTED");
    if (rp.total && (rp.satisfied || 0) >= rp.total) await rec("DOCUMENTS_COMPLETED");
  }
  if (ctx?.readiness?.questions && ctx.readiness.questions.total > 0) {
    if (ctx.readiness.questions.answered >= ctx.readiness.questions.total) await rec("QUESTIONS_COMPLETED");
    else if (ctx.readiness.questions.answered > 0) await rec("QUESTIONS_REQUIRED");
  }
  if (ctx?.readiness?.ready) await rec("APPLICATION_READY");
  if (ctx?.payment?.paid) await rec("PAYMENT_COMPLETED", { source_ref: ctx.payment.order_id || undefined });
  else if (ctx?.payment?.required) await rec("PAYMENT_REQUIRED");
  if (ctx?.submissions?.length) {
    const s = ctx.submissions[0];
    if (["SUBMITTED", "COMPLETED"].includes(s.status)) await rec("SUBMISSION_COMPLETED", { source_ref: s.id });
    else await rec("SUBMISSION_STARTED", { source_ref: s.id });
  }
  if (ctx?.appointmentBooked) await rec("APPOINTMENT_BOOKED", { source_ref: ctx.appointments?.[0]?.id });
  else if (ctx?.appointmentRequired) await rec("APPOINTMENT_REQUIRED");
  if (["submitted", "government_processing", "decision"].includes(app?.status)) await rec("APPLICATION_PROCESSING");
  if (app?.status === "approved") await rec("VISA_APPROVED");
  else if (app?.status === "refused") await rec("VISA_REFUSED");
  else if (app?.status === "completed") await rec("PASSPORT_RETURNED");
  if (["cancelled", "withdrawn"].includes(app?.status)) await rec("APPLICATION_CANCELLED");
  if (app?.status === "additional_documents") await rec("ADDITIONAL_INFORMATION_REQUIRED");
}

// Dispatch notifications for any CUSTOMER events not yet notified (dedup-safe).
export async function dispatchExistingNotifications(svc: any, app: any): Promise<void> {
  const rows: any[] = await svc.entities.ApplicationTimelineEvent.filter({ application_id: app.id, visibility: "CUSTOMER" }).catch(() => []);
  for (const r of rows || []) {
    const key = `${app.id}|${r.event_type}|${r.event_id}`;
    const pending = await svc.entities.VisaNotification.filter({ event_id: r.event_id }).catch(() => []);
    if (pending && pending.length) continue;
    await dispatchForEvent(svc, app, r).catch((e: any) => { void e; });
  }
}

// Idempotent: identical retried operations collapse to a single row (§4/§21).
// `dispatch` controls whether notifications fire for this event. Reconciliation
// backfills use dispatch=false to avoid mass-sending on a stale application;
// live domain transitions call with dispatch=true.
export async function recordTimelineEvent(svc: any, app: any, input: TimelineInput, dispatch = true): Promise<any> {
  const event_id = buildEventId(app.id, input.event_type, input.source_ref);
  const dedup: any[] = await svc.entities.ApplicationTimelineEvent.filter({ event_id }).catch(() => []);
  if (dedup && dedup.length) return dedup[0];
  const visibility = input.visibility ?? (CUSTOMER_VISIBLE.has(input.event_type) ? "CUSTOMER" : "SYSTEM");
  const row = await svc.entities.ApplicationTimelineEvent.create({
    application_id: app.id,
    traveler_id: app.traveler_id,
    event_id,
    event_type: input.event_type,
    status: "INFO",
    title: input.title || defaultTitle(input.event_type),
    description: input.description,
    visibility,
    actor_type: input.actor_type || "SYSTEM",
    source_ref: input.source_ref,
    occurred_at: new Date().toISOString(),
    metadata: input.metadata || {},
  }).catch(() => null);
  // Best-effort notification dispatch for CUSTOMER-visible events.
  if (row && visibility === "CUSTOMER" && dispatch) {
    await dispatchForEvent(svc, app, row).catch((e: any) => { void e; });
  }
  return row;
}

function defaultTitle(et: string): string {
  const map: Record<string, string> = {
    APPLICATION_CREATED: "Application started",
    REQUIREMENTS_READY: "Requirements identified",
    DOCUMENTS_STARTED: "Document collection started",
    DOCUMENTS_COMPLETED: "Documents uploaded",
    QUESTIONS_REQUIRED: "Application questions to answer",
    QUESTIONS_COMPLETED: "Application questions answered",
    APPLICATION_READY: "Application ready",
    PAYMENT_REQUIRED: "Payment required",
    PAYMENT_COMPLETED: "Payment successful",
    FORM_GENERATED: "Government form generated",
    FORM_VALIDATED: "Application form validated",
    SUBMISSION_PACKAGE_READY: "Submission package ready",
    SUBMISSION_APPROVED: "Submission approved",
    SUBMISSION_STARTED: "Submitting your application",
    SUBMISSION_COMPLETED: "Application submitted",
    APPOINTMENT_REQUIRED: "Appointment required",
    APPOINTMENT_BOOKED: "Appointment booked",
    BIOMETRICS_COMPLETED: "Biometrics completed",
    INTERVIEW_COMPLETED: "Interview completed",
    PASSPORT_SUBMITTED: "Passport submitted",
    APPLICATION_PROCESSING: "Application is processing",
    ADDITIONAL_INFORMATION_REQUIRED: "Additional information required",
    DECISION_RECEIVED: "Decision received",
    VISA_APPROVED: "Visa approved",
    VISA_REFUSED: "Visa refused",
    PASSPORT_RETURNED: "Passport returned",
    APPLICATION_CANCELLED: "Application cancelled",
    ORDER_CREATED: "Order created",
    PAYMENT_INITIATED: "Payment initiated",
    PAYMENT_SUCCESSFUL: "Payment successful",
    PAYMENT_FAILED: "Payment failed",
    FINAL_REVIEW_COMPLETED: "Final review completed",
    READY_FOR_SUBMISSION: "Ready for submission",
  };
  return map[et] || et.replace(/_/g, " ").toLowerCase();
}