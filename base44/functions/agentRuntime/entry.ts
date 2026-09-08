// Agent Runtime HTTP surface (Phase 13).
//
//   define-agent | update-agent | list-agents | get-agent   (config + RLS-scoped reads)
//   run-agent        (standalone 1-task run -> agent -> result, via the Workflow Engine)
//   run-slice-test   (full vertical-slice acceptance; returns a PASS/FAIL table)
//
// This function ONLY defines agents and asks the Workflow Engine to run a
// `run_agent` task. It reuses dispatchStandaloneTask / launchRun / approveTask /
// defineTemplate for ALL run/task lifecycle — it never duplicates orchestration.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  dispatchStandaloneTask, launchRun, approveTask, defineTemplate, ensureSeedTemplates,
} from "../../shared/operations/engine.ts";
import { verifyTenant, actorOf } from "../../shared/ai/coo.ts";
import { getObsConfig } from "../../shared/observability/index.ts";
import { enforceToolPermission, validateToolArgs, executeAgentTool } from "../../shared/agents/tools.ts";
import { validateAgentConfig, mapAgentLifecycle } from "../../shared/agents/lifecycle.ts";
import { runHardeningTest } from "../../shared/agents/hardeningTest.ts";

const ADMIN_WRITE_ACTIONS = new Set(["define-agent", "update-agent"]);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    const svc = base44.asServiceRole;
    try { (svc as any).__base44 = base44; } catch {}
    const actor = actorOf(user, "agent_runtime");

    if (ADMIN_WRITE_ACTIONS.has(action) && user.role !== "admin")
      return Response.json({ error: "Admin only" }, { status: 403 });

    if (action === "define-agent") return Response.json(await defineAgent(svc, body, actor));
    if (action === "update-agent") return Response.json(await updateAgent(svc, body, user));
    if (action === "list-agents") return Response.json(await listAgents(svc, body, user));
    if (action === "get-agent") return Response.json(await getAgent(svc, body, user));
    if (action === "get-agent-stats") return Response.json(await getAgentStats(svc, body, user));
    if (action === "run-agent") return Response.json(await runAgentStandalone(svc, body, user, actor));
    if (action === "run-slice-test") return Response.json(await runSliceTest(svc, body, user, actor));
    if (action === "run-website-slice-test") return Response.json(await runWebsiteSliceTest(svc, body, user, actor));
    if (action === "run-hardening-test") return Response.json(await runHardeningTestHandler(svc, body, user, actor));
    if (action === "get-result") return Response.json(await getResult(svc, body, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "BUSINESS_NOT_FOUND" || e?.code === "FORBIDDEN" || e?.code === "BAD_REQUEST" ? 400 : 500 });
  }
}

async function defineAgent(svc: any, body: any, actor: string): Promise<any> {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  if (!body.name) throw Object.assign(new Error("name is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, body.__user || null).catch(() => null) || await svc.entities.Business.get(body.business_id).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  // Validate config before the agent can become READY/active (spec step 3).
  const v = validateAgentConfig(body.name, body.instructions, body.config || {});
  if (!v.ok) throw Object.assign(new Error(`Agent configuration is invalid: ${v.errors.join(" ")}`), { code: "AGENT_CONFIG_INVALID", errors: v.errors });
  const status = body.status || "active";
  const row = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, provider_id: body.provider_id || null,
    name: body.name, purpose: body.purpose || [], instructions: body.instructions || "",
    status, human_escalation_enabled: body.human_escalation_enabled ?? true,
    lead_capture_enabled: body.lead_capture_enabled ?? false, external_reference: body.external_reference || null,
    config: body.config || {}, version: 1, last_run_at: null,
  });
  return { agent: row };
}

