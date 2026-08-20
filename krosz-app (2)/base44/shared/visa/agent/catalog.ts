// Worldz Visa (Phase 34) \u2014 MCP tooling + controlled AI-agent layer.
//
// The AI agent is an ORCHESTRATOR (\u00a71). It is NOT the visa-truth engine, the
// eligibility engine, the case-state authority, the provider registry, the execution
// authority, the payment authority, or the document authority. Every tool here
// reuses the existing deterministic systems \u2014 the tool layer NEVER implements
// business logic, NEVER writes the database directly, and NEVER bypasses the
// Case Engine / Execution Router / Provider Registry / Payment Engine.
//
// This module is PURE (no DB, no network). It owns:
//   \u2022 the canonical tool catalog (\u00a737)
//   \u2022 role \u2192 permission scopes (\u00a717)
//   \u2022 input schema validation (\u00a74/\u00a736)
//   \u2022 risk classification (\u00a716)
//   \u2022 agent submission policy decision (\u00a739)
//   \u2022 rate limiting + loop budget (\u00a734/\u00a735)
//   \u2022 prompt-injection defense (\u00a730)
//   \u2022 output size limits + sensitive-data redaction (\u00a731/\u00a728/\u00a743)
//   \u2022 audit-event shape (\u00a732)
//
// The durable dispatcher (mcpApi) imports this module and calls the existing
// engines with the platform service role \u2014 it never reimplements them.

import { classifyField, redactForLog } from "../security/pii.ts";

// ---------- Types ----------
export type ToolCategory =
  | "TRAVEL" | "CASE" | "ELIGIBILITY" | "REQUIREMENTS" | "DOCUMENTS"
  | "EXECUTION" | "PROVIDERS" | "OPERATIONS" | "PAYMENTS" | "TRACKING";

export type RiskClass = "READ_ONLY" | "LOW_RISK_WRITE" | "HIGH_RISK_WRITE" | "EXTERNAL_EXECUTION";

export type PermissionScope =
  | "visa:read" | "case:read" | "case:create" | "case:transition"
  | "document:read" | "document:write" | "execution:prepare" | "execution:submit"
  | "provider:read" | "operations:read" | "operations:write" | "tracking:read"
  | "finance:read";

export type AgentRole = "traveler" | "operations" | "admin";

export interface ToolDef {
  name: string;
  category: ToolCategory;
  description: string;
  inputSchema: Record<string, { type: string; required?: boolean; enum?: string[]; description?: string }>;
  permission: PermissionScope;
  risk: RiskClass;
  idempotent: boolean;
  sideEffects: string;
  requiredReview?: boolean;
  supportedRoles: AgentRole[];
}

