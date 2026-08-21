// Customer Action Execution Engine — the universal "Do this" front door.
//
// This function is an INTERPRETER + a thin dispatcher. It NEVER executes work
// itself: reads are direct entity queries; every side-effect runs through the
// existing Workflow Engine (launchRun / dispatchStandaloneTask / approveTask /
// retryTask). It persists the single customer-facing Action Contract
// (CustomerAction) and reflects truthful run state back to the UI.
//
// Rules honoured: AI decides WHAT; existing systems decide HOW. One-click safe
// execution. Real approval engine (no fake approvals). Idempotent dispatch
// (no duplicate side effects). Async long actions (returns a runId; state is
// durable). Business isolation (verifyTenant, server-side). Knowledge Graph
// marked stale after dispatch. Never claims success before the backend
// confirms it. CAPABILITY_NOT_AVAILABLE is honest, not faked.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { launchRun, dispatchStandaloneTask, approveTask, retryTask, rejectTask } from "../../shared/operations/engine.ts";
import { verifyTenant, requireBusinessId, actorOf } from "../../shared/ai/coo.ts";
import { markStale } from "../../shared/knowledge-graph/index.ts";
import { CAPABILITIES } from "../../shared/actions/capabilities.ts";
import { classify, buildContextSummary, readListCustomers, readShowStatus, readAdviceToday } from "../../shared/actions/interpreter.ts";
import { resolveStandardAgent } from "../../shared/agents/lifecycle.ts";

const ACTIVE_RUN = new Set(["pending", "ready", "running", "awaiting_approval", "retrying", "paused", "paused_approval"]);

const FRIENDLY_ERROR: Record<string, string> = {
  FACTORY_FAILED: "We couldn't finish setting this up. We'll keep it safe and try again.",
  PROVIDER_TIMEOUT: "We couldn't finish setting this up. We'll keep it safe and try again.",
  PROVIDER_UNAVAILABLE: "The service this needs is briefly unavailable. I'll try again automatically.",
  DEPENDENCY_BLOCKED: "This step is waiting for another setup step to finish first.",
  VALIDATION_FAILED: "Something about the setup needs a tiny fix. You can finish it from the Workflow Center.",
  CAPABILITY_NOT_AVAILABLE: "I can't automate that yet.",
  // Agent-runtime failures (spec step 10) — plain customer language, no codes.
  AGENT_TIMEOUT: "We couldn't finish that in time — let's try again.",
  TOOL_FAILED: "We couldn't access that right now.",
  TOOL_NOT_ALLOWED: "I'm not able to do that particular action.",
  TOOL_INVALID_ARGS: "I need a little more detail to do that.",
  BUDGET_EXCEEDED: "We stopped this task because it exceeded its safety limit.",
  MAX_TOOL_CALLS: "We stopped this task because it exceeded its safety limit.",
  MAX_ITERATIONS: "We couldn't settle on an answer — let's try again.",
  INVALID_OUTPUT: "We couldn't finalize that. You can try again in a moment.",
  AGENT_NOT_FOUND: "We couldn't find the right assistant for this. Try again.",
  AGENT_INACTIVE: "This assistant is currently paused.",
  AGENT_NOT_CONFIGURED: "I'm not set up to do that yet.",
};

function friendlyError(code: string, fallback: string): string {
  return FRIENDLY_ERROR[code] || fallback || "Something went wrong. You can try again in a moment.";
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const svc = base44.asServiceRole;
    try { (svc as any).__base44 = base44; } catch {}
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const actor = actorOf(user, "action_engine");

    if (action === "request") return Response.json(await handleRequest(base44, svc, { businessId: body.business_id, request: body.request, user }));
    if (action === "get-status") return Response.json(await getStatus(svc, { businessId: body.business_id, actionId: body.action_id }, user));
    if (action === "approve") return Response.json(await handleApprove(svc, { businessId: body.business_id, actionId: body.action_id }, user, actor));
    if (action === "retry") return Response.json(await handleApprove(svc, { businessId: body.business_id, actionId: body.action_id, action: "retry" }, user, actor));
    if (action === "reject") return Response.json(await handleReject(svc, { businessId: body.business_id, actionId: body.action_id }, user, actor));
    if (action === "list-actions") return Response.json(await listActions(base44, { businessId: body.business_id }, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error), code: error?.code }, { status: error?.code === "FORBIDDEN" || error?.code === "BUSINESS_NOT_FOUND" ? 403 : 500 });
  }
}

