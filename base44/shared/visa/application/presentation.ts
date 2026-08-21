// Worldz Visa (Phase 28) \u2014 Traveler-facing presentation over the Phase 27 case engine.
// PURE (no DB, no LLM). This never mutates case state, never recomputes visa truth,
// and never duplicates the Travel Entry Engine. It maps the deterministic case state
// machine onto traveler-friendly labels, a deterministic next action, and a journey
// that adapts to the resolved snapshot (visa-free journeys omit application steps,
// guidance-only journeys never offer automated submission, unknown fees/docs are
// never fabricated). The frontend consumes the backend `application-case-context`
// action which builds this projection server-side \u2014 the client never derives truth.

import type { ApplicationCase, CaseState, ExecutionCapability } from "./caseEngine.ts";

export const CASE_STATE_LABEL: Record<CaseState, string> = {
  DRAFT: "Application started",
  INTAKE: "Getting your details",
  ELIGIBILITY_REVIEW: "Checking eligibility",
  DOCUMENTS_REQUIRED: "Documents required",
  DOCUMENTS_REVIEW: "Documents under review",
  READY_FOR_SUBMISSION: "Ready for submission",
  REVIEW_REQUIRED: "Review required",
  SUBMISSION_PENDING: "Preparing submission",
  SUBMITTED: "Application submitted",
  PROCESSING: "Application processing",
  ADDITIONAL_INFORMATION_REQUIRED: "Action required",
  APPROVED: "Visa approved",
  REJECTED: "Application not approved",
  CANCELLED: "Application cancelled",
  EXPIRED: "Application expired",
  COMPLETED: "Application completed",
};

export const EXECUTION_LABEL: Record<ExecutionCapability, string> = {
  GUIDANCE_ONLY: "Guidance only",
  INTELLIGENCE_ONLY: "Intelligence only",
  PARTIAL_ASSIST: "Partially assisted",
  DOCUMENT_ASSIST: "Document assist",
  APPLICATION_ASSIST: "Application assist",
  END_TO_END: "End-to-end application",
  UNKNOWN: "Being researched",
};

export const EXECUTION_TRAVELER_MESSAGE: Record<ExecutionCapability, string> = {
  GUIDANCE_ONLY: "We\u2019ll guide you through the official government portal \u2014 we cannot submit this application for you.",
  INTELLIGENCE_ONLY: "We\u2019ll help you understand requirements and prepare \u2014 submission happens on the official portal.",
  PARTIAL_ASSIST: "We\u2019ll prepare your application and our team will review it before any submission step.",
  DOCUMENT_ASSIST: "We\u2019ll help you organize your documents for the official portal.",
  APPLICATION_ASSIST: "We\u2019ll prepare your application and a verified flow handles submission.",
  END_TO_END: "Your application can be submitted through our verified partner integration.",
  UNKNOWN: "We\u2019re still researching how we can help with this destination.",
};

export type NextActionKind = "navigate" | "upload" | "review" | "wait" | "track" | "view" | "exit" | "submit" | "resolve" | "none";
export interface NextAction { label: string; kind: NextActionKind; blocked: boolean; detail?: string; }

// Deterministic next action derived from case state + execution capability (\u00a78).
// Never LLM-generated. Never offers "submit" for guidance/intelligence-only journeys.
export function nextActionFor(c: any): NextAction {
  const st: CaseState = (c?.state || c?.case_state || c?.normalized_status) as CaseState;
  const ec: ExecutionCapability = (c?.execution_capability || c?.snapshot?.execution_capability || "GUIDANCE_ONLY") as ExecutionCapability;
  switch (st) {
    case "DRAFT": return { label: "Continue your application", kind: "navigate", blocked: false };
    case "INTAKE": return { label: "Add travel details", kind: "navigate", blocked: false };
    case "ELIGIBILITY_REVIEW": return { label: "Continue to documents", kind: "navigate", blocked: false };
    case "DOCUMENTS_REQUIRED": return { label: "Upload documents", kind: "upload", blocked: false };
    case "DOCUMENTS_REVIEW": return { label: "Wait for document review", kind: "wait", blocked: false };
    case "READY_FOR_SUBMISSION":
      if (ec === "GUIDANCE_ONLY") return { label: "Continue on the official government portal", kind: "exit", blocked: false };
      if (ec === "INTELLIGENCE_ONLY") return { label: "Prepare your application on the official portal", kind: "exit", blocked: false };
      if (ec === "DOCUMENT_ASSIST") return { label: "Continue on the official portal", kind: "exit", blocked: false };
      if (ec === "PARTIAL_ASSIST" || ec === "APPLICATION_ASSIST") return { label: "Review and continue", kind: "review", blocked: false };
      return { label: "Review and submit", kind: "review", blocked: false }; // END_TO_END
    case "REVIEW_REQUIRED": return { label: "Review application", kind: "review", blocked: true };
    case "SUBMISSION_PENDING": return { label: "Prepare submission", kind: "submit", blocked: false };
    case "SUBMITTED": return { label: "Track application", kind: "track", blocked: false };
    case "PROCESSING": return { label: "View application status", kind: "track", blocked: false };
    case "ADDITIONAL_INFORMATION_REQUIRED": return { label: "Provide additional information", kind: "resolve", blocked: true };
    case "APPROVED": return { label: "View visa", kind: "view", blocked: false };
    case "REJECTED": return { label: "No further action required", kind: "none", blocked: false };
    case "CANCELLED": return { label: "Application cancelled", kind: "none", blocked: false };
    case "EXPIRED": return { label: "Start a new application", kind: "navigate", blocked: false };
    case "COMPLETED": return { label: "View completed application", kind: "view", blocked: false };
    default: return { label: "Continue", kind: "navigate", blocked: false };
  }
}

