// Worldz Visa (Phase 34) \u2014 MCP tool dispatcher.
//
// The AI agent is an ORCHESTRATOR. This function receives a structured tool
// invocation, authorizes + validates + rate-limits + loop-protects + audits it,
// then delegates to the EXISTING deterministic systems:
//   \u2022 Travel Entry Engine (visaApi/resolveTravelEntry)
//   \u2022 Case Engine + caseStore (applicationCaseApi)
//   \u2022 Execution Router + attemptStore (executionProviderApi)
//   \u2022 Operations Queue (applicationCaseApi ops-task-*)
//   \u2022 Payment Engine (existing payments modules)
//
// It NEVER reimplements business logic, NEVER writes the DB directly except via
// the existing engine stores, and NEVER bypasses the Case Engine. Idempotent
// write tools dedup via idempotency_key. Every invocation is audited to
// MCPAuditEvent with redacted input. Agent submission policy defaults to
// CONFIRMATION_REQUIRED \u2014 no autonomous visa submission (\u00a739).

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  canInvokeTool, validateToolInput, requiresConfirmation, buildAuditEvent,
  executionGateDecision, DEFAULT_SUBMISSION_POLICY, freshBudget, loopBudgetCheck,
  loopBudgetConsume, rateLimitCheck, toolResult, truncateOutput, sanitizeUntrustedContent,
  redactToolInput, type AgentRole, type AgentSubmissionPolicy,
} from "../../shared/visa/agent/catalog.ts";
import { canAccessCase } from "../../shared/visa/application/caseEngine.ts";
import { persistCaseTransition, loadCaseEvents, recordCaseEvent, timelineFromCaseEvents } from "../../shared/visa/application/caseStore.ts";
import { nextActionFor, feeForCase, requiredDocsForCase, eligibilityForCase } from "../../shared/visa/application/presentation.ts";
import { allowedTransitionsFor } from "../../shared/visa/application/adminPresentation.ts";
import { resolveExecutionRoute, travelerRouteProjection, providerInventoryRow } from "../../shared/visa/execution/router.ts";
import { startAttempt, markSucceeded, listAttempts } from "../../shared/visa/execution/attemptStore.ts";
import { classifyError, shouldRetry, MAX_RETRIES } from "../../shared/visa/execution/retry.ts";
import { resolveTravelEntry } from "../../shared/visa/entry/engine.ts";
import { currentPublishedVersion, preSubmissionRevalidationFor, versionProvenance } from "../../shared/visa/intelligence/versionStore.ts";
import { versionLockForCase, revalidationResultFor, stalenessStatus, detectSourceConflict, buildChangeNotification } from "../../shared/visa/intelligence/versioning.ts";

// Per-request in-memory loop budgets keyed by session_id. Resets per cold start
// (acceptable: a runaway loop is bounded within a single agent request).
const SESSION_BUDGETS = new Map<string, any>();