// ============================================================
// REQUEST — interpret + dispatch
// ============================================================
async function handleRequest(base44: any, svc: any, opts: { businessId: string; request: string; user: any }): Promise<any> {
  const businessId = opts.businessId || opts.business_id;
  if (!businessId) return { error: "business_id is required", code: "BUSINESS_REQUIRED" };
  const business = await verifyTenant(svc, businessId, opts.user);
  const request = (opts.request || "").trim();
  if (!request) return { error: "request is required", code: "BAD_REQUEST" };

  // Create the action record immediately (status: understanding).
  const action = await svc.entities.CustomerAction.create({
    tenant_id: business.tenant_id, business_id: businessId,
    intent: request, capability: "not_available", parameters: {}, confidence: 0,
    requires_approval: false, status: "understanding", reply: "Let me think about that…", progress: 0,
    actor: actorOf(opts.user, "action_engine"), provenance: { actor: actorOf(opts.user, "action_engine") },
  });

  const ctxSummary = await buildContextSummary(svc, business);
  const classification = await classify(svc, business, request, ctxSummary);
  await svc.entities.CustomerAction.update(action.id, {
    capability: classification.capability, confidence: classification.confidence,
    parameters: classification.params || {}, status: "preparing",
    reply: classification.reply_understanding,
    provenance: { actor: actorOf(opts.user, "action_engine"), classifier: "intent_engine", confidence: classification.confidence },
  });

  // --- NOT AVAILABLE: honest, never faked ---
  if (classification.capability === "not_available") {
    const reply = `${classification.reply_understanding} I can show you the closest thing I can do — just ask me to "show my customers" or "improve my website".`;
    await svc.entities.CustomerAction.update(action.id, { status: "capability_not_available", error: { code: "CAPABILITY_NOT_AVAILABLE", message: "Capability not available" }, reply });
    return { action: await svc.entities.CustomerAction.get(action.id) };
  }

  const cap = CAPABILITIES[classification.capability];

  // --- READS: execute now (real entity reads) ---
  if (cap.kind === "read") {
    let data: any = null, reply = classification.reply_understanding;
    if (cap.key === "list_customers") ({ data, reply } = await readListCustomers(svc, businessId));
    else if (cap.key === "show_status") ({ data, reply } = await readShowStatus(svc, business));
    else if (cap.key === "advice_today") ({ data, reply } = await readAdviceToday(svc, business));
    await svc.entities.CustomerAction.update(action.id, { status: "completed", result: data, reply, progress: 100, completed: true });
    return { action: await svc.entities.CustomerAction.get(action.id) };
  }

  // --- WORKFLOWS / STANDALONE TASKS ---
  return await dispatchWorkflow(svc, base44, { businessId, request, capability: classification.capability, actor: actorOf(opts.user, "action_engine"), actionId: action.id, classification });
}

// Resolve the business's own website URL (live domain first, then published site).
// Used by the Website Analyzer agent when the customer says "analyze my website".
async function resolveBusinessWebsiteUrl(svc: any, businessId: string): Promise<string | null> {
  const domains: any[] = await svc.entities.Domain.filter({ business_id: businessId }).catch(() => []);
  const live = (domains || []).find((d) => d.status === "active" || d.status === "registered");
  if (live && live.name) return `https://${live.name.replace(/^https?:\/\//, "")}`;
  const sites: any[] = await svc.entities.Website.filter({ business_id: businessId }).catch(() => []);
  const pub = (sites || []).find((w) => w.status === "published");
  if (pub && (pub.url || pub.domain)) return pub.url || `https://${pub.domain}`;
  return null;
}

// Find an existing active run for a given plan_template_id (idempotency /
// resume). For non-regenerateable capabilities this also catches a completed run
// so we report "already done" instead of creating duplicates.
async function findExistingRun(svc: any, businessId: string, planTemplateId: string, includeCompleted: boolean): Promise<any> {
  const rows: any[] = await svc.entities.LaunchPlan.filter({ business_id: businessId, plan_template_id: planTemplateId }, "-created_date", 20).catch(() => []);
  const active = (rows || []).find((r: any) => ACTIVE_RUN.has(r.status)) || null;
  if (active) return { run: active, kind: "active" };
  if (includeCompleted) {
    const completed = (rows || []).find((r: any) => r.status === "completed") || null;
    if (completed) return { run: completed, kind: "completed" };
  }
  return null;
}

