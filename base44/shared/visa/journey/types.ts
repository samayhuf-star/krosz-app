// Worldz Visa — Phase 12: Customer Journey projection layer.
// The journey is a READ-ONLY projection of real application state. It never
// stores a second state machine (§6). Stages, actions, timeline, and progress
// are all derived from the existing domain modules (requirements, documents,
// questions, payment, submission, appointment, execution, decision).

export const JOURNEY_STAGES = [
  "PREPARATION",
  "DOCUMENTS",
  "APPLICATION",
  "PAYMENT",
  "SUBMISSION",
  "APPOINTMENT",
  "PROCESSING",
  "DECISION",
  "PASSPORT_RETURN",
  "COMPLETED",
] as const;
export type JourneyStage = typeof JOURNEY_STAGES[number];

export const STAGE_STATUS = [
  "NOT_STARTED", "IN_PROGRESS", "WAITING", "ACTION_REQUIRED", "COMPLETED", "BLOCKED", "FAILED",
] as const;
export type StageStatus = typeof STAGE_STATUS[number];

export const ACTION_PRIORITY = [
  "SECURITY_VERIFICATION", "PAYMENT", "MISSING_REQUIRED_DATA", "DOCUMENTS", "APPOINTMENT", "APPROVAL", "SUBMISSION",
] as const;

export const ACTION_TYPES = [
  "DOCUMENT", "QUESTION", "PAYMENT", "APPOINTMENT", "APPROVAL", "VERIFICATION", "HUMAN_HANDOFF", "OTHER",
] as const;

export interface JourneyContext {
  readiness?: any;
  requirementProgress?: any;
  appointments?: any[];
  submissions?: any[];
  packages?: any[];
  orders?: any[];
  canSubmit?: any;
  runProgress?: any;
  appointmentRequired?: boolean;
}

export interface CustomerStage {
  stage: JourneyStage | null;
  status: StageStatus;
  title: string;
  description?: string;
}

export interface JourneyActionSummary {
  id: string;
  action_key: string;
  type: typeof ACTION_TYPES[number];
  title: string;
  description?: string;
  priority: typeof ACTION_PRIORITY[number];
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  source: string;
  source_ref?: string;
  due_at?: string;
  cta_link?: string;
}

export interface JourneyTimelineItem {
  id: string;
  event_type: string;
  status: string;
  title: string;
  description?: string;
  occurred_at: string;
  actor_type?: string;
}

export interface CustomerJourney {
  application: any;
  current_stage: CustomerStage;
  progress: { percent: number; weights: Record<string, number> };
  next_action: JourneyActionSummary | null;
  actions: JourneyActionSummary[];
  timeline: JourneyTimelineItem[];
  appointment: any | null;
  submission: any | null;
  payment: any | null;
  blocking: boolean;
  blocking_reasons: string[];
  estimated_processing_time: string | null;
}

// Friendly status translation (§53): never expose raw orchestrator states.
export const STATUS_LABEL: Record<string, string> = {
  draft: "Getting started",
  eligibility_confirmed: "Eligible",
  documents_pending: "Documents needed",
  document_review: "Reviewing documents",
  application_ready: "Application ready",
  user_approval: "Waiting for your approval",
  appointment_pending: "Appointment needed",
  appointment_booked: "Appointment booked",
  submission_ready: "Ready to submit",
  submitted: "Submitted",
  government_processing: "Processing",
  additional_documents: "Additional information needed",
  decision: "Decision stage",
  approved: "Visa approved",
  refused: "Visa refused",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  completed: "Completed",
};

export function friendlyStatus(status: string): string {
  return STATUS_LABEL[status] || (status ? status.replace(/_/g, " ") : "");
}