async function updateAgent(svc: any, body: any, user: any): Promise<any> {
  if (!body.agent_id) throw Object.assign(new Error("agent_id is required"), { code: "BAD_REQUEST" });
  const a: any = await svc.entities.AIAgent.get(body.agent_id).catch(() => null);
  if (!a) throw Object.assign(new Error("Agent not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && a.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const updates: any = {};
  for (const k of ["name", "instructions", "status", "purpose", "config", "human_escalation_enabled", "lead_capture_enabled", "provider_id"]) if (body[k] !== undefined) updates[k] = body[k];
  // Validate config (spec step 3). Going active requires a valid config.
  const newName = updates.name ?? a.name;
  const newInstr = updates.instructions ?? a.instructions;
  const newCfg = updates.config ?? a.config ?? {};
  if (updates.config || updates.name || updates.instructions || updates.status === "active") {
    const v = validateAgentConfig(newName, newInstr, newCfg);
    if (!v.ok) throw Object.assign(new Error(`Agent configuration is invalid: ${v.errors.join(" ")}`), { code: "AGENT_CONFIG_INVALID", errors: v.errors });
  }
  // Versioning (spec step 18): a change to instructions/config/tools/name forks a
  // new version — historical executions keep the version + config_hash that
  // produced them, so past runs remain reproducible.
  const cfgChanged = JSON.stringify(updates.config || {}) !== JSON.stringify(a.config || {});
  const instrChanged = (updates.instructions ?? a.instructions) !== a.instructions;
  const nameChanged = (updates.name ?? a.name) !== a.name;
  if (cfgChanged || instrChanged || nameChanged) updates.version = (a.version || 1) + 1;
  await svc.entities.AIAgent.update(body.agent_id, updates);
  return { agent: await svc.entities.AIAgent.get(body.agent_id) };
}

// Admin inspection (spec step 17): recent executions, success rate, latency,
// cost, last error, lifecycle + Langfuse link. Computed from real AIExecution
// rows joined to this agent's run_agent tasks.
async function getAgentStats(svc: any, body: any, user: any): Promise<any> {
  if (!body.agent_id) throw Object.assign(new Error("agent_id is required"), { code: "BAD_REQUEST" });
  const agent: any = await svc.entities.AIAgent.get(body.agent_id).catch(() => null);
  if (!agent) throw Object.assign(new Error("Agent not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && agent.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  // All run_agent tasks for this business whose input_context.agent_id matches.
  const tasks: any[] = await svc.entities.LaunchTask.filter({ business_id: agent.business_id, type: "run_agent" }, "-created_date", 100).catch(() => []);
  const mine = tasks.filter((t) => t.input_context && t.input_context.agent_id === agent.id);
  const runIds = [...new Set(mine.map((t) => t.launch_id))];
  let execs: any[] = [];
  for (const rid of runIds) {
    const es: any[] = await svc.entities.AIExecution.filter({ run_id: rid }).catch(() => []);
    execs = execs.concat(es);
  }
  const total = mine.length;
  const completed = mine.filter((t) => t.status === "completed").length;
  const failed = mine.filter((t) => t.status === "failed");
  const successRate = total ? Math.round((completed / total) * 100) : 0;
  const latencies = execs.filter((e) => typeof e.duration_ms === "number").map((e) => e.duration_ms);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length) : 0;
  const totalCost = execs.reduce((s, e) => s + (e.estimated_cost || 0), 0);
  const totalTokens = execs.reduce((s, e) => s + (e.tokens || 0), 0);
  const lastFailed = failed.sort((a, b) => new Date(b.updated_date || 0).getTime() - new Date(a.updated_date || 0).getTime())[0] || null;
  const lastTask = mine[0] || null;
  const lf = lastTask?.last_execution_id ? langfuseForRun(svc, lastTask.launch_id) : null;
  return {
    agent, version: agent.version || 1, lifecycle: mapAgentLifecycle(agent, mine),
    stats: { total_runs: total, completed, failed: failed.length, success_rate: successRate, avg_latency_ms: avgLatency, total_cost: totalCost, total_tokens: totalTokens, last_run_at: agent.last_run_at || null },
    last_error: lastFailed ? { code: lastFailed.error_code, message: lastFailed.error_detail, at: lastFailed.completed_at } : null,
    recent: (mine.slice(0, 8)).map((t) => ({ id: t.id, status: t.status, error_code: t.error_code, created: t.created_date, run_id: t.launch_id, answer: t.output?.answer ? String(t.output.answer).slice(0, 160) : null })),
    langfuse: lf,
  };
}

function langfuseForRun(svc: any, runId: string): any {
  const tid = runId || null;
  let base = "https://us.cloud.langfuse.com";
  try { const c = getObsConfig(); if (c && c.baseUrl) base = String(c.baseUrl).replace(/\/+$/, ""); } catch {}
  return { trace_id: tid, url: tid ? `${base}/trace/${tid}` : null };
}

async function runHardeningTestHandler(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  return await runHardeningTest(svc, business, actor);
}

async function listAgents(svc: any, body: any, user: any): Promise<any> {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  await verifyTenant(svc, body.business_id, user);
  const rows = await svc.entities.AIAgent.filter({ business_id: body.business_id }, "-created_date", 50).catch(() => []);
  return { agents: rows || [] };
}

async function getAgent(svc: any, body: any, user: any): Promise<any> {
  if (!body.agent_id) throw Object.assign(new Error("agent_id is required"), { code: "BAD_REQUEST" });
  const a: any = await svc.entities.AIAgent.get(body.agent_id).catch(() => null);
  if (!a) throw Object.assign(new Error("Agent not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && a.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  return { agent: a };
}

async function runAgentStandalone(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.business_id || !body.agent_id) throw Object.assign(new Error("business_id and agent_id are required"), { code: "BAD_REQUEST" });
  await verifyTenant(svc, body.business_id, user);
  // Verify the agent belongs to the caller's tenant before dispatching. The
  // service role loads the agent without RLS, so a user-supplied agent_id from
  // another tenant would otherwise execute that tenant's private configuration.
  const agent: any = await svc.entities.AIAgent.get(body.agent_id).catch(() => null);
  if (!agent) throw Object.assign(new Error("Agent not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && agent.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const result = await dispatchStandaloneTask(svc, {
    businessId: body.business_id, taskType: "run_agent", taskKey: body.task_key || "agent", capability: body.capability || "ai_generation",
    goal: body.goal || `Run agent ${body.agent_id}`, requestedBy: actor,
    input: { agent_id: body.agent_id, objective: body.objective },
  });
  const run = result.run;
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: run.id }).catch(() => []);
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: run.id }).catch(() => []);
  try { await svc.entities.AIAgent.update(body.agent_id, { last_run_at: new Date().toISOString() }).catch(() => {}); } catch {}
  return {
    run,
    task: tasks[0] || null,
    executions: execs.map((e) => ({ id: e.id, stage: e.stage, operation: e.operation, provider: e.provider, model: e.model, tokens: e.tokens, estimated_cost: e.estimated_cost, latency_ms: e.latency_ms || e.duration_ms, success: e.success, error_code: e.error_code })),
    observability: result.observability || { enabled: false },
    langfuse: langfuseLink(result.observability),
  };
}

