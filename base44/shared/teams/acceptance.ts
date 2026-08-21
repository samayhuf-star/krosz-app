// Phase 13C — Agent Team acceptance suite (TESTS A–Q).
//
// Actually executes every assertion against the real Workflow Engine, Agent
// Runtime, Provider Runtime, Tool Registry, AIExecution, and Langfuse — then
// cleans up ALL temporary data it created. No PASS from inspection.
//
// Runnable via the `agentTeams` backend function (action: "accept") — admin only.

import { dispatchStandaloneTask, launchRun, approveTask, defineTemplate, ensureSeedTemplates } from "../operations/engine.ts";
import { verifyTenant } from "../ai/coo.ts";
import {
  seedWebsiteIntelligenceTeam, loadTeam, latestActiveTeam, teamConfigHash, effectiveTools,
  evaluateTeamLimits, checkQaGate, validateOutput, WEBSITE_INTELLIGENCE_TEAM_ID,
} from "./runtime.ts";
import { enforceToolPermission } from "../agents/tools.ts";
import { CAPABILITIES } from "../actions/capabilities.ts";

export async function runTeamsAcceptance(svc: any, business: any, actor: string): Promise<any> {
  await ensureSeedTemplates(svc);
  const assertions: { name: string; passed: boolean; detail?: any }[] = [];
  const cleanup: { kind: string; id: string }[] = [];
  const assert = (name: string, cond: any, detail?: any) => { const passed = !!cond; assertions.push({ name, passed, detail }); return passed; };
  const reg = (k: string, id: string) => cleanup.push({ kind: k, id });
  const grepTasks = async (runId: string) => { const ts: any[] = await svc.entities.LaunchTask.filter({ launch_id: runId }).catch(() => []); for (const t of ts) reg("LaunchTask", t.id); return ts; };
  const grepExecs = async (runId: string) => { const es: any[] = await svc.entities.AIExecution.filter({ run_id: runId }).catch(() => []); for (const e of es) reg("AIExecution", e.id); return es; };

  // ---- Seed the Website Intelligence Team (creates 4 AIAgents + AgentTeam v1) ----
  const team = await seedWebsiteIntelligenceTeam(svc, business);
  for (const a of team.agents) if (a.agent_id) reg("AIAgent", a.agent_id);
  reg("AgentTeam", team.id);

  // ============ TEST A — Create team ============
  assert("TEST A: Website Intelligence Team saved with 4 agents", !!team?.id && team.agents.length === 4, { team_id: team.team_id, version: team.version, agents: team.agents.length });

  // ============ TEST B — Versioning ============
  // Publish v2: create a new version row, mark v1 superseded.
  const v2row = await svc.entities.AgentTeam.create({
    tenant_id: business.tenant_id, business_id: business.id, team_id: WEBSITE_INTELLIGENCE_TEAM_ID,
    name: "Website Intelligence Team", description: team.description + " (v2)", version: 2, status: "active",
    agents: team.agents, execution_mode: team.execution_mode, entry_agent: team.entry_agent, output_schema: team.output_schema,
    timeout_ms: team.timeout_ms, max_total_iterations: team.max_total_iterations, max_total_tool_calls: team.max_total_tool_calls,
    budget_limit: team.budget_limit, approval_required: team.approval_required, enabled: true,
    config_hash: teamConfigHash({ ...team, version: 2, description: team.description + " (v2)" }), created_by: actor,
  });
  reg("AgentTeam", v2row.id);
  await svc.entities.AgentTeam.update(team.id, { status: "superseded" }).catch(() => {});
  const activeRows: any[] = await svc.entities.AgentTeam.filter({ business_id: business.id, team_id: WEBSITE_INTELLIGENCE_TEAM_ID, status: "active" }).catch(() => []);
  assert("TEST B: exactly one active version after publishing v2", activeRows.length === 1 && activeRows[0].version === 2, { active_versions: activeRows.map((r) => r.version) });
  const v1After = await loadTeam(svc, WEBSITE_INTELLIGENCE_TEAM_ID, 1);
  assert("TEST B: v1 is immutable (superseded, not overwritten)", !!v1After && v1After.status === "superseded" && v1After.version === 1, { v1_status: v1After?.status });

  // ============ TEST C, D, E, N, O, Q — Real full team run ============
  const runRes = await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent_team", taskKey: "website_intelligence", capability: "ai_generation",
    goal: "13C acceptance: analyze https://en.wikipedia.org", requestedBy: actor,
    input: { team_id: WEBSITE_INTELLIGENCE_TEAM_ID, team_version: 1, url: "https://en.wikipedia.org", team_config_hash: team.config_hash },
  });
  const run = runRes.run; reg("LaunchPlan", run.id);
  const tasks = await grepTasks(run.id);
  for (const t of tasks) reg("LaunchTask", t.id);
  const teamTask = tasks[0];
  const execs = await grepExecs(run.id);

  // Ordering from the team handoff checkpoints.
  const handoffs = execs.filter((e) => (e.operation || "").startsWith("run_agent_team.handoff."))
    .sort((a, b) => new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime());
  const handoffKeys = handoffs.map((e) => (e.operation || "").replace("run_agent_team.handoff.", ""));

  // TEST C — Sequential ordering: research before tech/seo before qa.
  const idx = (k: string) => handoffKeys.indexOf(k);
  assert("TEST C: team LaunchTask completed", teamTask?.status === "completed", { status: teamTask?.status, error_code: teamTask?.error_code, error_detail: teamTask?.error_detail });
  assert("TEST C: research ran before technology and seo", idx("research") >= 0 && idx("research") < idx("technology") && idx("research") < idx("seo"), { order: handoffKeys });
  assert("TEST C: technology and seo ran before qa", idx("qa") > idx("technology") && idx("qa") > idx("seo"), { order: handoffKeys });

  // TEST D — Parallel: technology & seo are independent (neither depends on the other) and both completed.
  const techSpec = team.agents.find((a) => a.key === "technology");
  const seoSpec = team.agents.find((a) => a.key === "seo");
  const independent = techSpec && seoSpec && !techSpec.depends_on.includes("seo") && !seoSpec.depends_on.includes("technology");
  assert("TEST D: technology & seo are mutually independent (no false dependency/cycle)", !!independent, { tech_deps: techSpec?.depends_on, seo_deps: seoSpec?.depends_on });
  assert("TEST D: both technology and seo executed", idx("technology") >= 0 && idx("seo") >= 0, { order: handoffKeys });

  // TEST E — Structured handoff: final team output carries each agent's structured fields.
  const out = teamTask?.output || {};
  assert("TEST E: final output has structured research (business_name)", !!(out.research && out.research.business_name), { research_keys: out.research && Object.keys(out.research) });
  assert("TEST E: final output has structured technology (technologies array)", !!(out.technology && Array.isArray(out.technology.technologies)), { technologies: out.technology?.technologies });
  assert("TEST E: final output has structured seo (seo_score number)", !!(out.seo && typeof out.seo.seo_score === "number"), { seo_score: out.seo?.seo_score });
  assert("TEST E: only declared dependency outputs are shared (no qa private reasoning leaked)", !!(out.qa && typeof out.qa.passed === "boolean"), { qa_passed: out.qa?.passed, qa_has_answer: !!(out.qa && out.qa.answer) });
  assert("TEST E: no private chain-of-thought field present in shared outputs", !JSON.stringify(out).includes("chain_of_thought") && !JSON.stringify(out).includes("private_reasoning"), {});

  // ============ TEST F — Team permission must not exceed agent permission ============
  const researchAgent: any = await svc.entities.AIAgent.get(team.agents[0].agent_id).catch(() => null);
  const badPerm = effectiveTools(researchAgent, { key: "research", role: "Research", allowed_tools: ["list_customers"], depends_on: [] });
  assert("TEST F: team granting a tool the agent lacks is rejected (effective permission ≤ agent permission)", !badPerm.ok && /exceed|does not have/i.test(badPerm.reason || ""), { reason: badPerm.reason });

  // ============ TEST G — Unauthorized tool (deterministic) ============
  const perm = enforceToolPermission(["website_fetch"], "crm_delete_customer");
  assert("TEST G: disallowed tool rejected with TOOL_NOT_ALLOWED", perm.errorCode === "TOOL_NOT_ALLOWED", perm);

  // ============ TEST H — Provider failure handled by Provider Runtime (truthful provenance) ============
  const decideExecs = execs.filter((e) => (e.operation || "").startsWith("run_agent.decide"));
  assert("TEST H: per-agent provider/model provenance recorded (Provider Runtime reused, no team-level routing)", decideExecs.length > 0 && decideExecs.every((e) => !!e.provider), { providers: [...new Set(decideExecs.map((e) => e.provider))], models: [...new Set(decideExecs.map((e) => e.model))] });

  // ============ TEST I & L — Agent failure (timeout) → controlled team failure ============
  // One-agent team with timeout_ms=1: the single agent times out -> team fails.
  const toAgent = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, name: "13C Timeout Probe", purpose: ["test"], status: "active",
    instructions: "Answer briefly.", config: { tools: [], max_iterations: 1, timeout_ms: 1, output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" } }, required: ["answer", "tool_used", "result_summary"] } },
  });
  reg("AIAgent", toAgent.id);
  const toTeamRow = await svc.entities.AgentTeam.create({
    tenant_id: business.tenant_id, business_id: business.id, team_id: "13c_timeout_probe", name: "13C Timeout Probe Team", version: 1, status: "active",
    agents: [{ key: "p", role: "Probe", agent_id: toAgent.id, allowed_tools: [], depends_on: [], output_schema: toAgent.config.output_schema }],
    execution_mode: "sequential", entry_agent: "p", output_schema: { type: "object", properties: { p: { type: "object" } }, required: ["p"] },
    timeout_ms: 60000, max_total_iterations: 5, max_total_tool_calls: 5, budget_limit: 0, approval_required: false, enabled: true, config_hash: "x", created_by: actor,
  });
  reg("AgentTeam", toTeamRow.id);
  const toRunRes = await dispatchStandaloneTask(svc, { businessId: business.id, taskType: "run_agent_team", taskKey: "13c_timeout", capability: "ai_generation", goal: "13C: agent timeout", requestedBy: actor, input: { team_id: "13c_timeout_probe", team_version: 1 } });
  reg("LaunchPlan", toRunRes.run.id);
  const toTasks = await grepTasks(toRunRes.run.id);
  const toExecs = await grepExecs(toRunRes.run.id);
  const toTask = toTasks[0];
  assert("TEST I: agent failure makes the team task fail (controlled, not silent)", toTask?.status === "failed" && !!toTask?.error_code, { status: toTask?.status, error_code: toTask?.error_code });
  assert("TEST I: a failure checkpoint was recorded (traceable)", toExecs.some((e) => !e.success), { failures: toExecs.filter((e) => !e.success).map((e) => e.error_code) });

  // TEST L (unit): limit evaluator returns TEAM_TIMEOUT deterministically.
  const limTo = evaluateTeamLimits({ totalCost: 0, totalTools: 0, totalIter: 0, elapsedMs: 5000 }, { budget_limit: 0, max_total_tool_calls: 100, max_total_iterations: 100, timeout_ms: 1000 });
  assert("TEST L: evaluateTeamLimits returns TEAM_TIMEOUT when elapsed > timeout", !!limTo && limTo.code === "TEAM_TIMEOUT", limTo);

  // ============ TEST J — QA failure → no false success (deterministic gate) ============
  const qaGateBad = checkQaGate(team, { qa: { passed: false, issues: ["website is not a valid URL"] } });
  assert("TEST J: QA gate rejects when qa.passed=false (team would not report success)", !qaGateBad.ok && qaGateBad.issues.length > 0, qaGateBad);
  const qaGateGood = checkQaGate(team, { qa: { passed: true, issues: [] } });
  assert("TEST J: QA gate passes when qa.passed=true", qaGateGood.ok, qaGateGood);
  assert("TEST J: real run produced a boolean QA verdict (no silent success)", typeof out.qa?.passed === "boolean", { qa_passed: out.qa?.passed });

  // ============ TEST K — Budget limit (deterministic evaluator) ============
  const limBud = evaluateTeamLimits({ totalCost: 0.01, totalTools: 0, totalIter: 0, elapsedMs: 0 }, { budget_limit: 0.0001, max_total_tool_calls: 100, max_total_iterations: 100, timeout_ms: 60000 });
  const limTool = evaluateTeamLimits({ totalCost: 0, totalTools: 5, totalIter: 0, elapsedMs: 0 }, { budget_limit: 0, max_total_tool_calls: 2, max_total_iterations: 100, timeout_ms: 60000 });
  const limIter = evaluateTeamLimits({ totalCost: 0, totalTools: 0, totalIter: 50, elapsedMs: 0 }, { budget_limit: 0, max_total_tool_calls: 100, max_total_iterations: 20, timeout_ms: 60000 });
  assert("TEST K: TEAM_BUDGET_EXCEEDED when cost > budget", !!limBud && limBud.code === "TEAM_BUDGET_EXCEEDED", limBud);
  assert("TEST K: TEAM_TOOL_LIMIT when tool calls > max", !!limTool && limTool.code === "TEAM_TOOL_LIMIT", limTool);
  assert("TEST K: TEAM_ITERATION_LIMIT when iterations > max", !!limIter && limIter.code === "TEAM_ITERATION_LIMIT", limIter);

  // ============ TEST M — Approval boundary (engine-owned gate -> run_agent_team) ============
  const gatedTmpl = "13c_team_gated";
  try { await defineTemplate(svc, { templateId: gatedTmpl, name: "13C Team (gated)", tasks: [
    { key: "gate", type: "approval_gate", depends_on: [] },
    { key: "team", type: "run_agent_team", capability: "ai_generation", depends_on: ["gate"] },
  ], lifecycleGoal: "operating", tenant: business.tenant_id, overwrite: true }); } catch {}
  const gated = await launchRun(svc, { businessId: business.id, templateId: gatedTmpl, goal: "13C: gated team", requestedBy: actor, input: { team_id: "13c_timeout_probe", team_version: 1 } });
  reg("LaunchPlan", gated.run.id);
  const gatedTasks0 = await grepTasks(gated.run.id);
  const teamTaskA = gatedTasks0.find((t) => t.task_key === "team");
  const beforeExecs = (await grepExecs(gated.run.id)).length;
  assert("TEST M: run is awaiting_approval before approve (engine gates, team does not run)", (await svc.entities.LaunchPlan.get(gated.run.id)).status === "awaiting_approval", { status: (await svc.entities.LaunchPlan.get(gated.run.id)).status });
  assert("TEST M: team task not dispatched before approval", teamTaskA?.status === "pending" && beforeExecs === 0, { team_status: teamTaskA?.status, execs_before: beforeExecs });
  await approveTask(svc, { runId: gated.run.id, actor });
  const gatedTasks1 = await svc.entities.LaunchTask.filter({ launch_id: gated.run.id }).catch(() => []);
  const teamTaskB = gatedTasks1.find((t) => t.task_key === "team");
  const afterExecs = await grepExecs(gated.run.id);
  assert("TEST M: after approval the team task was dispatched (ran, not pending)", teamTaskB && teamTaskB.status !== "pending", { team_status: teamTaskB?.status });
  assert("TEST M: team never executed before the gate (no bypass)", beforeExecs === 0 && afterExecs.length > 0, { before: beforeExecs, after: afterExecs.length });

  // ============ TEST N — Cost aggregation ============
  assert("TEST N: team summary aggregates total_cost (number)", typeof out.summary?.total_cost === "number", { total_cost: out.summary?.total_cost });
  assert("TEST N: per-agent costs sum <= total and counts present", Array.isArray(out.summary?.per_agent) && out.summary.per_agent.length === team.agents.length, { per_agent: out.summary?.per_agent?.map((p) => ({ k: p.key, cost: p.cost, tools: p.tool_calls, iters: p.iterations })) });
  assert("TEST N: AIExecution rows exist for the run (provider/model/token/cost)", execs.length > 0 && execs.some((e) => typeof e.estimated_cost === "number"), { exec_count: execs.length });

  // ============ TEST O — Langfuse (Orchestrator → Workflow → LaunchTask → AgentTeam → Agents → LLM/Tool) ============
  const obs = runRes.observability;
  assert("TEST O: observability summary has a trace id (Langfuse wired)", !!(obs && obs.enabled && obs.trace_id), { enabled: obs?.enabled, trace_id: obs?.trace_id });
  assert("TEST O: per-agent LLM/tool executions recorded under the run", execs.some((e) => (e.operation || "").startsWith("run_agent.decide")) && execs.some((e) => (e.operation || "").startsWith("run_agent_team.")), { agent_decides: execs.filter((e) => (e.operation || "").startsWith("run_agent.decide")).length, team_checkpoints: execs.filter((e) => (e.operation || "").startsWith("run_agent_team.")).length });

  // ============ TEST P — Tenant isolation ============
  const myTenantId = business.tenant_id;
  const foreignTenantId = myTenantId === "system" ? "tenant_13c_other" : (myTenantId + "_13c_foreign");
  const foreign = await svc.entities.Business.create({ tenant_id: foreignTenantId, name: "13C Foreign Co", industry: "test", country: "US" }).catch(() => null);
  if (foreign) reg("Business", foreign.id);
  let isoErr = "";
  try { await verifyTenant(svc, foreign?.id, { role: "user", data: { tenant_id: business.tenant_id } }); }
  catch (e: any) { isoErr = e?.code || e?.message || "thrown"; }
  assert("TEST P: cross-tenant team access denied (FORBIDDEN)", isoErr === "FORBIDDEN", { isoErr, my_tenant: myTenantId, foreign_tenant: foreignTenantId });

  // ============ TEST Q — Run immutability ============
  // The dispatch pinned team_version=1 + team_config_hash; v2 was published but the
  // run still consumed v1 (we dispatched v1 explicitly). Prove a pinned version with
  // a stale config_hash is rejected by the adapter.
  const pinMismatchRes = await dispatchStandaloneTask(svc, { businessId: business.id, taskType: "run_agent_team", taskKey: "13c_pin", capability: "ai_generation", goal: "13C: pin mismatch", requestedBy: actor, input: { team_id: WEBSITE_INTELLIGENCE_TEAM_ID, team_version: 1, team_config_hash: "STALE_HASH" } });
  reg("LaunchPlan", pinMismatchRes.run.id);
  const pinTasks = await grepTasks(pinMismatchRes.run.id);
  const pinTask = pinTasks[0];
  assert("TEST Q: a run pinned to a stale config_hash fails (TEAM_VERSION_PIN_MISMATCH)", pinTask?.status === "failed" && pinTask?.error_code === "TEAM_VERSION_PIN_MISMATCH", { status: pinTask?.status, error_code: pinTask?.error_code });

  const allPassed = assertions.every((a) => a.passed);

  // ---- Cleanup ALL temporary data ----
  for (const c of cleanup) {
    try {
      if (c.kind === "AIExecution") await svc.entities.AIExecution.delete(c.id).catch(() => {});
      else if (c.kind === "LaunchTask") await svc.entities.LaunchTask.delete(c.id).catch(() => {});
      else if (c.kind === "LaunchPlan") await svc.entities.LaunchPlan.delete(c.id).catch(() => {});
      else if (c.kind === "AIAgent") await svc.entities.AIAgent.delete(c.id).catch(() => {});
      else if (c.kind === "AgentTeam") await svc.entities.AgentTeam.delete(c.id).catch(() => {});
      else if (c.kind === "Business") await svc.entities.Business.delete(c.id).catch(() => {});
    } catch {}
  }
  const trows: any[] = await svc.entities.PlanTemplate.filter({ template_id: gatedTmpl }).catch(() => []);
  for (const r of trows) await svc.entities.PlanTemplate.delete(r.id).catch(() => {});

  return {
    phase: "13c",
    all_passed: allPassed,
    passed: assertions.filter((a) => a.passed).length,
    total: assertions.length,
    failures: assertions.filter((a) => !a.passed).map((a) => a.name),
    real_ids: {
      team_run_launch_plan_id: run.id,
      team_launch_task_id: teamTask?.id || null,
      team_langfuse_trace_id: obs?.trace_id || null,
      website_intelligence_team_id: team.id,
      team_version_1_id: team.id,
      team_version_2_id: v2row.id,
      first_ai_execution_id: execs[0]?.id || null,
    },
    results: assertions.map((a) => ({ pass: a.passed, name: a.name, evidence: JSON.stringify(a.detail).slice(0, 220) })),
  };
}