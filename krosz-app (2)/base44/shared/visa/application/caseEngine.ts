// Worldz Visa (Phase 27) \u2014 Application Case Engine.
//
// ONE Travel Entry Engine remains the sole source of visa truth (\u00a71). This engine
// CONSUMES a resolved Travel Entry result and never recomputes visa requirements,
// eligibility, execution capability, or provider selection. It owns the durable
// application case: a strict state machine, an immutable creation snapshot, review
// gates, idempotency, provider-status normalization, a derived timeline, and
// deterministic ownership. Government visa truth is never modified here.
//
// Pure (no DB) so the contract suite exercises the real state machine directly.

export type CaseState =
  | "DRAFT" | "INTAKE" | "ELIGIBILITY_REVIEW" | "DOCUMENTS_REQUIRED"
  | "DOCUMENTS_REVIEW" | "READY_FOR_SUBMISSION" | "REVIEW_REQUIRED"
  | "SUBMISSION_PENDING" | "SUBMITTED" | "PROCESSING"
  | "ADDITIONAL_INFORMATION_REQUIRED" | "APPROVED" | "REJECTED"
  | "CANCELLED" | "EXPIRED" | "COMPLETED";

export const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  DRAFT: ["INTAKE", "CANCELLED"],
  INTAKE: ["ELIGIBILITY_REVIEW", "CANCELLED"],
  ELIGIBILITY_REVIEW: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "REVIEW_REQUIRED", "CANCELLED"],
  DOCUMENTS_REQUIRED: ["DOCUMENTS_REVIEW", "REVIEW_REQUIRED", "EXPIRED", "CANCELLED"],
  DOCUMENTS_REVIEW: ["READY_FOR_SUBMISSION", "DOCUMENTS_REQUIRED", "REVIEW_REQUIRED", "CANCELLED"],
  READY_FOR_SUBMISSION: ["SUBMISSION_PENDING", "REVIEW_REQUIRED", "CANCELLED"],
  REVIEW_REQUIRED: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "READY_FOR_SUBMISSION", "SUBMISSION_PENDING", "CANCELLED"],
  SUBMISSION_PENDING: ["SUBMITTED", "READY_FOR_SUBMISSION", "REVIEW_REQUIRED", "CANCELLED"],
  SUBMITTED: ["PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED", "CANCELLED"],
  PROCESSING: ["ADDITIONAL_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "CANCELLED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["DOCUMENTS_REQUIRED", "DOCUMENTS_REVIEW", "CANCELLED"],
  APPROVED: ["COMPLETED"],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  COMPLETED: [],
};

export const TERMINAL_CASE: CaseState[] = ["REJECTED", "CANCELLED", "EXPIRED", "COMPLETED"];

export function canTransitionCase(from: CaseState | string, to: CaseState | string): boolean {
  return (CASE_TRANSITIONS[from as CaseState] || []).includes(to as CaseState);
}

export type ExecutionCapability = "GUIDANCE_ONLY" | "INTELLIGENCE_ONLY" | "PARTIAL_ASSIST" | "DOCUMENT_ASSIST" | "APPLICATION_ASSIST" | "END_TO_END" | "UNKNOWN";

export interface CaseSnapshot {
  readonly country: string;
  readonly journey: string;
  readonly nationality: string;
  readonly purpose?: string;
  readonly eligibility: any;
  readonly requirements: any;
  readonly document_requirements: any[];
  readonly official_source: any;
  readonly provider: any;
  readonly provider_capability: any;
  readonly execution_capability: ExecutionCapability;
  readonly route_status?: string;
  readonly fee: any;
  readonly processing: any;
  readonly passport_policy?: any;
  readonly photo_policy?: any;
  readonly arrival_policy?: any;
  readonly travel_policy?: any;
  readonly supporting_visa_policy?: any;
  readonly verification_status: string;
  readonly confidence: string;
  readonly resolved_at: string;
  readonly snapshot_hash: string;
}

export interface ReviewGate {
  gate_type: string;
  status: "OPEN" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  requested_by: string;
  assigned_to?: string;
  created_at: string;
  resolved_at?: string;
  decision?: string;
  notes?: string;
}

