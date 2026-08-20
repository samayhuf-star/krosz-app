// Worldz Visa — Phase 12: ApplicationJourneyService — getApplicationJourney()
// (§45/§46). Aggregates a customer-facing journey from real domain state only;
// does NOT overfetch audit logs, provider logs, or orchestrator task internals (§46).
// Returns the single endpoint payload the customer dashboard + detail render.

import { getApplication } from "../application.ts";
import { getVisaRunProgress } from "../lifecycle.ts";
import { checkApplicationReadiness } from "../questions.ts";
import { computeRequirementProgress } from "../documents.ts";
import { listAppointments } from "../appointments/engine.ts";
import { listSubmissions, getLatestReadyPackage } from "../submission/engine.ts";
import { listOrders, canExecutePaidService } from "../payments/engine.ts";
import { getCurrentApplicationStage, computeProgress, activeStages } from "./stages.ts";
import { deriveActions, syncActions, pickNextAction } from "./actions.ts";
import { friendlyStatus } from "./types.ts";
import { reconcileTimeline, dispatchExistingNotifications } from "./events.ts";

function fmtMoney(minor: number, currency: string): string {
  if (minor == null || !currency) return "";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100); }
  catch { return `${minor / 100} ${currency}`; }
}

export async function getApplicationJourney(svc: any, user: any, appId: string): Promise<any> {
  const app = await getApplication(svc, user, appId);

  // Gather only customer-relevant projections (no audit/provider logs).
  const [readiness, requirementProgress, appointments, submissions, packages, ordersRes, canSubmit, runProgress, handoffs] = await Promise.all([
    checkApplicationReadiness(svc, app).catch(() => null),
    computeRequirementProgress(svc, app).catch(() => null),
    listAppointments(svc, user, app.id).then((r:any) => r.appointments || []).catch(() => []),
    listSubmissions(svc, user, app.id).then((r:any) => r.submissions || []).catch(() => []),
    getLatestReadyPackage(svc, app).catch(() => null),
    listOrders(svc, user, { application_id: app.id }).then((r:any) => r.orders || []).catch(() => []),
    canExecutePaidService(svc, app, "submission").catch(() => null),
    getVisaRunProgress(svc, app).catch(() => null),
    svc.entities.ExecutionActionRequest.filter({ application_id: app.id, status: { $in: ["OPEN", "IN_PROGRESS"] } }).catch(() => []),
  ]);

  const appointmentRequired = !!app.appointment_required;
  const appointmentBooked = appointments.some((a:any) => ["BOOKED", "SCHEDULED", "CONFIRMED", "ATTENDED"].includes(a.status));
  const latestAppt = appointments[0] || null;
  const latestSubmission = submissions[0] || packages || null;
  const paidOrder = ordersRes.find((o:any) => ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(o.status));
  const pendingOrder = ordersRes.find((o:any) => ["PENDING_PAYMENT", "DRAFT"].includes(o.status));

  // Build a normalised human-handoff list from open execution action requests.
  const humanHandoffs = (handoffs || []).map((h:any) => ({ id: h.id, title: h.reason, reason: h.instructions }));

  // Payment projection (§78): required only when the product gate is unsatisfied.
  const paymentRequired = !!canSubmit && !canSubmit.allowed && (canSubmit.gate || "").includes("PAYMENT") && !paidOrder;
  let payment: any = null;
  if (paymentRequired || paidOrder) {
    payment = {
      required: paymentRequired,
      paid: !!paidOrder,
      order_id: (pendingOrder || paidOrder)?.id || null,
      display: pendingOrder ? fmtMoney(pendingOrder.total_minor, pendingOrder.currency) : "",
      title: "Complete payment",
      description: pendingOrder ? `Pay ${fmtMoney(pendingOrder.total_minor, pendingOrder.currency)} to continue.` : "Payment required to continue.",
    };
  }

  const ctx = {
    readiness, requirementProgress, appointments, submissions, packages: packages ? [packages] : [], orders: ordersRes,
    canSubmit, runProgress, appointmentRequired, appointmentBooked, humanHandoffs, payment,
  };

  // Backfill any missing canonical milestones from current state (idempotent,
  // record-only), then dispatch any CUSTOMER events not yet notified (§55/§57).
  await reconcileTimeline(svc, app, ctx).catch(() => {});
  await dispatchExistingNotifications(svc, app).catch(() => {});

  const stageInfo = getCurrentApplicationStage(app, ctx);
  const progress = computeProgress(app, ctx);
  const derived = deriveActions(app, ctx);
  const actions = await syncActions(svc, app, derived);
  const next_action = pickNextAction(actions);

  // Customer timeline (§55): only CUSTOMER-visible events, newest first.
  const timelineRows: any[] = await svc.entities.ApplicationTimelineEvent.filter({ application_id: app.id, visibility: "CUSTOMER" }).catch(() => []);
  timelineRows.sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")));
  const timeline = timelineRows.slice(0, 50).map((r) => ({
    id: r.id, event_type: r.event_type, status: r.status, title: r.title, description: r.description,
    occurred_at: r.occurred_at, actor_type: r.actor_type,
  }));

  // Blocking status (§14): real blocking only, derived from action set + state.
  const blockingReasons: string[] = [];
  if (actions.some((a:any) => ["SECURITY_VERIFICATION", "PAYMENT", "MISSING_REQUIRED_DATA"].includes(a.priority))) {
    blockingReasons.push(actions[0]?.title || "Action required to continue");
  }
  if (app.status === "additional_documents") blockingReasons.push("Additional information requested by the visa authority");
  const blocking = blockingReasons.length > 0;

  // Processing estimate (§44): only if a verified source configured it; else null.
  const estimated_processing_time: string | null = app?.metadata?.estimated_processing_time || null;

  return {
    application: { ...app, status_label: friendlyStatus(app.status) },
    current_stage: { stage: stageInfo.stage, status: stageInfo.status, title: friendlyStatus(app.status), description: friendlyStatus(app.status) },
    progress,
    next_action,
    actions,
    timeline,
    appointment: latestAppt ? { ...latestAppt } : null,
    submission: latestSubmission ? { id: latestSubmission.id, status: latestSubmission.status, external_reference: latestSubmission.external_reference || null } : null,
    payment,
    blocking,
    blocking_reasons: blockingReasons,
    estimated_processing_time,
    stages: activeStages({ appointmentRequired, hasPassportReturn: appointmentRequired }),
  };
}