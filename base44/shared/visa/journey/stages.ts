// Worldz Visa — Phase 12: Journey stage derivation + dynamic activation (§7/§8)
// and progress calculation (§13). Stages are derived from application state +
// the appointment_required flag, never hard-coded per visa type. Progress uses
// weighted milestones, not completed-tasks/total-tasks.

import { JOURNEY_STAGES, STAGE_STATUS } from "./types.ts";

// Dynamic stage activation (§8): appointment-only stages appear only when the
// route requires an appointment. PREPARATION/DOCUMENTS/APPLICATION/PAYMENT/
// SUBMISSION/PROCESSING/DECISION are always candidates; COMPLETED is terminal.
export function activeStages(opts: { appointmentRequired: boolean; hasPassportReturn: boolean }): string[] {
  const base = ["PREPARATION", "DOCUMENTS", "APPLICATION", "PAYMENT", "SUBMISSION"];
  if (opts.appointmentRequired) base.push("APPOINTMENT");
  base.push("PROCESSING", "DECISION");
  if (opts.hasPassportReturn) base.push("PASSPORT_RETURN");
  base.push("COMPLETED");
  return base;
}

// Map the VisaApplication.status + current_step + context to a journey stage.
export function getCurrentApplicationStage(app: any, ctx: any): { stage: string; status: string } {
  const status = app?.status;
  const step = app?.current_step;
  const apptReq = !!ctx?.appointmentRequired;
  const terminal = ["approved", "refused", "cancelled", "withdrawn", "completed"].includes(status);

  if (status === "completed" || status === "approved") return { stage: "COMPLETED", status: "COMPLETED" };
  if (status === "refused") return { stage: "DECISION", status: "FAILED" };
  if (status === "cancelled" || status === "withdrawn") return { stage: "COMPLETED", status: "COMPLETED" };

  if (status === "government_processing" || status === "decision") {
    if (apptReq && !ctx?.appointmentBooked && step !== "decision") return { stage: "APPOINTMENT", status: "ACTION_REQUIRED" };
    return { stage: "PROCESSING", status: "IN_PROGRESS" };
  }
  if (status === "submitted") return { stage: "PROCESSING", status: "IN_PROGRESS" };
  if (status === "submission_ready") return { stage: "SUBMISSION", status: "ACTION_REQUIRED" };
  if (status === "appointment_booked") return { stage: "APPOINTMENT", status: "WAITING" };
  if (status === "appointment_pending") return { stage: "APPOINTMENT", status: "ACTION_REQUIRED" };

  if (status === "user_approval") return { stage: "SUBMISSION", status: "ACTION_REQUIRED" };

  if (status === "application_ready") return { stage: "APPLICATION", status: "COMPLETED" };
  if (status === "document_review") return { stage: "DOCUMENTS", status: "IN_PROGRESS" };
  if (status === "documents_pending") return { stage: "DOCUMENTS", status: "ACTION_REQUIRED" };
  if (status === "eligibility_confirmed") return { stage: "DOCUMENTS", status: "NOT_STARTED" };

  // draft / eligibility
  return { stage: "PREPARATION", status: status === "draft" ? "NOT_STARTED" : "IN_PROGRESS" };
}

// Weighted progress (§13). Weights are configurable here; sum normalised to 0-100.
const DEFAULT_WEIGHTS: Record<string, number> = {
  eligibility: 10,
  requirements: 10,
  documents: 18,
  questions: 12,
  readiness: 10,
  payment: 12,
  submission: 15,
  appointment: 10,
  processing: 8,
  decision: 5,
};

export function computeProgress(app: any, ctx: any): { percent: number; weights: Record<string, number> } {
  const weights = { ...DEFAULT_WEIGHTS };
  const done = (k: string) => Math.min(1, Math.max(0, k));
  const stageComplete: Record<string, number> = {};
  stageComplete.eligibility = app?.status && app.status !== "draft" ? 1 : (app?.destination ? 0.5 : 0);
  stageComplete.requirements = ctx?.requirementProgress?.total ? Math.min(1, (ctx.requirementProgress.satisfied || 0) / ctx.requirementProgress.total) : (app?.requirements_version ? 1 : 0);
  stageComplete.documents = ctx?.requirementProgress?.total ? Math.min(1, (ctx.requirementProgress.verified || 0) / Math.max(1, ctx.requirementProgress.total)) : 0;
  stageComplete.questions = ctx?.readiness?.questions ? (ctx.readiness.questions.answered / Math.max(1, ctx.readiness.questions.total)) : 0;
  stageComplete.readiness = ctx?.readiness?.ready ? 1 : (stageComplete.questions > 0 ? stageComplete.questions * 0.6 : 0);
  stageComplete.payment = ctx?.payment?.paid ? 1 : (ctx?.orders?.length && ctx?.payment ? 0.2 : 0);
  stageComplete.submission = ctx?.submissions?.some((s: any) => ["SUBMITTED", "COMPLETED"].includes(s.status)) ? 1 : (ctx?.submissions?.length ? 0.3 : 0);
  stageComplete.appointment = !ctx?.appointmentRequired ? 1 : (ctx?.appointmentBooked ? 1 : 0);
  stageComplete.processing = ["government_processing", "submitted", "decision"].includes(app?.status) ? 0.5 : (app?.status === "approved" || app?.status === "completed" ? 1 : 0);
  stageComplete.decision = ["approved", "refused"].includes(app?.status) ? 1 : 0;

  let total = 0, max = 0;
  for (const k of Object.keys(weights)) { total += (stageComplete[k] || 0) * weights[k]; max += weights[k]; }
  const percent = max > 0 ? Math.round((total / max) * 100) : 0;
  return { percent, weights };
}

export const STAGE_ORDER = JOURNEY_STAGES;
export { STAGE_STATUS };