export interface CaseEvent {
  id: string;
  event_type: string;
  actor: string;
  occurred_at: string;
  from_state?: CaseState;
  to_state?: CaseState;
  reason?: string;
  source?: string;
  idempotency_key?: string;
  metadata?: any;
}

export interface ApplicationCase {
  id: string;
  traveler_id: string;
  user_id: string;
  country: string;
  journey: string;
  nationality: string;
  state: CaseState;
  normalized_status: CaseState;
  execution_capability: ExecutionCapability;
  snapshot: CaseSnapshot;
  provider_snapshot?: { provider_key?: string; provider_verified?: boolean; commercial_authorized?: boolean; route_status?: string };
  review?: ReviewGate;
  review_approved?: boolean;
  ownership: { traveler_owner: string; operations_owner?: string; reviewer?: string; provider?: string };
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  completed_at?: string;
  closed_at?: string;
  data_version: number;
  events: CaseEvent[];
}

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---- Immutable snapshot (\u00a75) ----
export function createSnapshot(entryResult: any, resolvedAt = new Date().toISOString()): CaseSnapshot {
  const s: any = {
    country: entryResult?.input?.destination || entryResult?.destination?.code || null,
    journey: entryResult?.journey_type || null,
    nationality: entryResult?.input?.nationality || "IN",
    purpose: entryResult?.input?.purpose || null,
    eligibility: { ready_for_public: entryResult?.ready_for_public, outcome: entryResult?.outcome, visa_required: entryResult?.visa_required },
    requirements: entryResult?.conditions || [],
    document_requirements: entryResult?.documents || [],
    official_source: entryResult?.source || null,
    provider: entryResult?.capability?.provider_composition || null,
    provider_capability: entryResult?.capability?.provider_capabilities || null,
    execution_capability: entryResult?.execution_capability || "GUIDANCE_ONLY",
    route_status: entryResult?.route_status || null,
    fee: entryResult?.fees || null,
    processing: entryResult?.capability ? { max_stay_days: entryResult?.max_stay_days, validity_days: entryResult?.capability?.validity_days } : null,
    passport_policy: entryResult?.capability?.passport_policy || { min_validity_months: entryResult?.capability?.passport_validity_min_months ?? null, policy_version: entryResult?.rule_version || null, source: entryResult?.source?.url || entryResult?.source?.name || null },
    photo_policy: entryResult?.capability?.photo_policy || {},
    arrival_policy: entryResult?.capability?.arrival_policy || {},
    travel_policy: entryResult?.capability?.travel_policy || { max_stay_days: entryResult?.max_stay_days ?? null, return_ticket_required: !!entryResult?.capability?.return_ticket_required, accommodation_required: !!entryResult?.capability?.accommodation_required },
    supporting_visa_policy: entryResult?.capability?.supporting_visa_policy || {},
    verification_status: entryResult?.verification_status || "INVENTORIED",
    confidence: entryResult?.data_confidence || "UNKNOWN",
    resolved_at: resolvedAt,
  };
  // Deep clone so later Travel Entry mutations never silently rewrite an existing case (\u00a75/P27-15).
  const snap: any = JSON.parse(JSON.stringify(s));
  snap.snapshot_hash = "snap_" + djb2(JSON.stringify(snap));
  return Object.freeze(snap);
}

function extractProviderSnapshot(entry: any): any {
  return { provider_key: entry?.provider || null, provider_verified: false, commercial_authorized: false, route_status: entry?.route_status || null };
}