// ---------- Canonical tool catalog (\u00a737) ----------
export const AGENT_TOOLS: ToolDef[] = [
  // TRAVEL
  { name: "resolveTravelEntry", category: "TRAVEL", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Resolve the canonical travel-entry result (journey, eligibility, requirements, execution capability, provider route, confidence, sources) for a nationality\u2192destination pair.",
    inputSchema: { nationality: { type: "string", required: false }, destination: { type: "string", required: true }, purpose: { type: "string", required: false, enum: ["tourism", "business", "study", "transit"] }, travel_start: { type: "string", required: false }, travel_end: { type: "string", required: false } } },
  // ELIGIBILITY
  { name: "checkEligibility", category: "ELIGIBILITY", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Deterministic eligibility check \u2014 eligible / not_eligible / requires_review / unknown with reasons. The Travel Entry Engine decides; the LLM never decides eligibility from free-form reasoning.",
    inputSchema: { destination: { type: "string", required: true }, nationality: { type: "string", required: false }, journey: { type: "string", required: false } } },
  // REQUIREMENTS
  { name: "getVisaRequirements", category: "REQUIREMENTS", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Required/optional documents, traveler requirements, verified fees, sources, confidence, data version. UNKNOWN stays UNKNOWN \u2014 never fabricated.",
    inputSchema: { destination: { type: "string", required: true }, nationality: { type: "string", required: false }, journey: { type: "string", required: false } } },
  // CASE read
  { name: "getApplicationCase", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Read a single application case (traveler sees only their own; admin sees all).",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "listMyApplicationCases", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "List the caller's own application cases.",
    inputSchema: { status: { type: "string", required: false } } },
  { name: "getCaseTimeline", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Timeline derived from durable CaseEvent rows (never fabricated).",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getCaseNextAction", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Deterministic next-action for the traveler at the current case state.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getAllowedCaseTransitions", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "List of case states the Case Engine permits from the current state. The agent cannot set case_state directly; it can only request these transitions.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "explainCase", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Structured case explanation from actual data: current/previous state, recent events, pending tasks, missing documents, execution capability, provider, blockers, next action. The LLM may summarize; it must NOT invent facts.",
    inputSchema: { case_id: { type: "string", required: true } } },
  // CASE writes
  { name: "createApplicationCase", category: "CASE", permission: "case:create", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Creates a VisaApplication + CASE_CREATED CaseEvent via the Case Engine.", supportedRoles: ["traveler", "operations", "admin"],
    description: "Create a new application case via the existing Case Engine. Never creates duplicates (idempotency_key dedup).",
    inputSchema: { traveler_id: { type: "string", required: true }, destination: { type: "string", required: true }, visa_type_key: { type: "string", required: true }, purpose: { type: "string", required: true, enum: ["tourism", "business", "study", "transit"] }, idempotency_key: { type: "string", required: true } } },
  { name: "requestCaseTransition", category: "CASE", permission: "case:transition", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Appends a CaseEvent + projects case_state via the Case Engine. Never sets case_state directly.", requiredReview: true, supportedRoles: ["traveler", "operations", "admin"],
    description: "Request a single validated case-state transition. The Case Engine validates every transition; invalid transitions are rejected. The agent cannot directly set case_state.",
    inputSchema: { case_id: { type: "string", required: true }, target_state: { type: "string", required: true }, reason: { type: "string", required: false }, idempotency_key: { type: "string", required: true } } },
  { name: "confirmCaseReview", category: "CASE", permission: "case:transition", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Resolves a review gate via the Case Engine (REVIEW_REQUIRED \u2192 ready).", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Resolve an open review gate (document/case/submission review) with an ALLOWED decision. Traveler agents cannot confirm reviews.",
    inputSchema: { case_id: { type: "string", required: true }, review_type: { type: "string", required: true, enum: ["DOCUMENT_REVIEW", "CASE_REVIEW", "SUBMISSION_REVIEW"] }, decision: { type: "string", required: true, enum: ["APPROVED", "REJECTED"] }, reason: { type: "string", required: false } } },
  { name: "requestAdditionalInformation", category: "CASE", permission: "case:transition", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Transitions the case to ADDITIONAL_INFORMATION_REQUIRED + creates an OperationsTask.", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Request additional information/documents from the traveler. Creates an ADDITIONAL_INFORMATION OperationsTask.",
    inputSchema: { case_id: { type: "string", required: true }, reason: { type: "string", required: true }, idempotency_key: { type: "string", required: true } } },
  // DOCUMENTS
  { name: "listRequiredDocuments", category: "DOCUMENTS", permission: "document:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Required/optional documents for a case, derived from the immutable case snapshot. Never fabricated.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getDocumentStatus", category: "DOCUMENTS", permission: "document:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Per-document upload/extraction/review status for a case.",
    inputSchema: { case_id: { type: "string", required: true }, document_type: { type: "string", required: false } } },
  { name: "uploadDocument", category: "DOCUMENTS", permission: "document:write", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Creates an ApplicationDocument + DOCUMENT_UPLOADED CaseEvent.", supportedRoles: ["traveler", "operations", "admin"],
    description: "Upload a document for a case (file_url from UploadFile). Never returns raw document content to the model.",
    inputSchema: { case_id: { type: "string", required: true }, document_type: { type: "string", required: true }, file_url: { type: "string", required: true }, idempotency_key: { type: "string", required: true } } },
  { name: "requestDocumentReplacement", category: "DOCUMENTS", permission: "document:write", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Marks a document for re-upload + creates an OperationsTask.", supportedRoles: ["operations", "admin"],
    description: "Request the traveler re-upload a document (low quality / wrong type).",
    inputSchema: { case_id: { type: "string", required: true }, document_type: { type: "string", required: true }, reason: { type: "string", required: true } } },
  { name: "getDocumentExtraction", category: "DOCUMENTS", permission: "document:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Structured extracted document data (passport_number: available, date_of_birth, expiry) \u2014 never raw image/content unless explicitly authorized.",
    inputSchema: { case_id: { type: "string", required: true }, document_type: { type: "string", required: false } } },
  { name: "extractDocumentData", category: "DOCUMENTS", permission: "document:write", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Runs DocumentIntelligence (MRZ/OCR) and stores a DocumentIntelligence record. Low confidence \u2192 REVIEW_REQUIRED.", supportedRoles: ["traveler", "operations", "admin"],
    description: "Extract structured data from an uploaded document via existing MRZ/DocumentIntelligence. The LLM never performs OCR itself; low confidence requires review.",
    inputSchema: { case_id: { type: "string", required: true }, document_id: { type: "string", required: true } } },
  // PROVIDERS
  { name: "getExecutionRoute", category: "PROVIDERS", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Deterministic execution route for a case (PROVIDER_API / GOVERNMENT_API / PORTAL_AUTOMATION / HUMAN_OPERATIONS / GUIDANCE / EXECUTION_UNAVAILABLE). The agent must NOT infer this.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getProviderCapabilities", category: "PROVIDERS", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Verified provider capability inventory row (lifecycle, env, connection, submission_verified, ready).",
    inputSchema: { provider_key: { type: "string", required: true } } },
  { name: "getProviderStatus", category: "PROVIDERS", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "Provider health signal (healthy/degraded/down) + recent failures. Internal-only.",
    inputSchema: { provider_key: { type: "string", required: true } } },
  { name: "getApplicationExecutionStatus", category: "PROVIDERS", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Execution-attempt lifecycle for a case (status, provider application id, last error class).",
    inputSchema: { case_id: { type: "string", required: true } } },
  // EXECUTION (the authoritatively-gated tools)
  { name: "prepareApplication", category: "EXECUTION", permission: "execution:prepare", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Validates documents + form fields; returns a structured prepared payload + missing list.", supportedRoles: ["traveler", "operations", "admin"],
    description: "Prepare the application payload for submission (validate completeness against the form definition). Does NOT submit.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "validateApplication", category: "EXECUTION", permission: "execution:prepare", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Validate the application payload against the form definition + field mappings. Returns missing/invalid fields with reasons.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "requestSubmissionReview", category: "EXECUTION", permission: "execution:prepare", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Creates a SUBMISSION_REVIEW OperationsTask + transitions case to REVIEW_REQUIRED.", requiredReview: true, supportedRoles: ["traveler", "operations", "admin"],
    description: "Request human review of a prepared submission package. Creates a SUBMISSION_REVIEW OperationsTask the agent must NOT bypass.",
    inputSchema: { case_id: { type: "string", required: true }, reason: { type: "string", required: false }, idempotency_key: { type: "string", required: true } } },
  { name: "executeApplication", category: "EXECUTION", permission: "execution:submit", risk: "EXTERNAL_EXECUTION", idempotent: true, sideEffects: "Starts a provider execution attempt ONLY if all gates + agent_submission_policy pass. SANDBOX/mock in Phase 34.", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Execute the application submission. The backend verifies ownership, case state, execution capability, provider verification, binding, production env, credentials, commercial authorization, documents, eligibility, payment, review gates, idempotency, AND the agent_submission_policy. Any failure rejects with a structured reason.",
    inputSchema: { case_id: { type: "string", required: true }, confirmed: { type: "boolean", required: true, description: "Explicit user confirmation flag (required when policy=CONFIRMATION_REQUIRED)." }, idempotency_key: { type: "string", required: true } } },
  { name: "getExecutionStatus", category: "EXECUTION", permission: "execution:prepare", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Read the current execution attempt status for a case.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "retryExecution", category: "EXECUTION", permission: "execution:submit", risk: "EXTERNAL_EXECUTION", idempotent: true, sideEffects: "Retries a transiently-failed attempt up to MAX_RETRIES; never retries permanent/human-required failures.", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Retry a transiently-failed execution attempt. Permanent / human-required failures are not retried.",
    inputSchema: { case_id: { type: "string", required: true }, attempt_id: { type: "string", required: false } } },
  { name: "cancelExecution", category: "EXECUTION", permission: "execution:submit", risk: "EXTERNAL_EXECUTION", idempotent: true, sideEffects: "Cancels a PENDING/RUNNING/RETRYING attempt + records a CANCELLED CaseEvent.", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Cancel an in-flight execution attempt.",
    inputSchema: { case_id: { type: "string", required: true }, reason: { type: "string", required: true } } },
  // OPERATIONS
  { name: "listOperationsTasks", category: "OPERATIONS", permission: "operations:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "List operations tasks (filterable by queue/status/assignee). Internal-only.",
    inputSchema: { queue: { type: "string", required: false }, status: { type: "string", required: false }, assigned_to: { type: "string", required: false } } },
  { name: "listOverdueCases", category: "OPERATIONS", permission: "operations:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "Cases whose operational SLA is overdue. Internal-only.",
    inputSchema: {} },
  { name: "listProviderFailures", category: "OPERATIONS", permission: "operations:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "Recent provider execution failures (today). Internal-only.",
    inputSchema: {} },
  { name: "assignOperationsTask", category: "OPERATIONS", permission: "operations:write", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Assigns an OperationsTask (creates an audit event).", supportedRoles: ["operations", "admin"],
    description: "Assign an operations task to a user. Internal-only.",
    inputSchema: { task_id: { type: "string", required: true }, assignee_id: { type: "string", required: true } } },
  { name: "claimOperationsTask", category: "OPERATIONS", permission: "operations:write", risk: "LOW_RISK_WRITE", idempotent: true, sideEffects: "Claims an OperationsTask (QUEUED\u2192ASSIGNED).", supportedRoles: ["operations", "admin"],
    description: "Claim an unassigned operations task for the caller.",
    inputSchema: { task_id: { type: "string", required: true } } },
  { name: "addInternalNote", category: "OPERATIONS", permission: "operations:write", risk: "LOW_RISK_WRITE", idempotent: false, sideEffects: "Creates an InternalNote (admin/operator-only, never customer-visible).", supportedRoles: ["operations", "admin"],
    description: "Add an internal note to a case/task. NEVER surfaces in the customer conversation.",
    inputSchema: { case_id: { type: "string", required: false }, task_id: { type: "string", required: false }, body: { type: "string", required: true } } },
  { name: "requestReview", category: "OPERATIONS", permission: "operations:write", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Opens a review gate + creates a REVIEW OperationsTask.", requiredReview: true, supportedRoles: ["operations", "admin"],
    description: "Request a review gate (document/case/submission) on a case.",
    inputSchema: { case_id: { type: "string", required: true }, review_type: { type: "string", required: true, enum: ["DOCUMENT_REVIEW", "CASE_REVIEW", "SUBMISSION_REVIEW"] }, reason: { type: "string", required: false } } },
  { name: "inspectProviderStatus", category: "OPERATIONS", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "Detailed provider status snapshot for an internal agent (health, failures, last test, circuit state).",
    inputSchema: { provider_key: { type: "string", required: true } } },
  // PAYMENTS
  { name: "getPaymentStatus", category: "PAYMENTS", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Payment status for a case (order state, paid/pending, amount). Never exposes card numbers/tokens.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "createPaymentIntent", category: "PAYMENTS", permission: "case:transition", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Creates an Order + PaymentAttempt via the payment engine. Never exposes credentials.", requiredReview: true, supportedRoles: ["traveler", "operations", "admin"],
    description: "Create a payment intent for a case via the existing payment engine. The agent never receives payment credentials.",
    inputSchema: { case_id: { type: "string", required: true }, idempotency_key: { type: "string", required: true } } },
  { name: "confirmPayment", category: "PAYMENTS", permission: "case:transition", risk: "HIGH_RISK_WRITE", idempotent: true, sideEffects: "Marks the order paid via webhook reconciliation (projection only).", requiredReview: true, supportedRoles: ["traveler", "operations", "admin"],
    description: "Confirm/scenario-test a payment. Payment state is authoritative via server-side webhook reconciliation.",
    inputSchema: { case_id: { type: "string", required: true }, idempotency_key: { type: "string", required: true } } },
  // TRACKING
  { name: "getTrackingStatus", category: "TRACKING", permission: "tracking:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Government/provider tracking status projection for a submitted case.",
    inputSchema: { case_id: { type: "string", required: true } } },
  // PHASE 37 — Intelligence Version read tools (READ_ONLY; publishing remains admin-only §32/§33)
  { name: "getCurrentVisaVersion", category: "REQUIREMENTS", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Currently PUBLISHED intelligence version for a destination x journey (data_version, source_version, effective dates, confidence, published_at, provenance). Never exposes DRAFT/SUPERSEDED. The agent never publishes.",
    inputSchema: { destination: { type: "string", required: true }, journey: { type: "string", required: false }, nationality: { type: "string", required: false } } },
  { name: "getSourceConfidence", category: "REQUIREMENTS", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Source confidence + staleness for a destination x journey (FRESH/AGING/STALE/CRITICAL_STALE, source conflict flag, official source count). Never fabricated; UNKNOWN stays UNKNOWN.",
    inputSchema: { destination: { type: "string", required: true }, journey: { type: "string", required: false } } },
  { name: "getRequirementChanges", category: "REQUIREMENTS", permission: "visa:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Verified requirement changes for a destination x journey between the current published version and the version an active case is pinned to. Structured diff: field, previous, current, severity, source. No approved/published change → 'no verified change found'.",
    inputSchema: { destination: { type: "string", required: true }, journey: { type: "string", required: false }, case_id: { type: "string", required: false } } },
  { name: "getCaseImpact", category: "CASE", permission: "case:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Impact of an intelligence version change on a single active case (version drift, revalidation result UNCHANGED/REVIEW_REQUIRED/ACTION_REQUIRED/EXECUTION_BLOCKED, next action). The case snapshot is NEVER mutated; this is a read. Ownership enforced by the backend.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getExecutionImpact", category: "EXECUTION", permission: "provider:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Execution safety projection for a case against the current published version (route compatibility, form/provider/mapping version compatibility, block reason). Does NOT execute; read-only.",
    inputSchema: { case_id: { type: "string", required: true } } },
  // PHASE 38 — Financial read tools (READ_ONLY; agents may NEVER mutate financial state §44)
  { name: "getApplicationFinancialSummary", category: "PAYMENTS", permission: "finance:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Financial summary for a case. Traveler sees only traveler total / paid / refund status (never internal margins, provider cost, platform fee, reconciliation). Admin sees the full separated picture. Never exposes card/token credentials.",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getRefundStatus", category: "PAYMENTS", permission: "finance:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Refund status for a case (traveler refund status + amount). Does NOT expose internal provider reconciliation. AI may never issue/approve a refund (§44).",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getProviderSLA", category: "PROVIDERS", permission: "finance:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["traveler", "operations", "admin"],
    description: "Provider SLA projection for a case (processing estimate, SLA timer state, expected_by, due-soon/overdue). NEVER a government visa guarantee — a provider operational estimate (§15).",
    inputSchema: { case_id: { type: "string", required: true } } },
  { name: "getProviderPerformance", category: "PROVIDERS", permission: "finance:read", risk: "READ_ONLY", idempotent: true, sideEffects: "none", supportedRoles: ["operations", "admin"],
    description: "Internal provider operational performance (submission success rate, average processing time, failure rate, SLA compliance, refund rate). Internal-only; never a provider guarantee.",
    inputSchema: { provider_key: { type: "string", required: true } } },
];