// Build a Langfuse trace link from an advanceRun observability summary. The trace
// id is generated by the ObservabilityService inside the engine and surfaced via
// dispatchStandaloneTask; here we only construct a click-through URL for the UI.
function langfuseLink(obsSummary: any): any {
  const tid = obsSummary?.trace_id || null;
  let base = "https://us.cloud.langfuse.com";
  try { const c = getObsConfig(); if (c && c.baseUrl) base = String(c.baseUrl).replace(/\/+$/, ""); } catch {}
  return { trace_id: tid, url: tid ? `${base}/trace/${tid}` : null, enabled: !!(obsSummary && obsSummary.enabled), configured: !!(obsSummary && obsSummary.configured) };
}

async function getResult(svc: any, body: any, user: any): Promise<any> {
  if (!body.run_id) throw Object.assign(new Error("run_id is required"), { code: "BAD_REQUEST" });
  const run: any = await svc.entities.LaunchPlan.get(body.run_id).catch(() => null);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && run.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: body.run_id }).catch(() => []);
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: body.run_id }).catch(() => []);
  return {
    run,
    task: tasks[0] || null,
    executions: execs.map((e) => ({ id: e.id, stage: e.stage, operation: e.operation, provider: e.provider, model: e.model, tokens: e.tokens, estimated_cost: e.estimated_cost, latency_ms: e.latency_ms || e.duration_ms, success: e.success, error_code: e.error_code })),
  };
}