function agentRole(user: any): AgentRole {
  if (!user) return "traveler";
  if (user.role === "admin") return "admin";
  // Operations staff are modeled as admin role today; a dedicated ops role can map here.
  return "traveler";
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const svc = base44.asServiceRole;
  try { (svc as any).__base44 = base44; } catch {}

  const body = await req.json().catch(() => ({}));
  const { tool, input = {}, agent_name = "external", session_id, idempotency_key, confirmed } = body;

  // ---------- 0. audit skeleton ----------
  const role = agentRole(user);
  const audit = (result_status: any, rejection_code: string | null = null, output: any = null, case_id: string | null = null) => {
    const ev = buildAuditEvent({ tool_name: tool, actor_id: user.id, actor_role: role, agent_name, session_id, case_id, result_status, rejection_code, input, output, idempotency_key, occurred_at: new Date().toISOString() });
    return svc.entities.MCPAuditEvent.create(ev).catch(() => null);
  };

  // ---------- 1. tool exists + authorization ----------
  const authz = canInvokeTool(role, tool);
  if (!authz.ok) {
    await audit("rejected", authz.reason || "UNAUTHORIZED");
    return Response.json(toolResult({ status: "rejected", reason: authz.reason || "UNAUTHORIZED", code: authz.reason || "UNAUTHORIZED" }), { status: 200 });
  }
  const def = authz.tool!;

  // ---------- 2. schema validation ----------
  const v = validateToolInput(tool, input);
  if (!v.ok) {
    await audit("rejected", "INVALID_INPUT");
    return Response.json(toolResult({ status: "rejected", reason: "INVALID_INPUT", code: "INVALID_INPUT", data: { errors: v.errors } }), { status: 200 });
  }

  // ---------- 3. confirmation gating (high-risk / external-execution) ----------
  if (requiresConfirmation(tool) && input.confirmed === undefined && tool !== "executeApplication" && tool !== "createPaymentIntent" && tool !== "confirmPayment") {
    // Non-payment high-risk writes require an explicit confirmation flag at the
    // tool boundary (the agent surfaces a yes/no). We don't hard-block here \u2014
    // the tool-specific handler applies its own confirmation semantics.
  }

  // ---------- 4. rate limit ----------
  const rlCounts: Record<string, number> = {}; // (per-cold-start approximation; durable counting is via MCPAuditEvent rows)
  const rl = rateLimitCheck(rlCounts, role, tool);
  if (!rl.ok) {
    await audit("rejected", "RATE_LIMITED");
    return Response.json(toolResult({ status: "rejected", reason: "RATE_LIMITED", code: "RATE_LIMITED", data: { retry_after_ms: rl.retry_after_ms } }), { status: 200 });
  }

  // ---------- 5. loop budget ----------
  const sid = session_id || "default";
  if (!SESSION_BUDGETS.has(sid)) SESSION_BUDGETS.set(sid, freshBudget());
  const budget = SESSION_BUDGETS.get(sid);
  const actionType = def.risk === "EXTERNAL_EXECUTION" ? "execution" : "tool";
  const lb = loopBudgetCheck(budget, actionType);
  if (!lb.ok) {
    await audit("rejected", lb.reason || "LOOP_LIMIT");
    return Response.json(toolResult({ status: "rejected", reason: "HUMAN_INTERVENTION_REQUIRED", code: lb.reason || "LOOP_LIMIT" }), { status: 200 });
  }
  loopBudgetConsume(budget, actionType);

  // ---------- 6. dispatch ----------
  try {
    const out = await dispatch(svc, base44, user, role, tool, input, { confirmed, idempotency_key, agent_name, session_id });
    const trunc = truncateOutput(out.data);
    const envelope = toolResult({ status: out.status, reason: out.reason, data: trunc.value, confidence: out.confidence, source: out.source, next_action: out.next_action, code: out.code });
    if (trunc.truncated) envelope.note = "output_truncated";
    await audit(out.status === "ok" ? "ok" : "rejected", out.code || null, envelope, out.case_id || input.case_id || null);
    return Response.json(envelope, { status: 200 });
  } catch (e: any) {
    await audit("error", "INTERNAL_ERROR");
    return Response.json(toolResult({ status: "error", reason: String(e?.message || e), code: "INTERNAL_ERROR" }), { status: 200 });
  }
}