async function dispatchWorkflow(svc: any, base44: any, opts: { businessId: string; request?: string; capability: string; actor: string; actionId: string; classification: any }): Promise<any> {
  const { businessId, capability, actor, actionId } = opts;
  const cap = CAPABILITIES[capability];
  const biz = await svc.entities.Business.get(businessId);

  // AGENT ROUTING (spec step 12/13): a standalone_task whose taskType is
  // "run_agent" resolves the zero-touch standard agent for this business and
  // builds a concrete objective. The customer never names an agent.
  let agentInput: any = { action_id: actionId, capability };
  let agentObjective = "";
  let agentNotReady = false;
  if (cap.kind === "standalone_task" && cap.taskType === "run_agent" && cap.agentPurpose) {
    if (cap.key === "analyze_website") {
      const url = await resolveBusinessWebsiteUrl(svc, businessId);
      if (!url) {
        agentNotReady = true;
      } else {
        agentObjective = `Analyze the website at ${url} — fetch it and summarize what it is, its title, the technologies it uses, and your confidence.`;
      }
    } else {
      agentObjective = opts.request || cap.label;
    }
    if (!agentNotReady) {
      try {
        const agentRow = await resolveStandardAgent(svc, biz, cap.agentPurpose);
        agentInput = { action_id: actionId, capability, agent_id: agentRow.id, objective: agentObjective };
      } catch (e: any) {
        await svc.entities.CustomerAction.update(actionId, { status: "failed", error: { code: "AGENT_NOT_CONFIGURED", message: e?.message || String(e) }, reply: friendlyError("AGENT_NOT_CONFIGURED", e?.message) });
        return { action: await svc.entities.CustomerAction.get(actionId) };
      }
    }
  }
  if (agentNotReady) {
    const reply = `Your website isn't live yet, so there's nothing for me to analyze. Ask me to "build my website" and I'll get it up first.`;
    await svc.entities.CustomerAction.update(actionId, { status: "capability_not_available", error: { code: "NO_WEBSITE", message: "No live website to analyze" }, reply });
    return { action: await svc.entities.CustomerAction.get(actionId) };
  }

  // Idempotency: avoid duplicate concurrent runs of the same capability.
  const planTemplateId = cap.kind === "workflow" ? cap.templateId : `(dispatch:${cap.taskType})`;
  const existing = await findExistingRun(svc, businessId, planTemplateId, !cap.regenerateable);
  if (existing) {
    if (existing.kind === "active") {
      const mapped = await mapRunToAction(svc, existing.run, actionId, capability, /*createOrUpdate*/ "update", actor);
      await markStale(svc, businessId, "customer_action_resume").catch(() => {});
      return { action: mapped.action, idempotent: true, resumed: true };
    }
    // completed + non-regenerateable → already done.
    const reply = `This is already done — ${cap.label.toLowerCase()} is set up.`;
    await svc.entities.CustomerAction.update(actionId, { status: "completed", run_id: existing.run.id, progress: 100, result: { already: true, run_id: existing.run.id }, reply });
    return { action: await svc.entities.CustomerAction.get(actionId), idempotent: true };
  }

  // Dispatch through the EXISTING engine (never duplicate the factory logic).
  let dispatchRes: any;
  try {
    if (cap.kind === "workflow") {
      const goal = cap.key === "launch_business" ? `Launch ${biz.name}` : cap.label;
      dispatchRes = await launchRun(svc, { businessId, templateId: cap.templateId, goal, requestedBy: `action:${capability}:${actor}`, input: { action_id: actionId, capability } });
    } else {
      dispatchRes = await dispatchStandaloneTask(svc, { businessId, taskType: cap.taskType, taskKey: cap.taskKey, capability: cap.capability, goal: cap.label, requestedBy: `action:${capability}:${actor}`, input: agentInput });
    }
  } catch (e: any) {
    const code = e?.code || "DISPATCH_FAILED";
    await svc.entities.CustomerAction.update(actionId, { status: "failed", error: { code, message: e?.message || String(e) }, reply: friendlyError(code, e?.message) });
    return { action: await svc.entities.CustomerAction.get(actionId) };
  }

  const run = dispatchRes?.run || dispatchRes;
  await markStale(svc, businessId, "customer_action_dispatch").catch(() => {});
  const mapped = await mapRunToAction(svc, run, actionId, capability, "update", actor);
  return { action: mapped.action, idempotent: !!dispatchRes?.idempotent, dispatched: true };
}