// ---- Case creation (\u00a711) ----
export function createCase(input: { entryResult: any; traveler_id: string; user_id: string; provider_snapshot?: any; resolvedAt?: string }): ApplicationCase {
  const snap = createSnapshot(input.entryResult, input.resolvedAt);
  const now = input.resolvedAt || new Date().toISOString();
  const id = `case_${djb2(input.traveler_id + "|" + snap.country + "|" + now)}`;
  const c: ApplicationCase = {
    id, traveler_id: input.traveler_id, user_id: input.user_id,
    country: snap.country, journey: snap.journey || "OTHER", nationality: snap.nationality,
    state: "DRAFT", normalized_status: "DRAFT",
    execution_capability: snap.execution_capability as ExecutionCapability,
    snapshot: snap,
    provider_snapshot: input.provider_snapshot || extractProviderSnapshot(input.entryResult),
    ownership: { traveler_owner: input.traveler_id },
    created_at: now, updated_at: now, data_version: 1,
    events: [{ id: `evt_${djb2(now + "created")}`, event_type: "CASE_CREATED", actor: input.user_id, occurred_at: now, to_state: "DRAFT", reason: "Case created from Travel Entry resolution", source: "case_engine", idempotency_key: null, metadata: { execution_capability: snap.execution_capability } }],
  };
  return c;
}

// ---- Execution capability controls the case (\u00a712) ----
export function submissionAllowed(c: ApplicationCase): { ok: boolean; reason: string; code?: string } {
  const ec = (c.execution_capability || c.snapshot?.execution_capability || "GUIDANCE_ONLY") as ExecutionCapability;
  if (ec === "GUIDANCE_ONLY") return { ok: false, reason: "Guidance-only journeys cannot be submitted automatically", code: "GUIDANCE_ONLY" };
  if (ec === "INTELLIGENCE_ONLY") return { ok: false, reason: "Intelligence-only journeys cannot be submitted automatically", code: "INTELLIGENCE_ONLY" };
  if (ec === "END_TO_END") {
    const p = c.provider_snapshot || {};
    if (!p.provider_verified) return { ok: false, reason: "Provider not verified", code: "PROVIDER_UNVERIFIED" };
    if (!p.commercial_authorized) return { ok: false, reason: "Commercial authorization missing", code: "NOT_AUTHORIZED" };
  }
  if (ec === "PARTIAL_ASSIST" || ec === "APPLICATION_ASSIST") {
    if (!c.review_approved) return { ok: false, reason: `${ec} requires review-gate approval before submission`, code: "REVIEW_REQUIRED" };
  }
  return { ok: true, reason: "Submission allowed" };
}

function stateToEvent(to: CaseState): string {
  const m: Record<CaseState, string> = {
    DRAFT: "CASE_CREATED", INTAKE: "INTAKE_STARTED", ELIGIBILITY_REVIEW: "ELIGIBILITY_REVIEWED",
    DOCUMENTS_REQUIRED: "DOCUMENT_REQUESTED", DOCUMENTS_REVIEW: "DOCUMENT_RECEIVED", READY_FOR_SUBMISSION: "DOCUMENT_REVIEWED",
    REVIEW_REQUIRED: "REVIEW_REQUESTED", SUBMISSION_PENDING: "SUBMISSION_REQUESTED", SUBMITTED: "SUBMITTED",
    PROCESSING: "STATUS_CHANGED", ADDITIONAL_INFORMATION_REQUIRED: "ADDITIONAL_INFORMATION_REQUESTED",
    APPROVED: "APPROVED", REJECTED: "REJECTED", CANCELLED: "CANCELLED", EXPIRED: "STATUS_CHANGED", COMPLETED: "COMPLETED",
  };
  return m[to] || "STATUS_CHANGED";
}

// ---- Transitions (\u00a73/\u00a74) ----
export function transitionCase(c: ApplicationCase, to: CaseState, opts: { actor: string; reason?: string; source?: string; idempotency_key?: string; metadata?: any }): { ok: boolean; error?: string; code?: string; case?: ApplicationCase; event?: CaseEvent } {
  const from = c.state;
  if (TERMINAL_CASE.includes(from)) return { ok: false, error: `Case is terminal (${from})`, code: "TERMINAL" };
  if (!canTransitionCase(from, to)) return { ok: false, error: `Invalid transition ${from} -> ${to}`, code: "BAD_TRANSITION" };
  if (to === "SUBMISSION_PENDING" || to === "SUBMITTED") {
    const s = submissionAllowed(c);
    if (!s.ok) return { ok: false, error: s.reason, code: s.code };
  }
  const now = new Date().toISOString();
  const evt: CaseEvent = { id: `evt_${djb2(now + Math.random())}`, event_type: stateToEvent(to), actor: opts.actor, occurred_at: now, from_state: from, to_state: to, reason: opts.reason || null, source: opts.source || "case_engine", idempotency_key: opts.idempotency_key || null, metadata: opts.metadata || {} };
  const next: ApplicationCase = { ...c, state: to, normalized_status: to, updated_at: now, data_version: c.data_version + 1 };
  if (to === "SUBMITTED") next.submitted_at = now;
  if (to === "APPROVED") next.completed_at = now;
  if (TERMINAL_CASE.includes(to)) next.closed_at = now;
  next.events = [...c.events, evt];
  if (to === "SUBMISSION_PENDING") next.review = undefined;
  return { ok: true, case: next, event: evt };
}