export interface WizardStep { id: string; label: string; required: boolean; }

// Journey-adaptive wizard. Visa-free journeys collapse to the essentials; guidance-only
// journeys replace the automated submission step with an optional "official portal" step
// (required=false). Steps that have no honest data (e.g. payment with no fee) are omitted.
export function wizardStepsForCase(c: any): WizardStep[] {
  const snap = c?.snapshot || {};
  const ec: ExecutionCapability = (c?.execution_capability || snap?.execution_capability || "GUIDANCE_ONLY") as ExecutionCapability;
  const visaRequired = snap?.eligibility?.visa_required !== false && snap?.journey !== "VISA_FREE";
  const docReqs: any[] = snap?.document_requirements || [];
  const fee = snap?.fee || null;
  const hasFee = !!(fee && Number(fee.government_minor) > 0);
  const canSubmit = ec === "END_TO_END" || ec === "PARTIAL_ASSIST" || ec === "APPLICATION_ASSIST";
  const steps: WizardStep[] = [
    { id: "travel", label: "Travel", required: true },
    { id: "traveler", label: "Traveler", required: true },
  ];
  if (visaRequired) steps.push({ id: "journey", label: "Journey", required: true });
  if (visaRequired) steps.push({ id: "eligibility", label: "Eligibility", required: true });
  steps.push({ id: "requirements", label: "Requirements", required: true });
  if (visaRequired) steps.push({ id: "traveler_info", label: "Your details", required: true });
  if (visaRequired && docReqs.length > 0) steps.push({ id: "documents", label: "Documents", required: true });
  if (visaRequired) steps.push({ id: "review", label: "Review", required: true });
  if (visaRequired && hasFee && canSubmit) steps.push({ id: "payment", label: "Payment", required: true });
  if (visaRequired && canSubmit) steps.push({ id: "submission", label: "Submission", required: true });
  else if (visaRequired) steps.push({ id: "submission", label: "Official portal", required: false });
  steps.push({ id: "confirmation", label: "Confirmation", required: true });
  return steps;
}

// Active step id from the authoritative case state. Used to position the progress bar
// when resuming (the saved sub-step refines within a milestone).
export function activeStepForState(state: CaseState): string {
  const m: Record<CaseState, string> = {
    DRAFT: "travel", INTAKE: "eligibility", ELIGIBILITY_REVIEW: "eligibility",
    DOCUMENTS_REQUIRED: "documents", DOCUMENTS_REVIEW: "review",
    READY_FOR_SUBMISSION: "review", REVIEW_REQUIRED: "review",
    SUBMISSION_PENDING: "submission", SUBMITTED: "submission", PROCESSING: "confirmation",
    ADDITIONAL_INFORMATION_REQUIRED: "documents",
    APPROVED: "confirmation", REJECTED: "confirmation", CANCELLED: "confirmation",
    EXPIRED: "confirmation", COMPLETED: "confirmation",
  };
  return m[state] || "travel";
}

// Whether this case needs an automated submission step at all (\u00a79).
export function requiresSubmissionStep(c: any): boolean {
  const ec: ExecutionCapability = (c?.execution_capability || c?.snapshot?.execution_capability || "GUIDANCE_ONLY") as ExecutionCapability;
  return ec === "END_TO_END" || ec === "PARTIAL_ASSIST" || ec === "APPLICATION_ASSIST";
}

// Honest fee projection. Never fabricated; "unavailable" when the snapshot has none (\u00a713).
export function feeForCase(c: any): { available: boolean; government_minor?: number; provider_minor?: number; service_minor?: number; total_minor?: number; currency?: string } {
  const fee = c?.snapshot?.fee || null;
  if (!fee) return { available: false };
  const gov = Number(fee.government_minor) || 0;
  const provider = Number(fee.provider_minor || 0) || 0;
  const service = Number(fee.service_minor || fee.our_minor || 0) || 0;
  const total = Number(fee.total_minor);
  const computed = Number.isFinite(total) ? total : gov + provider + service;
  if (computed <= 0 && gov <= 0 && provider <= 0 && service <= 0) return { available: false };
  return { available: true, government_minor: gov, provider_minor: provider, service_minor: service, total_minor: computed, currency: fee.currency || "INR" };
}

export function eligibilityForCase(c: any): "eligible" | "ineligible" | "unknown" | "requires_review" {
  const e = c?.snapshot?.eligibility || {};
  // A verified, published capability is the authoritative route-eligibility
  // signal. The legacy discovery layer could still stamp outcome "not_eligible"
  // (empty/dev_seed VisaRoute rows) even for a live destination, which made the
  // eligibility step tell eligible travelers "You do not appear eligible."
  // Once the route passed the public verification gate, the traveler is
  // eligible for that resolved route on the snapshot we already show them.
  if (e.ready_for_public === true) return "eligible";
  if (e.outcome === "requires_review") return "requires_review";
  return "unknown";
}

export function requiredDocsForCase(c: any): { code: string; label: string; mandatory: boolean }[] {
  const docs = c?.snapshot?.document_requirements || [];
  return docs.map((d: any) => ({ code: d.code || d.key || "doc", label: d.label || d.name || "Document", mandatory: d.mandatory !== false })).filter((d: any) => d.code);
}

export const __presentation = {
  CASE_STATE_LABEL, EXECUTION_LABEL, EXECUTION_TRAVELER_MESSAGE,
  nextActionFor, wizardStepsForCase, activeStepForState, requiresSubmissionStep,
  feeForCase, eligibilityForCase, requiredDocsForCase,
};