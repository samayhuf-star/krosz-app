// Worldz Visa (Phase 31 \u00a73-6): deterministic case_state \u2194 legacy status projections.
//
// case_state is the SOLE authoritative lifecycle state (\u00a73). The legacy 18-state
// `status` becomes a DERIVED compatibility field (\u00a75) computed from case_state
// whenever the Case Engine transitions. No code may treat `status` as authoritative.
//
// All mappings are deterministic and documented here. Unknown legacy values map to
// null (the migration marks those MIGRATION_REVIEW_REQUIRED rather than guessing).

export type CaseState =
  | "DRAFT" | "INTAKE" | "ELIGIBILITY_REVIEW" | "DOCUMENTS_REQUIRED"
  | "DOCUMENTS_REVIEW" | "READY_FOR_SUBMISSION" | "REVIEW_REQUIRED"
  | "SUBMISSION_PENDING" | "SUBMITTED" | "PROCESSING"
  | "ADDITIONAL_INFORMATION_REQUIRED" | "APPROVED" | "REJECTED"
  | "CANCELLED" | "EXPIRED" | "COMPLETED";

// case_state \u2192 legacy 18-state `status` (\u00a75).
export const CASE_STATE_TO_LEGACY_STATUS: Record<CaseState, string> = {
  DRAFT: "draft",
  INTAKE: "eligibility_confirmed",
  ELIGIBILITY_REVIEW: "eligibility_confirmed",
  DOCUMENTS_REQUIRED: "documents_pending",
  DOCUMENTS_REVIEW: "document_review",
  READY_FOR_SUBMISSION: "submission_ready",
  REVIEW_REQUIRED: "user_approval",
  SUBMISSION_PENDING: "submission_ready",
  SUBMITTED: "submitted",
  PROCESSING: "government_processing",
  ADDITIONAL_INFORMATION_REQUIRED: "additional_documents",
  APPROVED: "approved",
  REJECTED: "refused",
  CANCELLED: "cancelled",
  EXPIRED: "withdrawn",
  COMPLETED: "completed",
};

// case_state \u2192 legacy current_step (UI convenience).
export const CASE_STATE_TO_STEP: Record<CaseState, string> = {
  DRAFT: "eligibility", INTAKE: "eligibility", ELIGIBILITY_REVIEW: "eligibility",
  DOCUMENTS_REQUIRED: "documents", DOCUMENTS_REVIEW: "documents",
  READY_FOR_SUBMISSION: "submission", REVIEW_REQUIRED: "review",
  SUBMISSION_PENDING: "submission", SUBMITTED: "submission", PROCESSING: "submission",
  ADDITIONAL_INFORMATION_REQUIRED: "documents", APPROVED: "decision",
  REJECTED: "decision", CANCELLED: "decision", EXPIRED: "decision", COMPLETED: "decision",
};

// case_state \u2192 canonical CaseEvent event_type.
export const CASE_EVENT_TYPE_FOR_STATE: Record<CaseState, string> = {
  DRAFT: "CASE_CREATED", INTAKE: "INTAKE_STARTED", ELIGIBILITY_REVIEW: "ELIGIBILITY_REVIEWED",
  DOCUMENTS_REQUIRED: "DOCUMENT_REQUESTED", DOCUMENTS_REVIEW: "DOCUMENT_RECEIVED",
  READY_FOR_SUBMISSION: "DOCUMENT_REVIEWED", REVIEW_REQUIRED: "REVIEW_REQUESTED",
  SUBMISSION_PENDING: "SUBMISSION_REQUESTED", SUBMITTED: "SUBMITTED",
  PROCESSING: "STATUS_CHANGED", ADDITIONAL_INFORMATION_REQUIRED: "ADDITIONAL_INFORMATION_REQUESTED",
  APPROVED: "APPROVED", REJECTED: "REJECTED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED", COMPLETED: "COMPLETED",
};

// legacy `status` \u2192 closest case_state (\u00a74 migration).
export const LEGACY_STATUS_TO_CASE_STATE: Record<string, CaseState> = {
  draft: "DRAFT", eligibility_confirmed: "INTAKE", documents_pending: "DOCUMENTS_REQUIRED",
  document_review: "DOCUMENTS_REVIEW", application_ready: "READY_FOR_SUBMISSION",
  user_approval: "REVIEW_REQUIRED", submission_ready: "READY_FOR_SUBMISSION",
  appointment_pending: "READY_FOR_SUBMISSION", appointment_booked: "READY_FOR_SUBMISSION",
  submitted: "SUBMITTED", government_processing: "PROCESSING",
  additional_documents: "ADDITIONAL_INFORMATION_REQUIRED", decision: "PROCESSING",
  approved: "APPROVED", refused: "REJECTED", cancelled: "CANCELLED",
  withdrawn: "CANCELLED", completed: "COMPLETED",
};

export function legacyStatusFromCaseState(s: CaseState | string): string {
  return CASE_STATE_TO_LEGACY_STATUS[s as CaseState] || "draft";
}
export function currentStepFromCaseState(s: CaseState | string): string {
  return CASE_STATE_TO_STEP[s as CaseState] || "eligibility";
}
export function caseStateFromLegacyStatus(status: string | null | undefined): CaseState | null {
  if (!status) return null;
  return LEGACY_STATUS_TO_CASE_STATE[String(status)] || null;
}
export function caseEventTypeForState(s: CaseState | string): string {
  return CASE_EVENT_TYPE_FOR_STATE[s as CaseState] || "STATUS_CHANGED";
}

// Pure migration decision (\u00a74/\u00a76). Never guesses an unknown status \u2014 returns
// MIGRATION_REVIEW_REQUIRED so an operator inspects it.
export function decideLegacyMigration(app: any): {
  target_state: CaseState;
  review_required: boolean;
  source_status: string | null;
} {
  const current = (app?.case_state as CaseState) || null;
  if (current && current.length) return { target_state: current, review_required: false, source_status: app?.status || null };
  const mapped = caseStateFromLegacyStatus(app?.status);
  if (mapped) return { target_state: mapped, review_required: false, source_status: app?.status || null };
  // Unknown / null legacy status \u2192 safe default, flagged for review (\u00a76).
  return { target_state: "DRAFT", review_required: true, source_status: app?.status || null };
}