// Map a real run + tasks → customer-facing Action status. The source of truth is
// persisted engine state; we never fabricate completion.
async function mapRunToAction(svc: any, run: any, actionId: string, capability: string, mode: "update", actor: string): Promise<{ action: any }> {
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: run.id }).catch(() => []);
  const gate = tasks.find((t: any) => t.status === "awaiting_approval") || null;
  const cap = CAPABILITIES[capability];
  const progress = run.progress || 0;

  let status: string, task_id: string | null = null, recommended_option: number | null = null, reply: string;
  if (gate) {
    status = "waiting_for_approval";
    task_id = gate.id;
    recommended_option = gate.approval_payload?.recommended_option ?? 0;
    reply = `I've prepared everything. One quick check before I continue — ${cap.approvalReason ? cap.approvalReason.toLowerCase().replace(/\.$/, "") : "your approval is needed"}.`;
  } else if (run.status === "completed") {
    status = "completed";
    // AGENT ANSWER (spec step 14): for a run_agent task, surface the agent's own
    // plain-language answer as the customer reply (no internal details).
    const agentTask = tasks.find((t: any) => t.type === "run_agent" && t.status === "completed" && t.output && t.output.answer);
    reply = agentTask ? String(agentTask.output.answer) : `Done — ${cap.label.toLowerCase()} is ready.`;
  } else if (run.status === "failed") {
    const failedTask = tasks.find((t: any) => t.status === "failed") || null;
    const rejectedGate = tasks.find((t: any) => t.status === "rejected" && t.type === "approval_gate") || null;
    const code = failedTask?.error_code || "FACTORY_FAILED";
    status = "failed";
    reply = rejectedGate ? "We stopped this step — it won't proceed unless you start it again." : friendlyError(code, failedTask?.error_detail);
  } else if (run.status === "cancelled") {
    status = "blocked";
    reply = "This was stopped. You can start it again whenever you're ready.";
  } else if (tasks.some((t: any) => t.status === "blocked")) {
    status = "blocked";
    reply = "This step is waiting for another setup step to finish first.";
  } else {
    status = "running";
    reply = `I'm working on it — ${cap.label.toLowerCase()} is in progress.`;
  }

  const patch: any = { status, run_id: run.id, progress, requires_approval: !!gate, approval_reason: gate ? cap.approvalReason || "" : "", reply };
  if (task_id) { patch.task_id = task_id; if (recommended_option != null) patch.recommended_option = recommended_option; }
  if (status === "completed") patch.result = { run_id: run.id, template: run.plan_template_id };
  if (status === "failed") {
    const failedTask = tasks.find((t: any) => t.status === "failed") || null;
    const rejectedGate = tasks.find((t: any) => t.status === "rejected" && t.type === "approval_gate") || null;
    patch.error = { code: rejectedGate ? "APPROVAL_REJECTED" : (failedTask?.error_code || "FACTORY_FAILED") };
  }

  await svc.entities.CustomerAction.update(actionId, patch);
  return { action: await svc.entities.CustomerAction.get(actionId) };
}

// ============================================================
// GET STATUS — re-read truthful run state (poll)
// ============================================================
async function getStatus(svc: any, opts: { businessId: string; actionId: string }, user: any): Promise<any> {
  await verifyTenant(svc, opts.businessId, user);
  const action: any = await svc.entities.CustomerAction.get(opts.actionId).catch(() => null);
  if (!action || action.business_id !== opts.businessId) return { error: "Action not found", code: "NOT_FOUND" };
  if (action.run_id && !["completed", "failed", "blocked", "capability_not_available"].includes(action.status)) {
    const run: any = await svc.entities.LaunchPlan.get(action.run_id).catch(() => null);
    if (run) await mapRunToAction(svc, run, action.id, action.capability, "update", actorOf(user, "action_engine"));
  }
  const fresh = await svc.entities.CustomerAction.get(action.id);
  const tasks: any[] = fresh.run_id ? await svc.entities.LaunchTask.filter({ launch_id: fresh.run_id }).catch(() => []) : [];
  return {
    action: fresh,
    progress: customerProgress(fresh, tasks),
  };
}