// ---- Review gates (\u00a76) ----
export function requestReview(c: ApplicationCase, gateType: string, requestedBy: string, assignedTo?: string): ApplicationCase {
  const now = new Date().toISOString();
  const gate: ReviewGate = { gate_type: gateType, status: "OPEN", requested_by: requestedBy, assigned_to: assignedTo, created_at: now };
  const evt: CaseEvent = { id: `evt_${djb2(now + gateType)}`, event_type: "REVIEW_REQUESTED", actor: requestedBy, occurred_at: now, from_state: c.state, to_state: "REVIEW_REQUIRED", reason: `Review requested: ${gateType}`, source: "case_engine" };
  const state: CaseState = canTransitionCase(c.state, "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : c.state;
  return { ...c, state, review: gate, events: [...c.events, evt], updated_at: now, data_version: c.data_version + 1 };
}
export function resolveReview(c: ApplicationCase, decision: "APPROVED" | "REJECTED" | "REQUEST_CHANGES", resolvedBy: string, notes?: string): ApplicationCase {
  const now = new Date().toISOString();
  const gate: ReviewGate = { ...(c.review || { gate_type: "UNKNOWN", status: "OPEN", requested_by: resolvedBy, created_at: now } as ReviewGate), status: decision === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : decision, resolved_at: now, decision, notes };
  const eventType = decision === "APPROVED" ? "REVIEW_APPROVED" : decision === "REJECTED" ? "REVIEW_REJECTED" : "REVIEW_REQUESTED";
  const evt: CaseEvent = { id: `evt_${djb2(now + decision)}`, event_type: eventType, actor: resolvedBy, occurred_at: now, from_state: c.state, to_state: c.state, reason: `Review ${decision.toLowerCase().replace("_", " ")}`, source: "case_engine" };
  return { ...c, review: gate, review_approved: decision === "APPROVED", events: [...c.events, evt], updated_at: now, data_version: c.data_version + 1 };
}

// ---- Idempotency (\u00a77) ----
export function idempotentAction<T>(store: Map<string, any>, key: string, fn: () => T): { created: boolean; result: T } {
  if (store.has(key)) return { created: false, result: store.get(key) as T };
  const r = fn();
  store.set(key, r);
  return { created: true, result: r };
}

// ---- Status normalization (\u00a78) ----
export function normalizeProviderStatus(raw: string, _provider?: string): { normalized: CaseState; raw: string } {
  const s = String(raw || "").toUpperCase();
  if (/UNDER.?REVIEW|IN.?REVIEW|REVIEW|PROCESSING|IN.?PROGRESS|PENDING/.test(s)) return { normalized: "PROCESSING", raw };
  if (/ACTION.?REQUIRED|ADDITIONAL|MORE.?INFO|INFO.?REQUEST/.test(s)) return { normalized: "ADDITIONAL_INFORMATION_REQUIRED", raw };
  if (/APPROVED|SUCCESS|GRANTED|ISSUED|VISA_ISSUED/.test(s)) return { normalized: "APPROVED", raw };
  if (/REJECTED|DENIED|REFUSED|DECLINED/.test(s)) return { normalized: "REJECTED", raw };
  if (/CANCELLED|WITHDRAWN|CANCELED/.test(s)) return { normalized: "CANCELLED", raw };
  if (/SUBMITTED|RECEIVED|ACCEPTED/.test(s)) return { normalized: "SUBMITTED", raw };
  if (/COMPLETED|DONE|FINALIZED/.test(s)) return { normalized: "COMPLETED", raw };
  return { normalized: "PROCESSING", raw };
}

// ---- Webhook ingestion (idempotent + normalized) (\u00a78/\u00a714) ----
export function ingestProviderWebhook(c: ApplicationCase, raw: string, opts: { actor?: string; idempotency_key?: string; provider_request_id?: string }): { case: ApplicationCase; event?: CaseEvent; dedup: boolean; normalized: CaseState } {
  const key = opts.idempotency_key || `wh_${djb2(raw + (opts.provider_request_id || "") + c.id)}`;
  const existing = c.events.find((e) => e.idempotency_key === key && e.event_type === "STATUS_CHANGED");
  if (existing) return { case: c, dedup: true, normalized: (existing.metadata as any)?.normalized };
  const { normalized } = normalizeProviderStatus(raw);
  const now = new Date().toISOString();
  const evt: CaseEvent = { id: `evt_${djb2(now + key)}`, event_type: "STATUS_CHANGED", actor: opts.actor || "provider", occurred_at: now, from_state: c.state, to_state: normalized, reason: `Provider status: ${raw}`, source: "provider_webhook", idempotency_key: key, metadata: { normalized, raw, provider_request_id: opts.provider_request_id } };
  return { case: { ...c, events: [...c.events, evt], updated_at: now }, event: evt, dedup: false, normalized };
}

// ---- Timeline (\u00a79) ----
export function deriveTimeline(events: CaseEvent[]): { at: string; type: string; title: string }[] {
  const titles: Record<string, string> = {
    CASE_CREATED: "Application created", INTAKE_STARTED: "Intake started", ELIGIBILITY_REVIEWED: "Eligibility reviewed",
    DOCUMENT_REQUESTED: "Documents requested", DOCUMENT_RECEIVED: "Document received", DOCUMENT_REVIEWED: "Documents reviewed",
    REVIEW_REQUESTED: "Review requested", REVIEW_APPROVED: "Review approved", REVIEW_REJECTED: "Review rejected",
    SUBMISSION_REQUESTED: "Submission requested", SUBMITTED: "Application submitted", STATUS_CHANGED: "Status updated",
    ADDITIONAL_INFORMATION_REQUESTED: "Additional information requested", APPROVED: "Visa approved", REJECTED: "Visa rejected",
    CANCELLED: "Application cancelled", COMPLETED: "Application completed",
  };
  return [...events].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))).map((e) => ({ at: e.occurred_at, type: e.event_type, title: titles[e.event_type] || "Status updated" }));
}