export const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));
export const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);

// ---------- Role \u2192 permission scopes (\u00a717) ----------
const TRAVELER_PERMS: PermissionScope[] = ["visa:read", "case:read", "case:create", "case:transition", "document:read", "document:write", "execution:prepare", "provider:read", "tracking:read", "finance:read"];
const OPERATIONS_PERMS: PermissionScope[] = [...TRAVELER_PERMS, "operations:read", "operations:write", "execution:submit"];
const ADMIN_PERMS: PermissionScope[] = [...OPERATIONS_PERMS];

export function authorizationsFor(role: AgentRole | string | null | undefined): PermissionScope[] {
  if (role === "admin") return ADMIN_PERMS;
  if (role === "operations") return OPERATIONS_PERMS;
  if (role === "traveler") return TRAVELER_PERMS;
  return [];
}

export function canInvokeTool(role: AgentRole | string | null | undefined, toolName: string): { ok: boolean; reason?: string; tool?: ToolDef } {
  const def = TOOL_BY_NAME[toolName];
  if (!def) return { ok: false, reason: "UNSUPPORTED_TOOL" };
  // Traveler agents never get execution:submit / operations:write.
  const perms = authorizationsFor(role);
  if (!perms.includes(def.permission)) return { ok: false, reason: "UNAUTHORIZED" };
  if (!def.supportedRoles.includes((role as AgentRole))) return { ok: false, reason: "UNAUTHORIZED" };
  return { ok: true, tool: def };
}