// Customer-friendly progress — no task ids, no providers, no DAG nodes.
function customerProgress(action: any, tasks: any[]): any {
  if (!action.run_id) return null;
  const steps = tasks.filter((t: any) => t.type !== "approval_gate");
  const done = steps.filter((t: any) => ["completed", "skipped"].includes(t.status));
  const building = steps.find((t: any) => ["running", "retrying"].includes(t.status));
  const failed = steps.find((t: any) => ["failed", "blocked"].includes(t.status));
  return {
    percent: action.progress || 0,
    state: action.status,
    running_label: building ? labelOf(building.task_key) : null,
    failed_label: failed ? labelOf(failed.task_key) : null,
    completed: done.map((t) => labelOf(t.task_key)),
    total: steps.length,
    completed_count: done.length,
  };
}

function labelOf(taskKey: string): string {
  const map: Record<string, string> = {
    blueprint: "Business plan", domain: "Domain", website: "Website", seo: "SEO",
    crm: "Customer system", marketing: "Marketing", email: "Email setup",
    website_analyzer: "Analyzing your website", customer_insight: "Reviewing your customers",
  };
  return map[taskKey] || (taskKey || "step").replace(/_/g, " ");
}

// ============================================================
// REJECT — proxy to the REAL approval engine (rejectTask)
// ============================================================
async function handleReject(svc: any, opts: { businessId: string; actionId: string }, user: any, actor: string): Promise<any> {
  await verifyTenant(svc, opts.businessId, user);
  const action: any = await svc.entities.CustomerAction.get(opts.actionId).catch(() => null);
  if (!action || action.business_id !== opts.businessId) return { error: "Action not found", code: "NOT_FOUND" };
  if (!action.run_id || !action.task_id) return { error: "Nothing to reject", code: "NOTHING_TO_REJECT" };
  try {
    await rejectTask(svc, { runId: action.run_id, taskId: action.task_id, actor, reason: "customer rejected" });
  } catch (e: any) {
    return { error: e?.message || "Reject failed", code: e?.code };
  }
  await markStale(svc, opts.businessId, "customer_action_reject").catch(() => {});
  const run = await svc.entities.LaunchPlan.get(action.run_id);
  await mapRunToAction(svc, run, action.id, action.capability, "update", actor);
  return { action: await svc.entities.CustomerAction.get(action.id) };
}

// ============================================================
// APPROVE / RETRY — proxy to the REAL approval engine
// ============================================================
async function handleApprove(svc: any, opts: { businessId: string; actionId: string; action?: string }, user: any, actor: string): Promise<any> {
  await verifyTenant(svc, opts.businessId, user);
  const action: any = await svc.entities.CustomerAction.get(opts.actionId).catch(() => null);
  if (!action || action.business_id !== opts.businessId) return { error: "Action not found", code: "NOT_FOUND" };
  if (!action.run_id || !action.task_id) return { error: "Nothing to approve", code: "NOTHING_TO_APPROVE" };
  try {
    if (opts.action === "retry") await retryTask(svc, { runId: action.run_id, taskId: action.task_id, actor });
    else await approveTask(svc, { runId: action.run_id, taskId: action.task_id, decision: action.recommended_option ?? "approved", actor });
  } catch (e: any) {
    return { error: e?.message || "Approval failed", code: e?.code };
  }
  await markStale(svc, opts.businessId, "customer_action_approve").catch(() => {});
  const run = await svc.entities.LaunchPlan.get(action.run_id);
  await mapRunToAction(svc, run, action.id, action.capability, "update", actor);
  return { action: await svc.entities.CustomerAction.get(action.id) };
}

// ============================================================
// LIST — recent customer actions for the active business
// ============================================================
async function listActions(base44: any, opts: { businessId: string }, user: any): Promise<any> {
  await verifyTenant(base44.asServiceRole, opts.businessId, user);
  const rows: any[] = await base44.entities.CustomerAction.filter({ business_id: opts.businessId }, "-created_date", 20).catch(() => []);
  return { actions: rows || [] };
}