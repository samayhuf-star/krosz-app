// Worldz Visa (Phase 11) — Execution layer types.
//
// The browser/provider agent is an EXECUTION ADAPTER, not the decision-maker
// (§2). It operates only on an approved ExecutionPlan derived from the form +
// package + portal workflow. External portal content is untrusted DATA (§35).
// The orchestrator owns durable execution + recovery; this is not a second
// orchestration engine.

import type { ProviderContext, ProviderResult } from "../../providers/types.ts";

// ---------- Execution strategies (§3) ----------
export type ExecutionStrategy = "API" | "BROWSER_AUTOMATION" | "HUMAN_ASSISTED" | "MANUAL";

// ---------- Session status (§5) ----------
export type SessionStatus =
  | "CREATED"
  | "INITIALIZING"
  | "AUTHENTICATING"
  | "NAVIGATING"
  | "FILLING"
  | "UPLOADING"
  | "REVIEWING"
  | "WAITING_FOR_USER"
  | "SUBMITTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN_EXTERNAL_STATE";

export const TERMINAL_SESSION: SessionStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "UNKNOWN_EXTERNAL_STATE"];

// ---------- Checkpoints (§26) ----------
export type Checkpoint =
  | "NONE"
  | "CREATED"
  | "PORTAL_OPENED"
  | "APPLICATION_CREATED"
  | "IDENTITY_COMPLETED"
  | "TRAVEL_COMPLETED"
  | "DOCUMENTS_UPLOADED"
  | "REVIEW_READY"
  | "SUBMISSION_APPROVED"
  | "SUBMITTED"
  | "RECEIPT_CAPTURED";

// Ordered checkpoint progression — recovery resumes from the last durable one.
export const CHECKPOINT_ORDER: Checkpoint[] = [
  "NONE", "CREATED", "PORTAL_OPENED", "APPLICATION_CREATED",
  "IDENTITY_COMPLETED", "TRAVEL_COMPLETED", "DOCUMENTS_UPLOADED",
  "REVIEW_READY", "SUBMISSION_APPROVED", "SUBMITTED", "RECEIPT_CAPTURED",
];

// ---------- Capabilities (§41) ----------
export type ExecutionCapability =
  | "BROWSER_NAVIGATION"
  | "FORM_FILLING"
  | "DOCUMENT_UPLOAD"
  | "HUMAN_HANDOFF"
  | "EXTERNAL_SUBMISSION"
  | "RECEIPT_CAPTURE"
  | "STATUS_CHECK";

export const ALL_EXEC_CAPS: ExecutionCapability[] = [
  "BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD",
  "HUMAN_HANDOFF", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK",
];

// ---------- Human reasons (§23) ----------
export type HumanReason =
  | "OTP_REQUIRED" | "CAPTCHA_REQUIRED" | "LOGIN_REQUIRED" | "PORTAL_ERROR"
  | "FIELD_AMBIGUITY" | "CONFIRMATION_REQUIRED" | "POLICY_RESTRICTION"
  | "MANUAL_REVIEW" | "WORKFLOW_DRIFT" | "UNEXPECTED_DOMAIN"
  | "UNKNOWN_EXTERNAL_STATE";

// ---------- Adapter execution context ----------
export interface ExecutionExecutionContext {
  providerId: string;
  providerKey: string;
  portalDefinition: any;
  portalWorkflow: any;
  executionPlan: any;
  formSnapshot: any;       // The approved, immutable form data (§13 source of truth).
  documents: any[];        // Pinned package document versions + storage URIs.
  submission: any;
  session: any;
  // Resume-from-step for crash recovery (§27). Adapter resumes the NEXT step.
  resumeFromStep?: string;
  behaviors?: Record<string, any>; // mock-only simulation controls (test injection).
  requestId?: string;
}

// ---------- Adapter execution result ----------
export interface ExecutionResult {
  success: boolean;
  status?: SessionStatus;
  checkpoint?: Checkpoint;
  currentStep?: string;
  externalReference?: string;
  receipt?: { url?: string; mime_type?: string };
  // Pause/human hand-off.
  requiresHuman?: boolean;
  humanReason?: HumanReason;
  humanInstructions?: string;
  // Indeterminate post-submit state — must NOT auto-retry submit (§28).
  indeterminate?: boolean;
  // Step error classification (§46).
  error_code?: string;
  error_message?: string;
  error_category?: "TRANSIENT" | "PERMANENT" | "HUMAN_REQUIRED" | "UNKNOWN";
  retryable?: boolean;
  // Evidence (no secrets/PII).
  next_url?: string;
  response_metadata?: Record<string, any>;
  // Completion of the whole workflow.
  done?: boolean;
}

// ---------- Execution provider adapter contract (§40) ----------
// Additive to the existing submission provider; lives in the SAME provider
// adapter registry (§40). Providers implement only capabilities they advertise.
export interface ExecutionProviderAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly strategy: ExecutionStrategy;
  readonly capabilities: ExecutionCapability[];
  getCapabilities(ctx: ProviderContext): ExecutionCapability[];
  // Initialize a fresh execution (open portal / create session).
  init(ctx: ProviderContext, exec: ExecutionExecutionContext): Promise<ExecutionResult>;
  // Execute the current step (deterministic; engine advances checkpoint after).
  executeStep(ctx: ProviderContext, exec: ExecutionExecutionContext): Promise<ExecutionResult>;
  pause?(ctx: ProviderContext, exec: ExecutionExecutionContext): Promise<ExecutionResult>;
  cancel?(ctx: ProviderContext, exec: ExecutionExecutionContext): Promise<ExecutionResult>;
  getStatus?(ctx: ProviderContext, ref: { external_reference: string; submission_id?: string }): Promise<ExecutionResult>;
  health?(ctx: ProviderContext): Promise<ProviderResult<{ status: string }>>;
}

// ---------- Idempotency (§9 / parallel-execution guard) ----------
import { djb2, stable } from "../../operations/idempotency.ts";
export function executionIdempotencyKey(submissionId: string, strategy: ExecutionStrategy): string {
  return `exec|${submissionId}|${strategy}|${djb2(stable({ submissionId, strategy }))}`;
}