// Phase 13C — Agent Teams HTTP surface.
//
//   list-teams | get-team | create-team | publish-team | run-team | get-run | accept
//
// This function ONLY manages AgentTeam definitions and asks the Workflow Engine to
// run a `run_agent_team` task. It reuses dispatchStandaloneTask / launchRun /
// approveTask for ALL run/task/approval lifecycle — it never duplicates
// orchestration. Agent execution reuses the Agent Runtime + Provider Runtime.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { dispatchStandaloneTask } from "../../shared/operations/engine.ts";
import { verifyTenant, actorOf } from "../../shared/ai/coo.ts";
import { getObsConfig } from "../../shared/observability/index.ts";
import { seedWebsiteIntelligenceTeam, latestActiveTeam, loadTeam, teamConfigHash, WEBSITE_INTELLIGENCE_TEAM_ID } from "../../shared/teams/runtime.ts";
import { runTeamsAcceptance } from "../../shared/teams/acceptance.ts";

const ADMIN_ACTIONS = new Set(["create-team", "publish-team", "accept"]);

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
    const actor = actorOf(user, "agent_teams");

    if (ADMIN_ACTIONS.has(action) && user.role !== "admin")
      return Response.json({ error: "Admin only" }, { status: 403 });

    if (action === "list-teams") return Response.json(await listTeams(svc, body, user));
    if (action === "get-team") return Response.json(await getTeam(svc, body, user));
    if (action === "create-team") return Response.json(await createTeam(svc, body, user, actor));
    if (action === "publish-team") return Response.json(await publishTeam(svc, body, user, actor));
    if (action === "run-team") return Response.json(await runTeam(svc, body, user, actor));
    if (action === "get-run") return Response.json(await getRun(svc, body, user));
    if (action === "accept") return Response.json(await runAcceptance(svc, body, user, actor));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "BUSINESS_NOT_FOUND" || e?.code === "FORBIDDEN" || e?.code === "BAD_REQUEST" ? 400 : 500 });
  }
}

async function listTeams(svc: any, body: any, user: any): Promise<any> {
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  // Idempotently seed the canonical Website Intelligence Team so the UI is never empty.
  await seedWebsiteIntelligenceTeam(svc, business).catch(() => {});
  const rows: any[] = await svc.entities.AgentTeam.filter({ business_id: business.id }, "-created_date", 50).catch(() => []);
  // Collapse to latest active version per team_id + compute cached stats.
  const byTeam: Record<string, any> = {};
  for (const r of rows || []) {
    const cur = byTeam[r.team_id];
    if (!cur || (r.status === "active" && cur.status !== "active") || (r.status === cur.status && (r.version || 0) > (cur.version || 0))) {
      byTeam[r.team_id] = r;
    }
  }
  const teams = Object.values(byTeam);
  // Stats from real run_agent_team LaunchTasks for each team_id.
  for (const t of teams) {
    const ts: any[] = await svc.entities.LaunchTask.filter({ business_id: business.id, type: "run_agent_team" }, "-created_date", 50).catch(() => []);
    const mine = ts.filter((x) => x.input_context && x.input_context.team_id === t.team_id);
    const runs = mine.length;
    const successes = mine.filter((x) => x.status === "completed").length;
    const durations = mine.filter((x) => typeof x.duration_ms === "number").map((x) => x.duration_ms);
    t.stats = { runs, successes, success_rate: runs ? Math.round((successes / runs) * 100) : 0, avg_duration_ms: durations.length ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length) : 0, last_run_at: mine[0]?.completed_at || mine[0]?.created_date || null };
  }
  return { teams };
}

async function getTeam(svc: any, body: any, user: any): Promise<any> {
  if (!body.business_id || !body.team_id) throw Object.assign(new Error("business_id and team_id are required"), { code: "BAD_REQUEST" });
  await verifyTenant(svc, body.business_id, user);
  const team = body.version ? await loadTeam(svc, body.team_id, Number(body.version)) : await latestActiveTeam(svc, body.team_id);
  if (!team) throw Object.assign(new Error("Team not found"), { code: "NOT_FOUND" });
  return { team };
}