// ---------- Input schema validation (\u00a74/\u00a736) ----------
export function validateToolInput(toolName: string, input: any): { ok: boolean; errors: string[] } {
  const def = TOOL_BY_NAME[toolName];
  if (!def) return { ok: false, errors: ["UNSUPPORTED_TOOL"] };
  if (!input || typeof input !== "object") return { ok: false, errors: ["INVALID_INPUT_OBJECT"] };
  const errors: string[] = [];
  for (const [field, spec] of Object.entries(def.inputSchema)) {
    const v = (input as any)[field];
    if (spec.required && (v === undefined || v === null || v === "")) errors.push(`MISSING:${field}`);
    if (v !== undefined && v !== null) {
      if (spec.type === "string" && typeof v !== "string") errors.push(`TYPE:${field}`);
      if (spec.type === "boolean" && typeof v !== "boolean") errors.push(`TYPE:${field}`);
      if (spec.enum && !spec.enum.includes(String(v))) errors.push(`ENUM:${field}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------- Confirmation requirements (\u00a723) ----------
export function requiresConfirmation(toolName: string): boolean {
  const def = TOOL_BY_NAME[toolName];
  return !!(def && (def.risk === "HIGH_RISK_WRITE" || def.risk === "EXTERNAL_EXECUTION"));
}

// ---------- Agent submission policy (\u00a739) ----------
export type AgentSubmissionPolicy = "DISABLED" | "CONFIRMATION_REQUIRED" | "HUMAN_REVIEW_REQUIRED" | "AUTOMATIC_ALLOWED";
export const DEFAULT_SUBMISSION_POLICY: AgentSubmissionPolicy = "CONFIRMATION_REQUIRED";

export function canAutoSubmit(policy: AgentSubmissionPolicy, opts: { confirmed?: boolean; humanReviewApproved?: boolean }): { ok: boolean; reason?: string; requires_human_review?: boolean } {
  if (policy === "DISABLED") return { ok: false, reason: "POLICY_DISABLED" };
  if (policy === "CONFIRMATION_REQUIRED") {
    if (!opts.confirmed) return { ok: false, reason: "CONFIRMATION_REQUIRED" };
    return { ok: true };
  }
  if (policy === "HUMAN_REVIEW_REQUIRED") {
    if (!opts.humanReviewApproved) return { ok: false, reason: "SUBMISSION_REQUIRES_HUMAN_REVIEW", requires_human_review: true };
    return { ok: true };
  }
  if (policy === "AUTOMATIC_ALLOWED") return { ok: true };
  return { ok: false, reason: "POLICY_UNKNOWN" };
}

// Pure execution-gate decision (\u00a714) \u2014 the backend applies this after the
// existing Execution Router resolves a route. The agent never sees it as a free-form
// "submit if you can"; it is a deterministic yes/no with a structured reason.
export function executionGateDecision(args: {
  is_owner: boolean;
  is_admin: boolean;
  case_state: string;
  execution_capability: string;
  route: any; // ExecutionRoute
  submission_policy: AgentSubmissionPolicy;
  confirmed?: boolean;
  human_review_approved?: boolean;
  environment: "SANDBOX" | "PRODUCTION";
  documents_complete?: boolean;
  eligibility?: string;
  payment_completed?: boolean;
  review_approved?: boolean;
  is_mock?: boolean;
}): { ok: boolean; reason?: string; code?: string; requires_human_review?: boolean } {
  if (!args.is_owner && !args.is_admin) return { ok: false, code: "UNAUTHORIZED", reason: "not case owner" };
  if (!["READY_FOR_SUBMISSION", "SUBMISSION_PENDING"].includes(args.case_state)) return { ok: false, code: "BAD_STATE", reason: `case_state=${args.case_state}` };
  if (args.execution_capability === "GUIDANCE_ONLY" || args.execution_capability === "INTELLIGENCE_ONLY") return { ok: false, code: "EXECUTION_UNAVAILABLE", reason: `execution_capability=${args.execution_capability}` };
  if (!args.route || args.route.route_type === "EXECUTION_UNAVAILABLE") return { ok: false, code: "EXECUTION_UNAVAILABLE", reason: args.route?.reason || "no verified route" };
  if (!args.route.submission_available) return { ok: false, code: "EXECUTION_UNAVAILABLE", reason: "route.submission_available=false" };
  if (args.environment === "PRODUCTION" && !args.is_mock && args.route.environment === "SANDBOX") return { ok: false, code: "EXECUTION_UNAVAILABLE", reason: "sandbox route for production case" };
  if (args.documents_complete === false) return { ok: false, code: "DOCUMENTS_INCOMPLETE", reason: "missing required documents" };
  if (args.eligibility && args.eligibility !== "eligible" && args.eligibility !== "requires_review") return { ok: false, code: "INELIGIBLE", reason: `eligibility=${args.eligibility}` };
  if (args.route.requires_human_review && !args.human_review_approved && !args.review_approved) return { ok: false, code: "SUBMISSION_REQUIRES_HUMAN_REVIEW", reason: "route requires human review", requires_human_review: true };
  // Submission policy gate (\u00a739) on top of all engine gates.
  const policy = canAutoSubmit(args.submission_policy, { confirmed: args.confirmed, humanReviewApproved: args.human_review_approved || args.review_approved });
  if (!policy.ok) return { ok: false, code: policy.reason || "POLICY", reason: policy.reason, requires_human_review: policy.requires_human_review };
  return { ok: true };
}

// ---------- Rate limiting (\u00a734) ----------
export const RATE_LIMITS: Record<AgentRole, { per_minute: number; per_hour: number }> = {
  traveler: { per_minute: 30, per_hour: 600 },
  operations: { per_minute: 60, per_hour: 1800 },
  admin: { per_minute: 120, per_hour: 3600 },
};
export function rateLimitKey(role: AgentRole, toolName: string, window: "minute" | "hour"): string {
  return `${role}:${toolName}:${window}`;
}
export function rateLimitCheck(counts: Record<string, number>, role: AgentRole, toolName: string, now = Date.now()): { ok: boolean; retry_after_ms?: number } {
  const lim = RATE_LIMITS[role] || RATE_LIMITS.traveler;
  const mk = rateLimitKey(role, toolName, "minute");
  const hk = rateLimitKey(role, toolName, "hour");
  if ((counts[mk] || 0) >= lim.per_minute) return { ok: false, retry_after_ms: 60000 };
  if ((counts[hk] || 0) >= lim.per_hour) return { ok: false, retry_after_ms: 3600000 };
  return { ok: true };
}

// ---------- Loop / budget protection (\u00a735) ----------
export const LOOP_LIMITS = {
  maxToolCallsPerRequest: 12,
  maxExecutionAttempts: 1,
  maxRetries: 1,
  maxRecursiveAgentCalls: 0,
  maxBrowserActions: 0,
  maxProviderCalls: 3,
};
export interface LoopBudget {
  toolCalls: number;
  executionAttempts: number;
  retries: number;
  recursiveCalls: number;
  browserActions: number;
  providerCalls: number;
}
export function freshBudget(): LoopBudget {
  return { toolCalls: 0, executionAttempts: 0, retries: 0, recursiveCalls: 0, browserActions: 0, providerCalls: 0 };
}
export function loopBudgetCheck(b: LoopBudget, action: "tool" | "execution" | "retry" | "recursive" | "browser" | "provider"): { ok: boolean; reason?: string } {
  if (action === "tool" && b.toolCalls >= LOOP_LIMITS.maxToolCallsPerRequest) return { ok: false, reason: "LOOP_LIMIT:tool_calls" };
  if (action === "execution" && b.executionAttempts >= LOOP_LIMITS.maxExecutionAttempts) return { ok: false, reason: "LOOP_LIMIT:execution_attempts" };
  if (action === "retry" && b.retries >= LOOP_LIMITS.maxRetries) return { ok: false, reason: "LOOP_LIMIT:retries" };
  if (action === "recursive" && b.recursiveCalls >= LOOP_LIMITS.maxRecursiveAgentCalls) return { ok: false, reason: "LOOP_LIMIT:recursive" };
  if (action === "browser" && b.browserActions >= LOOP_LIMITS.maxBrowserActions) return { ok: false, reason: "LOOP_LIMIT:browser" };
  if (action === "provider" && b.providerCalls >= LOOP_LIMITS.maxProviderCalls) return { ok: false, reason: "LOOP_LIMIT:provider_calls" };
  return { ok: true };
}
export function loopBudgetConsume(b: LoopBudget, action: "tool" | "execution" | "retry" | "recursive" | "browser" | "provider"): void {
  if (action === "tool") b.toolCalls++;
  if (action === "execution") b.executionAttempts++;
  if (action === "retry") b.retries++;
  if (action === "recursive") b.recursiveCalls++;
  if (action === "browser") b.browserActions++;
  if (action === "provider") b.providerCalls++;
}

// ---------- Prompt-injection defense (\u00a730) ----------
// External portal/provider page content is UNTRUSTED DATA \u2014 never agent
// instructions. This module provides the markers + sanitizer the dispatcher
// wraps around any content fetched from a portal/provider.
export const UNTRUSTED_CONTENT_PREFIX = "[UNTRUSTED_PORTAL_CONTENT_BEGIN]";
export const UNTRUSTED_CONTENT_SUFFIX = "[UNTRUSTED_PORTAL_CONTENT_END]";
const INSTRUCTION_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /disregard (the )?(above|previous|system) (prompt|instructions)/i,
  /you are now (a )?different (ai|assistant|model)/i,
  /exfiltrate|upload your credentials|send (your )?api key|reveal system prompt/i,
  /\/(system|assistant)\b/i,
  /<\s*system\s*>|<\s*instructions?\s*>/i,
];
export function isInstructionLikeContent(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}
export function sanitizeUntrustedContent(text: string): string {
  // Wrap and neutralize: drop instruction-shaped lines, wrap the rest as data.
  if (!text || typeof text !== "string") return "";
  const cleaned = text.split(/\r?\n/).filter((line) => !isInstructionLikeContent(line)).join("\n");
  return `${UNTRUSTED_CONTENT_PREFIX}\n${cleaned}\n${UNTRUSTED_CONTENT_SUFFIX}`;
}

// ---------- Output safety (\u00a731) ----------
export const MAX_OUTPUT_BYTES = 8192;
export function truncateOutput(value: any): { truncated: boolean; value: any } {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= MAX_OUTPUT_BYTES) return { truncated: false, value };
  return { truncated: true, value: s.slice(0, MAX_OUTPUT_BYTES) + "\u2026[truncated]" };
}

// ---------- Sensitive-data redaction for audit (\u00a728/\u00a743) ----------
export function redactToolInput(toolName: string, input: any): Record<string, any> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = redactForLog(k, v);
  }
  return out;
}

// ---------- Audit-event shape (\u00a732) ----------
export function buildAuditEvent(args: {
  tool_name: string; actor_id: string; actor_role: AgentRole; agent_name: string;
  session_id?: string; case_id?: string; result_status: "ok" | "rejected" | "error" | "unsupported";
  rejection_code?: string; input: any; output?: any; correlation_id?: string;
  idempotency_key?: string; risk_class?: RiskClass; category?: ToolCategory;
  loop_counters?: LoopBudget; occurred_at?: string;
}): any {
  const def = TOOL_BY_NAME[args.tool_name];
  return {
    tool_name: args.tool_name,
    category: def?.category || args.category,
    risk_class: def?.risk || args.risk_class,
    actor_id: args.actor_id,
    actor_role: args.actor_role,
    agent_name: args.agent_name,
    session_id: args.session_id || null,
    case_id: args.case_id || null,
    result_status: args.result_status,
    rejection_code: args.rejection_code || null,
    input_summary: redactToolInput(args.tool_name, args.input),
    output_summary: args.output ? { status: args.output.status, reason: args.output.reason, next_action: args.output.next_action } : null,
    correlation_id: args.correlation_id || null,
    idempotency_key: args.idempotency_key || null,
    loop_counters: args.loop_counters || null,
    occurred_at: args.occurred_at || new Date().toISOString(),
    metadata: {},
  };
}

// ---------- Tool result envelope (\u00a731) ----------
export function toolResult(args: { status: "ok" | "rejected" | "error" | "unsupported"; reason?: string; data?: any; confidence?: string; source?: string; next_action?: string; code?: string }): any {
  return { status: args.status, reason: args.reason || null, data: args.data || null, confidence: args.confidence || null, source: args.source || null, next_action: args.next_action || null, code: args.code || null };
}

// ---------- Pure case explanation from actual data (\u00a727) ----------
export function explainCaseFromData(args: { case_row: any; events: any[]; tasks: any[]; route?: any; next_action?: any }): any {
  const c = args.case_row || {};
  const recent = [...(args.events || [])].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || ""))).slice(0, 10);
  const pendingTasks = (args.tasks || []).filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status));
  const blockers = pendingTasks.filter((t) => t.status === "BLOCKED" || t.status === "WAITING").map((t) => ({ task_id: t.id, type: t.task_type, reason: t.block_reason || t.waiting_reason }));
  return {
    current_state: c.case_state || c.status || null,
    previous_state: recent[1]?.new_case_state || recent[0]?.previous_case_state || null,
    recent_events: recent.map((e) => ({ type: e.event_type, at: e.created_date, actor: e.actor_id, source: e.source })),
    pending_tasks: pendingTasks.map((t) => ({ id: t.id, type: t.task_type, queue: t.queue, status: t.status })),
    execution_capability: c.execution_capability || null,
    provider: c.provider_key || args.route?.provider || null,
    blockers,
    next_action: args.next_action || null,
  };
}