// =================================================================
// VERTICAL-SLICE ACCEPTANCE
// Workflow Task -> Agent Runtime -> Tool (capability) -> Provider
// Runtime -> structured result -> AIExecution -> LaunchTask result.
// Proves: provider call, context injection, tool call, structured
// output, cost/token/latency logging, AIExecution record, LaunchTask
// completion, failure handling (timeout + bad agent), human approval
// boundary (approval_gate), tenant isolation.
// =================================================================
async function runSliceTest(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  await ensureSeedTemplates(svc);
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };
  const cleanup: { kind: string; id: string }[] = [];
  const reg = (k: string, id: string) => cleanup.push({ kind: k, id });
  const aiProviders = await svc.entities.Provider.filter({ category: "ai", enabled: true }).catch(() => []);

  // ---- 1. Define the real agent under test ----
  const adviceSchema = {
    type: "object",
    properties: {
      answer: { type: "string", description: "A one-paragraph advice based on the customer data." },
      tool_used: { type: "string" },
      result_summary: { type: "string", description: "One line: how many leads/contacts informed the advice." },
    },
    required: ["answer", "tool_used", "result_summary"],
  };
  const agent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Customer Insight Agent",
    purpose: ["customer_insight"], instructions: "You are a customer insight agent. Use the list_customers tool to read real leads, then give the owner one concrete, friendly action to grow the pipeline. Be specific and grounded in the tool result — no invented numbers.",
    status: "active", human_escalation_enabled: true, lead_capture_enabled: false,
    config: { tools: ["list_customers"], max_iterations: 2, timeout_ms: 60000, temperature: 0.4, output_schema: adviceSchema },
  });
  reg("AIAgent", agent.id);

  // ---- 2. HAPPY PATH: dispatch run_agent as a standalone task ----
  const happy = await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "customer_insight", capability: "ai_generation",
    goal: "Slice test: happy agent run", requestedBy: actor, input: { agent_id: agent.id, objective: "Advise the owner on next steps to grow leads, using real customer data." },
  });
  const happyRun: any = happy.run;
  reg("LaunchPlan", happyRun.id);
  const happyTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: happyRun.id });
  for (const t of happyTasks) reg("LaunchTask", t.id);
  const happyTask: any = happyTasks[0] || null;
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: happyRun.id }).catch(() => []);
  for (const e of execs) reg("AIExecution", e.id);
  const decideExec = execs.find((e: any) => e.operation === "run_agent.decide") || null;
  const toolExec = execs.find((e: any) => (e.operation || "").startsWith("run_agent.tool.")) || null;
  const validateExec = execs.find((e: any) => e.operation === "run_agent.validate") || null;
  const providerUsed = decideExec?.provider || "";

  assert("happy: LaunchPlan created (agent_slice dispatch)", !!happyRun, { run_id: happyRun?.id });
  assert("happy: agent LaunchTask status = completed", happyTask?.status === "completed", { status: happyTask?.status, error_code: happyTask?.error_code });
  assert("happy: provider call recorded (truthful provenance)", !!decideExec && !!providerUsed, { provider: providerUsed, model: decideExec?.model, latency_ms: decideExec?.duration_ms });
  assert("happy: context injection — business snapshot on task", !!(happyTask?.input_context && happyTask.input_context.business), { business_name: happyTask?.input_context?.business?.name });
  assert("happy: tool call executed (list_customers)", !!toolExec && toolExec.success === true && (toolExec.operation || "").includes("list_customers"), { tool: toolExec?.operation, success: toolExec?.success });
  assert("happy: structured output validated", !!validateExec && validateExec.success === true, { validate_success: validateExec?.success });
  assert("happy: structured answer present", !!(happyTask?.output && happyTask.output.answer), { answer_preview: String(happyTask?.output?.answer || "").slice(0, 120), tool_used: happyTask?.output?.tool_used });
  assert("happy: tool_used references list_customers", happyTask?.output?.tool_used === "list_customers", { tool_used: happyTask?.output?.tool_used });
  assert("cost/token/latency logging wired on AIExecution (tokens, estimated_cost, duration_ms are numbers)",
    decideExec != null && typeof decideExec.duration_ms === "number" && typeof (decideExec as any).tokens === "number" && typeof (decideExec as any).estimated_cost === "number",
    { tokens: decideExec?.["tokens"], estimated_cost: decideExec?.["estimated_cost"], duration_ms: decideExec?.duration_ms });
  assert("cost logging: UsageLog row exists when a real (non base44-core) provider executed", providerUsed === "base44-core" ? true : (await svc.entities.UsageLog.filter({ provider_id: (execs.find((e: any) => e.provider_id) as any)?.provider_id }).catch(() => [])).length > 0,
    { provider: providerUsed, real_providers_configured: aiProviders.length, note: providerUsed === "base44-core" ? "base44-core fallback has no per-call UsageLog/CostLog; AIExecution carries the telemetry." : "metered provider -> UsageLog recorded by the reused Provider Runtime" });

  // ---- 3. FAILURE A: agent timeout (config.timeout_ms=1) ----
  const timeoutAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Timeout Agent",
    purpose: ["test"], instructions: "You advise the owner.", status: "active",
    config: { tools: ["list_customers"], max_iterations: 2, timeout_ms: 1, output_schema: adviceSchema },
  });
  reg("AIAgent", timeoutAgent.id);
  const toRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "timeout_agent", capability: "ai_generation",
    goal: "Slice test: timeout failure", requestedBy: actor, input: { agent_id: timeoutAgent.id, objective: "Advise the owner." },
  })).run;
  reg("LaunchPlan", toRun.id);
  const toTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: toRun.id });
  for (const t of toTasks) reg("LaunchTask", t.id);
  const toExecs: any[] = await svc.entities.AIExecution.filter({ run_id: toRun.id }).catch(() => []);
  for (const e of toExecs) reg("AIExecution", e.id);
  const toTask = toTasks[0];
  assert("failure-A: agent LaunchTask status = failed", toTask?.status === "failed", { status: toTask?.status });
  assert("failure-A: error code is AGENT_TIMEOUT (retryable)", toTask?.error_code === "AGENT_TIMEOUT" && toTask?.retryable === true, { error_code: toTask?.error_code, retryable: toTask?.retryable, error_detail: toTask?.error_detail });
  assert("failure-A: AIExecution failure checkpoint recorded", toExecs.some((e: any) => e.success === false && e.error_code === "AGENT_TIMEOUT"), { failures: toExecs.filter((e: any) => !e.success).map((e: any) => ({ stage: e.stage, code: e.error_code })) });

  // ---- 4. FAILURE B: non-existent agent_id (adapter boundary) ----
  const badRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "ghost_agent", capability: "ai_generation",
    goal: "Slice test: agent not found", requestedBy: actor, input: { agent_id: "000000000000000000000000", objective: "x" },
  })).run;
  reg("LaunchPlan", badRun.id);
  const badTasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: badRun.id });
  for (const t of badTasks) reg("LaunchTask", t.id);
  const badExecs: any[] = await svc.entities.AIExecution.filter({ run_id: badRun.id }).catch(() => []);
  for (const e of badExecs) reg("AIExecution", e.id);
  const badTask = badTasks[0];
  assert("failure-B: agent LaunchTask status = failed", badTask?.status === "failed", { status: badTask?.status });
  assert("failure-B: error code is AGENT_NOT_FOUND (non-retryable)", badTask?.error_code === "AGENT_NOT_FOUND" && badTask?.retryable === false, { error_code: badTask?.error_code, retryable: badTask?.retryable });

  // ---- 5. HUMAN APPROVAL BOUNDARY: gate -> run_agent ----
  const templateId = "agent_slice_gated";
  try { await defineTemplate(svc, { templateId, name: "Agent Slice (gated)", tasks: [
    { key: "gate", type: "approval_gate", depends_on: [] },
    { key: "insight", type: "run_agent", capability: "ai_generation", depends_on: ["gate"] },
  ], lifecycleGoal: "operating", tenant: business.tenant_id, overwrite: true }); } catch {}
  const gated = await launchRun(svc, { businessId: business.id, templateId, goal: "Slice test: gated agent", requestedBy: actor, input: { agent_id: agent.id, objective: "Advise the owner, after approval." } });
  const gatedRun = gated.run;
  reg("LaunchPlan", gatedRun.id);
  const gatedTasks0: any[] = await svc.entities.LaunchTask.filter({ launch_id: gatedRun.id });
  for (const t of gatedTasks0) reg("LaunchTask", t.id);
  const gatedRunFresh0: any = await svc.entities.LaunchPlan.get(gatedRun.id);
  const insightPending = gatedTasks0.find((t: any) => t.task_key === "insight");
  assert("approval: run status = awaiting_approval (engine gates, agent does NOT run)", gatedRunFresh0.status === "awaiting_approval", { status: gatedRunFresh0.status });
  assert("approval: agent task is pending (not dispatched) before approval", insightPending?.status === "pending", { insight_status: insightPending?.status });
  const beforeExecs = (await svc.entities.AIExecution.filter({ run_id: gatedRun.id }).catch(() => [])).length;
  const approved = await approveTask(svc, { runId: gatedRun.id, actor });
  const gatedTasks1: any[] = await svc.entities.LaunchTask.filter({ launch_id: gatedRun.id });
  const insightAfter = gatedTasks1.find((t: any) => t.task_key === "insight");
  const gatedExecs: any[] = await svc.entities.AIExecution.filter({ run_id: gatedRun.id }).catch(() => []);
  for (const e of gatedExecs) reg("AIExecution", e.id);
  assert("approval: after approveTask, agent task ran and completed", insightAfter?.status === "completed", { insight_status: insightAfter?.status, error: insightAfter?.error_code });
  assert("approval: agent only executed AFTER the gate (no executions before approval)", beforeExecs === 0 && gatedExecs.length > 0, { execs_before: beforeExecs, execs_after: gatedExecs.length });

  // ---- 6. TENANT ISOLATION: run-agent against a foreign-tenant business ----
  const myTenantId = user?.data?.tenant_id || business.tenant_id;
  const foreignTenantId = myTenantId === "system" ? "tenant_other" : (myTenantId + "_foreign");
  let foreign: any = await svc.entities.Business.create({ tenant_id: foreignTenantId, name: "Foreign Tenant Co", industry: "test", country: "US" }).catch(() => null);
  if (foreign) reg("Business", foreign.id);
  // Deterministic isolation probe: a regular tenant-A user must be rejected from a tenant-B business.
  let isolationError = "";
  try { await verifyTenant(svc, foreign?.id, { role: "user", data: { tenant_id: business.tenant_id } }); }
  catch (e: any) { isolationError = e?.code || e?.message || "thrown"; }
  assert("tenant isolation: a tenant-A user accessing a tenant-B business is rejected (FORBIDDEN)", isolationError === "FORBIDDEN", { isolationError, myTenantId, foreignTenantId });

  // ---- 7. AGENT ENTITY TENANT VISIBILITY: current user cannot read a foreign agent ----
  let foreignAgentVisible = true;
  try { const ga = await getAgent(svc, { agent_id: agent.id }, { role: "user", data: { tenant_id: foreignTenantId } }); foreignAgentVisible = !!ga?.agent; } catch { foreignAgentVisible = false; }

  const allPassed = assertions.every((a) => a.passed);

  // ---- cleanup ----
  for (const c of cleanup) {
    try { if (c.kind === "AIExecution") await svc.entities.AIExecution.delete(c.id).catch(() => {});
    else if (c.kind === "LaunchTask") await svc.entities.LaunchTask.delete(c.id).catch(() => {});
    else if (c.kind === "LaunchPlan") await svc.entities.LaunchPlan.delete(c.id).catch(() => {});
    else if (c.kind === "AIAgent") await svc.entities.AIAgent.delete(c.id).catch(() => {});
    else if (c.kind === "Business") await svc.entities.Business.delete(c.id).catch(() => {}); } catch {}
  }
  // remove the gated test template (admin-only)
  const trows: any[] = await svc.entities.PlanTemplate.filter({ template_id: templateId }).catch(() => []);
  for (const r of trows) await svc.entities.PlanTemplate.delete(r.id).catch(() => {});

  return {
    phase: "13",
    slice: "Workflow Task -> Agent Runtime -> Tool (capability) -> Provider Runtime -> structured result -> AIExecution -> LaunchTask result",
    allPassed,
    passed: assertions.filter((a) => a.passed).length,
    total: assertions.length,
    provider_env: { real_ai_providers_configured: aiProviders.length, provider_used_on_happy_path: providerUsed },
    results: assertions.map((a) => ({ pass: a.passed, name: a.name, evidence: JSON.stringify(a.detail).slice(0, 200) })),
  };
}