// ---- Ownership (\u00a710/\u00a727) ----
export function canAccessCase(c: ApplicationCase, user: { id: string; role?: string }): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (c.user_id === user.id) return true;
  if (c.ownership?.operations_owner === user.id) return true;
  return false;
}
export function assignOwner(c: ApplicationCase, role: "operations_owner" | "reviewer" | "provider", assignee: string, actor: string): ApplicationCase {
  const now = new Date().toISOString();
  const evt: CaseEvent = { id: `evt_${djb2(now + "assign")}`, event_type: "STATUS_CHANGED", actor, occurred_at: now, reason: `Ownership ${role} -> ${assignee}`, source: "case_engine", metadata: { role, assignee } };
  return { ...c, ownership: { ...c.ownership, [role]: assignee }, events: [...c.events, evt], updated_at: now };
}

// ---- Expiration (\u00a73) ----
export function expireCase(c: ApplicationCase): { ok: boolean; case?: ApplicationCase } {
  if (!canTransitionCase(c.state, "EXPIRED")) return { ok: false };
  return transitionCase(c, "EXPIRED", { actor: "system", reason: "Case expired (deadline passed)" });
}

export const __caseEngine = { createCase, createSnapshot, transitionCase, canTransitionCase, submissionAllowed, normalizeProviderStatus, ingestProviderWebhook, deriveTimeline, canAccessCase, idempotentAction, requestReview, resolveReview, assignOwner, expireCase, CASE_TRANSITIONS, TERMINAL_CASE };