async function createTeam(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.business_id || !body.team_id || !body.name || !Array.isArray(body.agents)) throw Object.assign(new Error("business_id, team_id, name and agents[] are required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  const existing: any[] = await svc.entities.AgentTeam.filter({ business_id: business.id, team_id: body.team_id }).catch(() => []);
  const version = (existing || []).reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;
  const def: any = {
    tenant_id: business.tenant_id, business_id: business.id, team_id: body.team_id, name: body.name, description: body.description || "",
    version, status: "active", agents: body.agents, execution_mode: body.execution_mode || "dependent", entry_agent: body.entry_agent || (body.agents[0] && body.agents[0].key) || "",
    output_schema: body.output_schema || null, timeout_ms: body.timeout_ms ?? 120000, max_total_iterations: body.max_total_iterations ?? 20,
    max_total_tool_calls: body.max_total_tool_calls ?? 30, budget_limit: body.budget_limit ?? 0, approval_required: !!body.approval_required, enabled: body.enabled !== false,
    config_hash: "", created_by: actor,
  };
  def.config_hash = teamConfigHash(def);
  // Supersede prior active version (single active per team_id).
  for (const r of existing || []) if (r.status === "active") await svc.entities.AgentTeam.update(r.id, { status: "superseded" }).catch(() => {});
  const row = await svc.entities.AgentTeam.create(def);
  return { team: row };
}

async function publishTeam(svc: any, body: any, user: any, actor: string): Promise<any> {
  // publish-team = create new version from a draft definition, supersede prior active.
  return await createTeam(svc, body, user, actor);
}

async function runTeam(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.business_id || !body.team_id) throw Object.assign(new Error("business_id and team_id are required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  const team = body.version ? await loadTeam(svc, body.team_id, Number(body.version)) : await latestActiveTeam(svc, body.team_id);
  if (!team) throw Object.assign(new Error("Team not found"), { code: "NOT_FOUND" });
  const result = await dispatchStandaloneTask(svc, {
    businessId: business.id, taskType: "run_agent_team", taskKey: team.team_id, capability: "ai_generation",
    goal: body.goal || `Run team ${team.team_id}`, requestedBy: actor,
    input: { team_id: team.team_id, team_version: team.version, team_config_hash: team.config_hash, url: body.url || "https://example.com" },
  });
  const run = result.run;
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: run.id }).catch(() => []);
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: run.id }).catch(() => []);
  return {
    run,
    task: tasks[0] || null,
    output: tasks[0]?.output || null,
    executions: execs.map((e) => ({ id: e.id, stage: e.stage, operation: e.operation, provider: e.provider, model: e.model, tokens: e.tokens, estimated_cost: e.estimated_cost, latency_ms: e.latency_ms || e.duration_ms, success: e.success, error_code: e.error_code })),
    observability: result.observability || { enabled: false },
    langfuse: langfuseLink(result.observability),
  };
}

async function getRun(svc: any, body: any, user: any): Promise<any> {
  if (!body.run_id) throw Object.assign(new Error("run_id is required"), { code: "BAD_REQUEST" });
  const run: any = await svc.entities.LaunchPlan.get(body.run_id).catch(() => null);
  if (!run) throw Object.assign(new Error("Run not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && run.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: run.id }).catch(() => []);
  const execs: any[] = await svc.entities.AIExecution.filter({ run_id: run.id }).catch(() => []);
  return {
    run,
    task: tasks[0] || null,
    output: tasks[0]?.output || null,
    executions: execs.map((e) => ({ id: e.id, stage: e.stage, operation: e.operation, provider: e.provider, model: e.model, tokens: e.tokens, estimated_cost: e.estimated_cost, latency_ms: e.latency_ms || e.duration_ms, success: e.success, error_code: e.error_code })),
  };
}

async function runAcceptance(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (user.role !== "admin") throw Object.assign(new Error("Admin only"), { code: "FORBIDDEN" });
  if (!body.business_id) throw Object.assign(new Error("business_id is required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  return await runTeamsAcceptance(svc, business, actor);
}

function langfuseLink(obsSummary: any): any {
  const tid = obsSummary?.trace_id || null;
  let base = "https://us.cloud.langfuse.com";
  try { const c = getObsConfig(); if (c && c.baseUrl) base = String(c.baseUrl).replace(/\/+$/, ""); } catch {}
  return { trace_id: tid, url: tid ? `${base}/trace/${tid}` : null, enabled: !!(obsSummary && obsSummary.enabled) };
}