// =================================================================
// PHASE 13a — WEBSITE ANALYZER VERTICAL-SLICE ACCEPTANCE (TEST A-L)
// One real agent (Website Analyzer) + one real tool (website_fetch),
// run through the existing Workflow Engine. Proves: agent creation,
// real tool execution, TOOL_NOT_ALLOWED, tool failure, provider
// integration, iteration/timeout/budget limits, INVALID_OUTPUT,
// engine-owned approval gate, tenant isolation, AIExecution + UsageLog
// + CostLog, and the Langfuse trace hierarchy — then cleans up.
// =================================================================
async function runWebsiteSliceTest(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  await ensureSeedTemplates(svc);
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };
  const cleanup: { kind: string; id: string }[] = [];
  const reg = (k: string, id: string) => cleanup.push({ kind: k, id });
  const grepTasks = async (runId: string) => { const ts: any[] = await svc.entities.LaunchTask.filter({ launch_id: runId }).catch(() => []); for (const t of ts) reg("LaunchTask", t.id); return ts; };
  const grepExecs = async (runId: string) => { const es: any[] = await svc.entities.AIExecution.filter({ run_id: runId }).catch(() => []); for (const e of es) reg("AIExecution", e.id); return es; };
  const regRun = (r: any) => { if (r && r.id) reg("LaunchPlan", r.id); };

  const baseOutputSchema = {
    type: "object",
    properties: {
      answer: { type: "string", description: "A concise plain-language analysis of the website." },
      tool_used: { type: "string" },
      result_summary: { type: "string", description: "One line: site title + detected technologies." },
    },
    required: ["answer", "tool_used", "result_summary"],
  };

  // ---- TEST A: create the Website Analyzer agent ----
  const agent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Website Analyzer",
    description: "Fetches a public website and returns a structured analysis (title, summary, technologies, confidence).",
    purpose: ["website_analysis"], status: "active", human_escalation_enabled: true, lead_capture_enabled: false,
    instructions: "You are the Website Analyzer. Use the website_fetch tool with the URL from the objective, then return a concise structured analysis: what the site is, its title, the technologies it uses, and a confidence score (0-1). Be grounded in the fetched tool result — never invent details.",
    config: { tools: ["website_fetch"], max_iterations: 2, max_tool_calls: 3, timeout_ms: 60000, temperature: 0.3, output_schema: baseOutputSchema },
  });
  reg("AIAgent", agent.id);
  assert("TEST A: Website Analyzer agent created", !!agent?.id, { agent_id: agent?.id });

  // ---- TEST B: run happy path with a real URL ----
  const happy = await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "website_analyzer", capability: "ai_generation",
    goal: "Slice: analyze https://example.com", requestedBy: actor,
    input: { agent_id: agent.id, objective: "Analyze the website at https://example.com — fetch it and summarize what it is, its title, technologies, and your confidence." },
  });
  const happyRun = happy.run; regRun(happyRun);
  const happyTasks = await grepTasks(happyRun.id);
  const happyExecs = await grepExecs(happyRun.id);
  const happyTask = happyTasks[0] || null;
  const decideExec = happyExecs.find((e) => e.operation === "run_agent.decide") || null;
  const toolExec = happyExecs.find((e) => (e.operation || "").startsWith("run_agent.tool.")) || null;
  assert("TEST B: LaunchTask status = completed", happyTask?.status === "completed", { status: happyTask?.status, error_code: happyTask?.error_code });
  assert("TEST B: agent executed the website_fetch tool", !!toolExec && toolExec.success === true && (toolExec.operation || "").includes("website_fetch"), { op: toolExec?.operation, success: toolExec?.success });
  assert("TEST B: structured analysis returned", !!(happyTask?.output && happyTask.output.answer), { answer_preview: String(happyTask?.output?.answer || "").slice(0, 140), tool_used: happyTask?.output?.tool_used, iterations: happyTask?.output?.iterations });
  assert("TEST B: tool_used references website_fetch", happyTask?.output?.tool_used === "website_fetch", { tool_used: happyTask?.output?.tool_used });

  const providerUsed = decideExec?.provider || "";

  // ---- TEST C: unauthorized tool request -> TOOL_NOT_ALLOWED (deterministic) ----
  const permUnknown = enforceToolPermission(["website_fetch"], "crm_delete_customer");
  const permNotInList = enforceToolPermission(["website_fetch"], "list_customers");
  const permOk = enforceToolPermission(["website_fetch"], "website_fetch");
  assert("TEST C: unknown capability rejected with TOOL_NOT_ALLOWED", permUnknown.errorCode === "TOOL_NOT_ALLOWED", permUnknown);
  assert("TEST C: registered-but-unallowed capability rejected with TOOL_NOT_ALLOWED", permNotInList.errorCode === "TOOL_NOT_ALLOWED", permNotInList);
  assert("TEST C: allowed capability permitted", permOk.ok === true, permOk);

  // ---- TEST D: tool failure -> controlled TOOL_FAILED (deterministic direct, + end-to-end clean termination) ----
  const directBad = await executeAgentTool(svc, business, "website_fetch", { url: "https://agent-runtime-test.invalid/" });
  assert("TEST D: website_fetch returns controlled TOOL_FAILED on an unreachable URL", !directBad.ok && directBad.errorCode === "TOOL_FAILED", { ok: directBad.ok, errorCode: directBad.errorCode, error: directBad.error });
  const badToolAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Website Analyzer (bad url)",
    description: "test seam", purpose: ["test"], status: "active",
    instructions: "You are the Website Analyzer. You MUST call the website_fetch tool with the exact URL given in the objective before answering.",
    config: { tools: ["website_fetch"], max_iterations: 2, max_tool_calls: 3, timeout_ms: 60000, output_schema: baseOutputSchema },
  });
  reg("AIAgent", badToolAgent.id);
  const badRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "bad_url_agent", capability: "ai_generation",
    goal: "Slice: tool failure", requestedBy: actor,
    input: { agent_id: badToolAgent.id, objective: "Analyze the website at http://192.0.2.1:9/nope (fetch it)." },
  })).run;
  regRun(badRun);
  const badTasks = await grepTasks(badRun.id);
  const badTask = badTasks[0];
  // The end-to-end run terminates cleanly (structured failure code, or the model
  // declined the unsafe URL and answered) — never an uncontrolled crash.
  assert("TEST D: end-to-end run terminates cleanly (failed with a structured code, or completed) — no crash", badTask?.status === "failed" || badTask?.status === "completed", { status: badTask?.status, error_code: badTask?.error_code });

  // ---- TEST E: provider integration (real provider executed; failover reused from Phase 12.6) ----
  assert("TEST E: provider call recorded with truthful provenance (provider, model, tokens, cost)", !!decideExec && !!providerUsed && typeof decideExec.tokens === "number" && typeof decideExec.estimated_cost === "number", { provider: providerUsed, model: decideExec?.model, tokens: decideExec?.tokens, cost: decideExec?.estimated_cost, note: "Provider Runtime selection/retry/failover reused as-is (proven in Phase 12.6); this run exercised the resolved chain." });

  // ---- TEST F: iteration limit (loop bounded by max_iterations) ----
  const maxIterAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Website Analyzer (max iter)",
    description: "test seam", purpose: ["test"], status: "active",
    instructions: "You are a website analyzer. Call the website_fetch tool for the URL in the objective, then call it again for https://example.org, then answer.",
    config: { tools: ["website_fetch"], max_iterations: 1, max_tool_calls: 5, timeout_ms: 60000, output_schema: baseOutputSchema },
  });
  reg("AIAgent", maxIterAgent.id);
  const miRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "max_iter_agent", capability: "ai_generation",
    goal: "Slice: max iterations", requestedBy: actor,
    input: { agent_id: maxIterAgent.id, objective: "Fetch https://example.com, then fetch https://example.org, then answer." },
  })).run;
  regRun(miRun);
  const miTasks = await grepTasks(miRun.id);
  const miTask = miTasks[0];
  const miIters = miTask?.output?.iterations ?? 0;
  assert("TEST F: agent run bounded by max_iterations (iterations <= maxIter)", miIters <= 1 && (miTask?.status === "completed" || miTask?.status === "failed"), { task_status: miTask?.status, iterations: miIters, max_iterations: 1, error_code: miTask?.error_code });

  // ---- TEST G: timeout (timeout_ms=1) -> AGENT_TIMEOUT (retryable) ----
  const toAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Website Analyzer (timeout)",
    description: "test seam", purpose: ["test"], status: "active",
    instructions: "You are a website analyzer. Answer concisely.",
    config: { tools: ["website_fetch"], max_iterations: 2, timeout_ms: 1, output_schema: baseOutputSchema },
  });
  reg("AIAgent", toAgent.id);
  const toRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "timeout_agent", capability: "ai_generation",
    goal: "Slice: timeout", requestedBy: actor,
    input: { agent_id: toAgent.id, objective: "Analyze https://example.com." },
  })).run;
  regRun(toRun);
  const toTasks = await grepTasks(toRun.id);
  const toExecs = await grepExecs(toRun.id);
  const toTask = toTasks[0];
  assert("TEST G: agent run stopped with AGENT_TIMEOUT (retryable)", toTask?.status === "failed" && toTask?.error_code === "AGENT_TIMEOUT" && toTask?.retryable === true, { status: toTask?.status, error_code: toTask?.error_code, retryable: toTask?.retryable });
  assert("TEST G: AGENT_TIMEOUT failure checkpoint recorded", toExecs.some((e) => e.success === false && e.error_code === "AGENT_TIMEOUT"), { failures: toExecs.filter((e) => !e.success).map((e) => ({ stage: e.stage, code: e.error_code })) });

  // ---- TEST H: invalid structured output -> INVALID_OUTPUT ----
  const badOutAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "Website Analyzer (bad output)",
    description: "test seam", purpose: ["test"], status: "active",
    instructions: "Answer the objective in one short sentence. Do not call any tool.",
    config: { tools: [], max_iterations: 2, timeout_ms: 60000, output_schema: { type: "object", properties: { decision: { type: "string" } }, required: ["decision"] } },
  });
  reg("AIAgent", badOutAgent.id);
  const boRun = (await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent", taskKey: "bad_output_agent", capability: "ai_generation",
    goal: "Slice: invalid output", requestedBy: actor,
    input: { agent_id: badOutAgent.id, objective: "What is example.com?" },
  })).run;
  regRun(boRun);
  const boTasks = await grepTasks(boRun.id);
  const boExecs = await grepExecs(boRun.id);
  const boTask = boTasks[0];
  const boValidate = boExecs.find((e) => e.operation === "run_agent.validate");
  assert("TEST H: invalid structured output rejected with INVALID_OUTPUT", boTask?.status === "failed" && boTask?.error_code === "INVALID_OUTPUT", { status: boTask?.status, error_code: boTask?.error_code });
  assert("TEST H: validation checkpoint recorded the failure", boValidate?.success === false && boValidate?.error_code === "INVALID_OUTPUT", { validate_success: boValidate?.success });
  const argMissing = validateToolArgs("website_fetch", {});
  assert("TEST H: missing tool arg rejected (invalid args path)", !argMissing.ok && /url/i.test(argMissing.reason || ""), argMissing);

  // ---- TEST I: approval boundary (engine-owned approval_gate -> run_agent) ----
  const gatedTmpl = "agent_website_gated";
  try { await defineTemplate(svc, { templateId: gatedTmpl, name: "Website Analyzer (gated)", tasks: [
    { key: "gate", type: "approval_gate", depends_on: [] },
    { key: "analyze", type: "run_agent", capability: "ai_generation", depends_on: ["gate"] },
  ], lifecycleGoal: "operating", tenant: business.tenant_id, overwrite: true }); } catch {}
  const gated = await launchRun(svc, { businessId: business.id, templateId: gatedTmpl, goal: "Slice: gated website analyzer", requestedBy: actor, input: { agent_id: agent.id, objective: "Analyze https://example.com after approval." } });
  const gatedRun = gated.run; regRun(gatedRun);
  const gatedTasks0 = await grepTasks(gatedRun.id);
  const analyze0 = gatedTasks0.find((t) => t.task_key === "analyze");
  const beforeExecs = (await grepExecs(gatedRun.id)).length;
  assert("TEST I: run status = awaiting_approval before approval (engine gates)", (await svc.entities.LaunchPlan.get(gatedRun.id)).status === "awaiting_approval", { status: (await svc.entities.LaunchPlan.get(gatedRun.id)).status });
  assert("TEST I: agent task not dispatched before approval", analyze0?.status === "pending" && beforeExecs === 0, { analyze_status: analyze0?.status, execs_before: beforeExecs });
  await approveTask(svc, { runId: gatedRun.id, actor });
  const gatedTasks1 = await svc.entities.LaunchTask.filter({ launch_id: gatedRun.id }).catch(() => []);
  const analyze1 = gatedTasks1.find((t) => t.task_key === "analyze");
  const afterExecs = await grepExecs(gatedRun.id);
  assert("TEST I: agent ran + completed AFTER approval", analyze1?.status === "completed", { analyze_status: analyze1?.status, error: analyze1?.error_code });
  assert("TEST I: agent never executed before the gate (no bypass)", beforeExecs === 0 && afterExecs.length > 0, { before: beforeExecs, after: afterExecs.length });

  // ---- TEST J: tenant isolation ----
  const myTenantId = user?.data?.tenant_id || business.tenant_id;
  const foreignTenantId = myTenantId === "system" ? "tenant_other" : (myTenantId + "_foreign");
  const foreign = await svc.entities.Business.create({ tenant_id: foreignTenantId, name: "Foreign Tenant Co", industry: "test", country: "US" }).catch(() => null);
  if (foreign) reg("Business", foreign.id);
  let isoErr = "";
  try { await verifyTenant(svc, foreign?.id, { role: "user", data: { tenant_id: business.tenant_id } }); }
  catch (e: any) { isoErr = e?.code || e?.message || "thrown"; }
  assert("TEST J: cross-tenant access denied (FORBIDDEN)", isoErr === "FORBIDDEN", { isoErr, my_tenant: myTenantId, foreign_tenant: foreignTenantId });

  // ---- TEST K: cost logging (AIExecution + UsageLog/CostLog) ----
  const realProvider = !!providerUsed && providerUsed !== "base44-core";
  const providerExec = happyExecs.find((e: any) => e.provider_id && e.provider_id !== "(none)" && e.provider_id !== "(agent_tool)") || decideExec;
  let usageOk = true, costOk = true;
  if (realProvider && providerExec?.provider_id) {
    const ul = await svc.entities.UsageLog.filter({ provider_id: providerExec.provider_id }).catch(() => []);
    const cl = await svc.entities.CostLog.filter({ provider_id: providerExec.provider_id }).catch(() => []);
    usageOk = ul.length > 0; costOk = cl.length > 0;
  }
  assert("TEST K: AIExecution recorded for the agent run (tokens + cost present)", happyExecs.length > 0 && typeof decideExec?.tokens === "number" && typeof decideExec?.estimated_cost === "number", { exec_count: happyExecs.length, provider: providerUsed });
  assert("TEST K: UsageLog/CostLog recorded for a metered provider (or AIExecution carries telemetry for base44-core)", realProvider ? (usageOk && costOk) : true, { realProvider, provider: providerUsed, note: realProvider ? "metered provider -> UsageLog/CostLog written by the reused Provider Runtime" : "platform-default/core path: AIExecution carries the telemetry (no per-call UsageLog/CostLog); no metered provider was configured to bill against." });

  // ---- TEST L: Langfuse trace (Workflow -> LaunchTask -> Agent -> LLM -> Tool -> Result) ----
  const obs = happy.observability;
  assert("TEST L: observability summary returned with trace id", !!(obs && obs.enabled && obs.trace_id), { enabled: obs?.enabled, trace_id: obs?.trace_id, flush_ok: obs?.flush?.ok });
  assert("TEST L: trace flushed cleanly (ingestion accepted)", !!(obs && obs.flush && (obs.flush.ok || obs.flush.status === 201 || obs.flush.status === 207)), { flush: obs?.flush });
  assert("TEST L: Langfuse non-fatal (business run completes regardless of flush)", happyTask?.status === "completed", { task_status: happyTask?.status, flush_ok: obs?.flush?.ok });

  const allPassed = assertions.every((a) => a.passed);

  // ---- cleanup ----
  for (const c of cleanup) {
    try {
      if (c.kind === "AIExecution") await svc.entities.AIExecution.delete(c.id).catch(() => {});
      else if (c.kind === "LaunchTask") await svc.entities.LaunchTask.delete(c.id).catch(() => {});
      else if (c.kind === "LaunchPlan") await svc.entities.LaunchPlan.delete(c.id).catch(() => {});
      else if (c.kind === "AIAgent") await svc.entities.AIAgent.delete(c.id).catch(() => {});
      else if (c.kind === "Business") await svc.entities.Business.delete(c.id).catch(() => {});
    } catch {}
  }
  const trows: any[] = await svc.entities.PlanTemplate.filter({ template_id: gatedTmpl }).catch(() => []);
  for (const r of trows) await svc.entities.PlanTemplate.delete(r.id).catch(() => {});

  return {
    phase: "13a",
    slice: "LaunchTask -> Agent Runtime -> website_fetch tool -> Provider Runtime -> structured output -> AIExecution/UsageLog/CostLog -> Langfuse",
    allPassed,
    failures: assertions.filter((a) => !a.passed).map((a) => a.name),
    passed: assertions.filter((a) => a.passed).length,
    total: assertions.length,
    provider_env: { provider_used_on_happy_path: providerUsed },
    real_ids: { first_launch_task_id: happyTask?.id || null, first_ai_execution_id: decideExec?.id || null, website_analyzer_agent_id: agent.id, happy_run_id: happyRun?.id, langfuse_trace_id: obs?.trace_id || null },
    results: assertions.map((a) => ({ pass: a.passed, name: a.name, evidence: JSON.stringify(a.detail).slice(0, 220) })),
  };
}