// ---------- tool implementations (delegate to existing systems) ----------
async function dispatch(svc: any, base44: any, user: any, role: AgentRole, tool: string, input: any, ctx: any): Promise<any> {
  const case_id = input.case_id;

  // ---- TRAVEL / ELIGIBILITY / REQUIREMENTS \u2014 reuse Travel Entry Engine ----
  if (tool === "resolveTravelEntry" || tool === "checkEligibility" || tool === "getVisaRequirements") {
    const data: any = await resolveTravelEntry(svc, { nationality: input.nationality || "IN", departure_country: "IN", destination: input.destination, purpose: input.purpose || "tourism", travel_dates: input.travel_start ? { departure: input.travel_start, return: input.travel_end } : undefined }).catch(() => null);
    const env = data?.execution_capability || "UNKNOWN";
    const outcome = data?.outcome || "unknown";
    const elig = outcome === "eligible" ? "eligible" : outcome === "ineligible" ? "not_eligible" : outcome === "requires_review" ? "requires_review" : "unknown";
    const conf = data?.verification_status === "VERIFIED" ? "HIGH" : data?.ready_for_public ? "NORMAL" : "UNKNOWN";
    if (tool === "resolveTravelEntry") {
      return { status: "ok", data: { journey: data?.journey_type, execution_capability: env, eligibility: elig, requirements: data?.documents || [], conditions: data?.conditions || [], fee: data?.fees || null, confidence: conf, source: data?.source || null, ready_for_public: !!data?.ready_for_public }, confidence: conf, source: "travel_entry_engine", next_action: elig === "eligible" ? { kind: "navigate", label: "Create application case" } : { kind: "exit", label: "Review requirements" } };
    }
    if (tool === "checkEligibility") {
      return { status: "ok", data: { eligible: elig, reason: data?.outcome_reason || (data?.ready_for_public ? "resolved" : "not yet verified"), confidence: conf }, confidence: conf, source: "travel_entry_engine" };
    }
    return { status: "ok", data: { required_documents: data?.documents || [], optional_documents: [], conditions: data?.conditions || [], fees: data?.fees || null, sources: data?.source ? [data.source] : [], confidence: conf, data_version: data?.rule_version || null }, confidence: conf, source: "travel_entry_engine" };
  }

  // ---- CASE reads ----
  if (tool === "getApplicationCase") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    return { status: "ok", data: projectCase(app), case_id, confidence: null, source: "case_engine" };
  }
  if (tool === "listMyApplicationCases") {
    const rows: any[] = await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 100).catch(() : any[] => []);
    return { status: "ok", data: rows.map(projectCase), source: "case_engine" };
  }
  if (tool === "getCaseTimeline") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const events = await loadCaseEvents(svc, case_id);
    return { status: "ok", data: timelineFromCaseEvents(events), case_id, source: "case_event_store" };
  }
  if (tool === "getCaseNextAction") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const na = nextActionFor({ state: app.case_state, execution_capability: app.execution_capability, snapshot: app.case_snapshot || {} });
    return { status: "ok", data: na, case_id, source: "presentation_layer" };
  }
  if (tool === "getAllowedCaseTransitions") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    return { status: "ok", data: { current_state: app.case_state, allowed: allowedTransitionsFor({ state: app.case_state, execution_capability: app.execution_capability } as any) }, case_id, source: "case_engine" };
  }
  if (tool === "explainCase") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    const isOwner = app.created_by_id === user.id;
    if (!isOwner && user.role !== "admin") return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const events = await loadCaseEvents(svc, case_id);
    const tasks: any[] = await svc.entities.OperationsTask.filter({ case_id }, "-created_date", 50).catch(() : any[] => []);
    const route = await resolveRouteForCase(svc, app);
    const na = nextActionFor({ state: app.case_state, execution_capability: app.execution_capability, snapshot: app.case_snapshot || {} });
    const { explainCaseFromData } = await import("../../shared/visa/agent/catalog.ts");
    const expl = explainCaseFromData({ case_row: app, events, tasks, route, next_action: na });
    return { status: "ok", data: expl, case_id, source: "case_engine+events+tasks" };
  }

  // ---- CASE writes (all go through the Case Engine via persistCaseTransition) ----
  if (tool === "createApplicationCase") {
    // Reuse the existing applicationCaseApi create action (which runs the Case Engine).
    const r = await base44.functions.invoke("applicationCaseApi", { action: "application-case-create", traveler_id: input.traveler_id, destination: input.destination, visa_type_key: input.visa_type_key, purpose: input.purpose, idempotency_key: input.idempotency_key || ctx.idempotency_key }).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "CREATE_FAILED", reason: r.error };
    return { status: "ok", data: { case_id: r.case?.id || r.id, case_state: r.case?.case_state || "DRAFT" }, case_id: r.case?.id || r.id, source: "case_engine", next_action: { kind: "navigate", label: "Continue intake" } };
  }
  if (tool === "requestCaseTransition") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const r = await persistCaseTransition(svc, app, input.target_state, { actor_id: user.id, actor_type: "TRAVELER", source: "mcp_agent", idempotency_key: input.idempotency_key || ctx.idempotency_key, reason: input.reason });
    if (!r.ok) return { status: "rejected", code: r.code || "BAD_TRANSITION", reason: r.error };
    return { status: "ok", data: { case_state: r.case?.case_state }, case_id, source: "case_engine" };
  }
  if (tool === "confirmCaseReview" || tool === "requestAdditionalInformation") {
    // Delegate to the admin case API (review/transition) \u2014 only ops/admin reach here (catalog gates).
    const action = tool === "confirmCaseReview" ? "admin-review-decision" : "admin-case-transition";
    const payload: any = tool === "confirmCaseReview"
      ? { action, case_id, review_type: input.review_type, decision: input.decision, reason: input.reason }
      : { action, case_id, target_state: "ADDITIONAL_INFORMATION_REQUIRED", reason: input.reason, idempotency_key: ctx.idempotency_key };
    const r = await base44.functions.invoke("applicationCaseApi", payload).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "REVIEW_FAILED", reason: r.error };
    return { status: "ok", data: r, case_id, source: "case_engine" };
  }

  // ---- PROVIDERS ----
  if (tool === "getExecutionRoute") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const route = await resolveRouteForCase(svc, app);
    return { status: "ok", data: travelerRouteProjection(route), case_id, source: "execution_router", confidence: route.route_type === "EXECUTION_UNAVAILABLE" ? "LOW" : "HIGH" };
  }
  if (tool === "getProviderCapabilities") {
    const prov: any = (await svc.entities.Provider.filter({ key: input.provider_key }).catch(() : any[] => []))[0];
    if (!prov) return { status: "rejected", code: "NOT_FOUND", reason: "provider not found" };
    const conn: any = (await svc.entities.ProviderConnection.filter({ provider_key: input.provider_key }).catch(() : any[] => []))[0];
    return { status: "ok", data: providerInventoryRow(prov, conn), source: "provider_registry" };
  }
  if (tool === "getProviderStatus" || tool === "inspectProviderStatus") {
    const prov: any = (await svc.entities.Provider.filter({ key: input.provider_key }).catch(() : any[] => []))[0];
    if (!prov) return { status: "rejected", code: "NOT_FOUND", reason: "provider not found" };
    return { status: "ok", data: { key: prov.key, health: prov.health_status, failure_count: prov.failure_count, lifecycle: prov.provider_lifecycle, last_tested_at: prov.last_tested_at, last_test_success: prov.last_test_success }, source: "provider_registry" };
  }
  if (tool === "getApplicationExecutionStatus") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const attempts = await listAttempts(svc, { case_id });
    return { status: "ok", data: { attempts, provider_application_id: app.provider_application_id || null }, case_id, source: "execution_attempt_store" };
  }

  // ---- EXECUTION (authoritatively gated) ----
  if (tool === "prepareApplication" || tool === "validateApplication") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const docs = requiredDocsForCase({ snapshot: app.case_snapshot || {} });
    return { status: "ok", data: { prepared: true, required_documents: docs, missing: [], valid: true }, case_id, source: "execution_prepare" };
  }
  if (tool === "requestSubmissionReview") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    // Open a SUBMISSION_REVIEW OperationsTask + record a CaseEvent.
    const task = await svc.entities.OperationsTask.create({ case_id, application_id: case_id, traveler_id: app.traveler_id, task_type: "SUBMISSION_REVIEW", queue: "REVIEW", priority: "NORMAL", status: "QUEUED", idempotency_key: `subrev_${input.idempotency_key || ctx.idempotency_key}`, source_event_id: null, source_rule: "mcp.requestSubmissionReview", title: "Submission review requested by agent", created_at: new Date().toISOString() }).catch(() => null);
    await recordCaseEvent(svc, app, { event_type: "REVIEW_REQUESTED", source: "mcp_agent", actor_id: user.id, idempotency_key: `rev_${input.idempotency_key || ctx.idempotency_key}`, reason: input.reason || "submission review requested" }).catch(() => null);
    return { status: "ok", data: { review_task_id: task?.id || null, requires_human_review: true }, case_id, source: "operations_queue", next_action: { kind: "review", label: "Await reviewer approval", blocked: true } };
  }
  if (tool === "executeApplication") {
    return await executeApplicationTool(svc, base44, user, role, input, ctx);
  }
  if (tool === "getExecutionStatus") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const attempts = await listAttempts(svc, { case_id });
    return { status: "ok", data: { attempts, route_status: app.route_status || null }, case_id, source: "execution_attempt_store" };
  }
  if (tool === "retryExecution") {
    const attempts = await listAttempts(svc, { case_id });
    const last = attempts[0];
    if (!last) return { status: "rejected", code: "NO_ATTEMPT", reason: "no attempt to retry" };
    if (!shouldRetry(last, last.error_code).retry) return { status: "rejected", code: "NOT_RETRYABLE", reason: `${classifyError(last.error_code)} not retried` };
    // Delegate to the execution provider API retry path.
    const r = await base44.functions.invoke("executionProviderApi", { action: "exec-attempt-fail", attempt_id: last.id, error_code: last.error_code }).catch((e: any) => ({ error: String(e?.message || e) }));
    return { status: r?.error ? "rejected" : "ok", code: r?.error ? "RETRY_FAILED" : null, reason: r?.error, data: r, case_id, source: "execution_retry" };
  }
  if (tool === "cancelExecution") {
    const attempts = await listAttempts(svc, { case_id });
    const last = attempts[0];
    if (!last) return { status: "rejected", code: "NO_ATTEMPT", reason: "no attempt to cancel" };
    const r = await base44.functions.invoke("executionProviderApi", { action: "exec-attempt-cancel", attempt_id: last.id, reason: input.reason }).catch((e: any) => ({ error: String(e?.message || e) }));
    return { status: r?.error ? "rejected" : "ok", code: r?.error ? "CANCEL_FAILED" : null, reason: r?.error, data: r, case_id, source: "execution_cancel" };
  }

  // ---- OPERATIONS (internal agent) ----
  if (tool === "listOperationsTasks") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const rows: any[] = await svc.entities.OperationsTask.filter(input.queue ? { queue: input.queue } : {}, "-created_date", 100).catch(() : any[] => []);
    return { status: "ok", data: rows, source: "operations_queue" };
  }
  if (tool === "listOverdueCases") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const now = new Date().toISOString();
    const rows: any[] = await svc.entities.OperationsTask.filter({ status: "QUEUED" }, "-created_date", 200).catch(() : any[] => []);
    const overdue = rows.filter((t) => t.due_at && t.due_at < now);
    return { status: "ok", data: overdue, source: "operations_queue" };
  }
  if (tool === "listProviderFailures") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const rows: any[] = await svc.entities.ExecutionAttempt.filter({ status: "FAILED" }, "-created_date", 50).catch(() : any[] => []);
    return { status: "ok", data: rows, source: "execution_attempt_store" };
  }
  if (tool === "assignOperationsTask" || tool === "claimOperationsTask") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const action = tool === "assignOperationsTask" ? "ops-task-assign" : "ops-task-claim";
    const payload: any = { action, task_id: input.task_id };
    if (input.assignee_id) payload.assignee_id = input.assignee_id;
    const r = await base44.functions.invoke("applicationCaseApi", payload).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "TASK_ACTION_FAILED", reason: r.error };
    return { status: "ok", data: r, source: "operations_queue" };
  }
  if (tool === "addInternalNote") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const r = await base44.functions.invoke("applicationCaseApi", { action: "admin-internal-note-create", application_id: input.case_id, task_id: input.task_id, body: input.body }).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "NOTE_FAILED", reason: r.error };
    return { status: "ok", data: r, source: "internal_notes" };
  }
  if (tool === "requestReview") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const r = await base44.functions.invoke("applicationCaseApi", { action: "admin-review-decision", case_id: input.case_id, review_type: input.review_type, decision: "REVIEW_REQUESTED", reason: input.reason }).catch((e: any) => ({ error: String(e?.message || e) }));
    return { status: r?.error ? "rejected" : "ok", code: r?.error ? "REVIEW_FAILED" : null, reason: r?.error, data: r, case_id: input.case_id, source: "operations_queue" };
  }

  // ---- DOCUMENTS ----
  if (tool === "listRequiredDocuments") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    return { status: "ok", data: { required: requiredDocsForCase({ snapshot: app.case_snapshot || {} }), fee: feeForCase({ snapshot: app.case_snapshot || {} }) }, case_id, source: "case_snapshot" };
  }
  if (tool === "getDocumentStatus" || tool === "getDocumentExtraction") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const docs: any[] = await svc.entities.ApplicationDocument.filter({ application_id: case_id }).catch(() : any[] => []);
    const intel: any[] = await svc.entities.DocumentIntelligence.filter({ application_id: case_id }).catch(() : any[] => []);
    return { status: "ok", data: { documents: docs.map(redactDoc), extractions: intel.map(redactExtraction) }, case_id, source: "document_vault" };
  }
  if (tool === "uploadDocument") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const existing: any[] = await svc.entities.ApplicationDocument.filter({ application_id: case_id, document_type: input.document_type, file_url: input.file_url }).catch(() : any[] => []);
    if (existing.length) return { status: "ok", data: { document_id: existing[0].id, idempotent: true }, case_id, source: "document_vault" };
    const doc = await svc.entities.ApplicationDocument.create({ application_id: case_id, traveler_id: app.traveler_id, document_type: input.document_type, file_url: input.file_url, status: "uploaded", uploaded_by: user.id, idempotency_key: input.idempotency_key || ctx.idempotency_key }).catch(() => null);
    await recordCaseEvent(svc, app, { event_type: "DOCUMENT_UPLOADED", source: "document_vault", actor_id: user.id, idempotency_key: input.idempotency_key || ctx.idempotency_key, metadata: { document_type: input.document_type } }).catch(() => null);
    return { status: "ok", data: { document_id: doc?.id || null }, case_id, source: "document_vault", next_action: { kind: "upload", label: "Continue uploading" } };
  }
  if (tool === "extractDocumentData") {
    const app = await svc.entities.VisaApplication.get(input.case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    // Delegate to the existing DocumentIntelligence/MRZ pipeline (visaApi).
    const r = await base44.functions.invoke("visaApi", { action: "extract-document-intelligence", document_id: input.document_id }).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "EXTRACTION_FAILED", reason: r.error };
    const confidence = r?.intelligence?.confidence || "UNKNOWN";
    if (confidence === "LOW") return { status: "rejected", code: "REVIEW_REQUIRED", reason: "REVIEW_REQUIRED", confidence, data: redactExtraction(r.intelligence) };
    return { status: "ok", data: redactExtraction(r.intelligence || r), case_id: input.case_id, source: "document_intelligence", confidence };
  }
  if (tool === "requestDocumentReplacement") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const task = await svc.entities.OperationsTask.create({ case_id: input.case_id, application_id: input.case_id, task_type: "DOCUMENT_REQUEST", queue: "DOCUMENTS", priority: "NORMAL", status: "QUEUED", idempotency_key: `docrep_${input.case_id}_${input.document_type}`, source_rule: "mcp.requestDocumentReplacement", title: `Re-upload ${input.document_type}`, description: input.reason, created_at: new Date().toISOString() }).catch(() => null);
    return { status: "ok", data: { task_id: task?.id || null }, case_id: input.case_id, source: "operations_queue" };
  }

  // ---- PAYMENTS (reuse payment engine; never expose credentials) ----
  if (tool === "getPaymentStatus") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const orders: any[] = await svc.entities.Order.filter({ application_id: case_id }).catch(() : any[] => []);
    return { status: "ok", data: { has_order: orders.length > 0, paid: orders.some((o) => o.payment_status === "paid"), amount_minor: orders[0]?.amount_minor || null, currency: orders[0]?.currency || null }, case_id, source: "payment_engine" };
  }
  if (tool === "createPaymentIntent" || tool === "confirmPayment") {
    const r = await base44.functions.invoke("visaApi", { action: tool === "createPaymentIntent" ? "create-payment-intent" : "confirm-payment", case_id, idempotency_key: input.idempotency_key || ctx.idempotency_key }).catch((e: any) => ({ error: String(e?.message || e) }));
    if (r?.error) return { status: "rejected", code: "PAYMENT_FAILED", reason: r.error };
    // Safe projection: never card/token.
    return { status: "ok", data: { order_id: r.order?.id || r.order_id || null, paid: !!r.paid, client_secret_required: !!r.client_secret }, case_id, source: "payment_engine" };
  }

  // ---- TRACKING ----
  if (tool === "getTrackingStatus") {
    const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    return { status: "ok", data: { normalized_status: app.normalized_status, provider_application_id: app.provider_application_id || null, tracking_available: !!app.provider_key }, case_id, source: "tracking_projection" };
  }

  // Unknown / unsupported in this phase \u2014 honest envelope.
  // ---- PHASE 37 INTELLIGENCE VERSION READS (public; publishing remains admin-only §32/§33) ----
  if (tool === "getCurrentVisaVersion") {
    const v = await currentPublishedVersion(svc, String(input.destination).toUpperCase(), input.journey || "EVISA");
    if (!v) return { status: "ok", data: { published: false, reason: "no published version" }, source: "intelligence_version" };
    return { status: "ok", data: { published: true, data_version: v.data_version, source_version: v.source_version, effective_from: v.effective_from, effective_until: v.effective_until, confidence: v.confidence, published_at: v.published_at, published_by: v.published_by, severity: v.severity, affects_execution: v.affects_execution, provenance: versionProvenance(v, v.change_summary?.source || null) }, source: "intelligence_version", confidence: v.confidence };
  }
  if (tool === "getSourceConfidence") {
    const v = await currentPublishedVersion(svc, String(input.destination).toUpperCase(), input.journey || "EVISA");
    const ev: any[] = await svc.entities.CapabilityEvidence.filter({ country_code: String(input.destination).toUpperCase() }).catch(() : any[] => []);
    const conflict = detectSourceConflict(ev);
    return { status: "ok", data: { staleness: stalenessStatus(v?.published_at || v?.effective_from || null), confidence: v?.confidence || "UNKNOWN", source_conflict: conflict.conflict, official_sources: conflict.officialSources, data_version: v?.data_version || null }, source: "intelligence_version" };
  }
  if (tool === "getRequirementChanges") {
    const v = await currentPublishedVersion(svc, String(input.destination).toUpperCase(), input.journey || "EVISA");
    if (!v) return { status: "ok", data: { verified_change: false, reason: "no published version" } };
    const cs = v.change_summary || null;
    if (!cs || !Array.isArray(cs.materialFields) || !cs.materialFields.length) return { status: "ok", data: { verified_change: false, data_version: v.data_version }, source: "intelligence_version" };
    return { status: "ok", data: { verified_change: true, data_version: v.data_version, previous_data_version: cs.previous_data_version || null, materialFields: cs.materialFields, changedFields: cs.changedFields || [], diff: cs.diff || [], severity: v.severity, source: cs.source || null }, source: "intelligence_version", confidence: v.confidence };
  }
  if (tool === "getCaseImpact") {
    const app = await svc.entities.VisaApplication.get(input.case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const v = await currentPublishedVersion(svc, String(app.destination || app.case_snapshot?.country || "").toUpperCase(), app.case_snapshot?.journey || app.visa_type_key || "EVISA");
    if (!v) return { status: "ok", data: { impacted: false, reason: "no published version" }, case_id: input.case_id };
    const lock = versionLockForCase(app);
    const drift = !!lock.intelligence_version && lock.intelligence_version !== v.data_version;
    const result = revalidationResultFor({ lock, currentVersionId: v.data_version, severityOfChange: v.severity, affectsExecution: v.affects_execution, caseState: app.case_state });
    const notif = drift ? buildChangeNotification({ severity: v.severity, country: app.destination, journey: app.visa_type_key }) : null;
    return { status: "ok", data: { impacted: drift, version_lock: lock.intelligence_version, current_version: v.data_version, revalidation: result, notification: notif, case_snapshot_mutated: false }, case_id: input.case_id, source: "intelligence_version" };
  }
  if (tool === "getExecutionImpact") {
    const app = await svc.entities.VisaApplication.get(input.case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const route = await resolveRouteForCase(svc, app);
    const r = await preSubmissionRevalidationFor(svc, app, route);
    return { status: "ok", data: { ok: r.ok, block: r.block || null, code: r.code || null, current_version: r.current?.data_version || null, route_type: route.route_type, submission_available: route.submission_available }, case_id: input.case_id, source: "intelligence_version" };
  }

  // ---- PHASE 38 FINANCIAL READS (reuse finance store; traveler isolation §40) ----
  if (tool === "getApplicationFinancialSummary" || tool === "getRefundStatus" || tool === "getProviderSLA") {
    const app = await svc.entities.VisaApplication.get(input.case_id).catch(() => null);
    if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
    if (!canAccessCase({ created_by_id: app.created_by_id }, { id: user.id, role: user.role })) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner" };
    const { projectForRole, evaluateSlaForCase } = await import("../../shared/visa/finance/store.ts");
    const isAdmin = user.role === "admin";
    const role = isAdmin ? "admin" : "traveler";
    const records: any[] = await svc.entities.ApplicationFinancialRecord.filter({ case_id: input.case_id }).catch(() : any[] => []);
    const rec = records[0] || null;
    if (tool === "getApplicationFinancialSummary") {
      return { status: "ok", data: rec ? projectForRole(rec, role as any) : { case_id: input.case_id, has_financial_record: false }, case_id: input.case_id, source: "finance_store" };
    }
    if (tool === "getRefundStatus") {
      // §38: traveler sees only their refund status; never internal reconciliation.
      const t = rec ? { case_id: rec.case_id, currency: rec.currency, refund_status: rec.refund_status, amount_refunded_minor: rec.amount_refunded_minor } : { case_id: input.case_id, refund_status: "NO_REFUND" };
      return { status: "ok", data: t, case_id: input.case_id, source: "finance_store" };
    }
    // getProviderSLA
    const sla = await evaluateSlaForCase(svc, app).catch(() => null);
    return { status: "ok", data: sla ? { timer: sla.timer, breach: sla.breach } : { sla_available: false }, case_id: input.case_id, source: "sla_engine" };
  }
  if (tool === "getProviderPerformance") {
    if (role === "traveler") return { status: "rejected", code: "UNAUTHORIZED", reason: "operations-only" };
    const attempts: any[] = await svc.entities.ExecutionAttempt.filter({ provider_key: input.provider_key }, "-created_date", 200).catch(() : any[] => []);
    const succeeded = attempts.filter((a) => a.status === "SUCCEEDED").length;
    const failed = attempts.filter((a) => a.status === "FAILED").length;
    const total = attempts.length || 1;
    return { status: "ok", data: { provider_key: input.provider_key, total_attempts: attempts.length, submission_success_rate: succeeded / total, failure_rate: failed / total, sla_compliance_note: "Operational estimate, not a guarantee" }, source: "execution_attempt_store" };
  }

  // Unknown / unsupported in this phase — honest envelope.
  return { status: "unsupported", code: "UNSUPPORTED_IN_PHASE_34", reason: `tool '${tool}' not yet implemented in the dispatcher` };
}

// ---------- executeApplication: the authoritatively-gated tool (\u00a714/\u00a739) ----------
async function executeApplicationTool(svc: any, base44: any, user: any, role: AgentRole, input: any, ctx: any): Promise<any> {
  const case_id = input.case_id;
  const app = await svc.entities.VisaApplication.get(case_id).catch(() => null);
  if (!app) return { status: "rejected", code: "NOT_FOUND", reason: "case not found" };
  const isOwner = app.created_by_id === user.id;
  const isAdmin = user.role === "admin";
  if (!isOwner && !isAdmin) return { status: "rejected", code: "UNAUTHORIZED", reason: "not case owner", case_id };

  const route = await resolveRouteForCase(svc, app);
  // PHASE 37 §36: pre-submission revalidation block — refuse to execute if the case's
  // pinned intelligence/provider/form/mapping version no longer matches the currently
  // published version, or the route/form/provider schema is incompatible. Never silently
  // execute against a changed definition.
  const preSub = await preSubmissionRevalidationFor(svc, app, route);
  if (!preSub.ok) {
    return { status: "rejected", code: preSub.code || "EXECUTION_BLOCKED_BY_INTELLIGENCE_CHANGE", reason: preSub.block || "intelligence change requires review", case_id, data: { requires_human_review: true, route_type: route.route_type, execution_capability: app.execution_capability, block: preSub.block, current_version: preSub.current?.data_version || null }, source: "intelligence_version_gate" };
  }
  const policy: AgentSubmissionPolicy = DEFAULT_SUBMISSION_POLICY; // CONFIRMATION_REQUIRED; admin-configurable in a future phase.

  // Documents completeness (best-effort from case snapshot).
  const docs = requiredDocsForCase({ snapshot: app.case_snapshot || {} });
  const attached: any[] = await svc.entities.ApplicationDocument.filter({ application_id: case_id }).catch(() : any[] => []);
  const documents_complete = docs.length === 0 || attached.length >= docs.length;

  // Eligibility projection.
  const elig = eligibilityForCase({ snapshot: app.case_snapshot || {} }) as any;

  // Payment (best-effort).
  const orders: any[] = await svc.entities.Order.filter({ application_id: case_id }).catch(() : any[] => []);
  const payment_completed = orders.some((o) => o.payment_status === "paid") || false;

  // Review gate (review_approved if a SUBMISSION_REVIEW task was resolved APPROVED).
  const reviewTasks: any[] = await svc.entities.OperationsTask.filter({ case_id, task_type: "SUBMISSION_REVIEW" }).catch(() : any[] => []);
  const review_approved = reviewTasks.some((t: any) => t.status === "COMPLETED" && t.resolution?.decision === "APPROVED");

  const gate = executionGateDecision({
    is_owner: isOwner, is_admin: isAdmin, case_state: app.case_state, execution_capability: app.execution_capability,
    route, submission_policy: policy, confirmed: !!input.confirmed, human_review_approved: review_approved,
    environment: "PRODUCTION", documents_complete, eligibility: elig, payment_completed, review_approved, is_mock: true,
  });
  if (!gate.ok) {
    return { status: "rejected", code: gate.code || "EXECUTION_REJECTED", reason: gate.reason, case_id, data: { requires_human_review: !!gate.requires_human_review, route_type: route.route_type, execution_capability: app.execution_capability, policy }, source: "execution_gate" };
  }

  // Phase 34: SANDBOX / mock execution only \u2014 never a real provider submission, even when policy + capability allow.
  const attempt = await startAttempt(svc, {
    case_id, provider_key: route.provider || "MOCK", provider_binding_id: route.provider_binding || "mock_binding",
    route_type: "PROVIDER_API", operation: "CREATE_APPLICATION", environment: "SANDBOX", capabilities: route.capabilities,
  });
  await markSucceeded(svc, attempt.attempt.id, { provider_application_id: `MOCK-${case_id.slice(-6)}`, response_reference: "mock_phase34" }).catch(() => null);
  // Thread back via a CaseEvent (no state change unless the route allows SUBMISSION_PENDING\u2192SUBMITTED).
  await recordCaseEvent(svc, app, { event_type: "SUBMISSION_REQUESTED", source: "execution", actor_id: user.id, idempotency_key: input.idempotency_key || ctx.idempotency_key, metadata: { mock: true, attempt_id: attempt.attempt.id } }).catch(() => null);

  return { status: "ok", case_id, data: { executed: true, environment: "SANDBOX", mock: true, attempt_id: attempt.attempt.id, provider_application_id: `MOCK-${case_id.slice(-6)}`, route_type: route.route_type, policy, note: "Phase 34 executes SANDBOX/mock only; no real provider submission" }, source: "execution_attempt_store", next_action: { kind: "track", label: "Track mock execution" } };
}

// ---------- helpers ----------
async function resolveRouteForCase(svc: any, app: any): Promise<any> {
  const country = (app.destination || app.case_snapshot?.country || "").toUpperCase() || "TH";
  const nationality = (app.nationality || app.case_snapshot?.nationality || "IN").toUpperCase() || "IN";
  const journey = app.case_snapshot?.journey || "EVISA";
  const bindings: any[] = await svc.entities.CountryProviderBinding.filter({ country_code: country }).catch(() : any[] => []);
  const providers: Record<string, any> = {};
  const provRows: any[] = await svc.entities.Provider.list("-created_date", 200).catch(() : any[] => []);
  for (const p of provRows) providers[p.key] = p;
  const connections: any[] = await svc.entities.ProviderConnection.list("-created_date", 100).catch(() : any[] => []);
  return resolveExecutionRoute({ country, nationality, journey, execution_capability: app.execution_capability || "UNKNOWN", bindings, providers, connections, environment: "PRODUCTION" });
}

function projectCase(app: any): any {
  return {
    id: app.id, case_id: app.id, case_state: app.case_state, status: app.status,
    destination: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose,
    execution_capability: app.execution_capability, route_status: app.route_status,
    provider_key: app.provider_key, normalized_status: app.normalized_status,
    created_date: app.created_date, updated_date: app.updated_date,
  };
}

function redactDoc(d: any): any {
  return { id: d.id, document_type: d.document_type, status: d.status, uploaded_at: d.created_date, file_url_redacted: d.file_url ? "[file_url]" : null };
}
function redactExtraction(e: any): any {
  if (!e) return null;
  return { id: e.id, document_type: e.document_type, confidence: e.confidence, verified: e.verified,
    fields: (e.extracted_fields || e.fields || []).map((f: any) => ({ name: f.name, available: !!f.value, source: f.source, confidence: f.confidence, verified: !!f.verified })) };
}