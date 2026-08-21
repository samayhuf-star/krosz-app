// ORCHESTRAL — /v1 API surface (Phase O1).
//
// A thin, stable, REST-style router that maps /v1 endpoints onto the EXISTING
// durable orchestration engine (base44/shared/operations/engine.ts) and the
// existing shared agent/teams helpers. It NEVER duplicates orchestration logic:
// every Run/Task/Approval/Retry/Cancel flows through launchRun / advanceRun /
// runStatus / approveTask / retryTask / cancelRun / defineTemplate /
// dispatchStandaloneTask — the very same functions the legacy `orchestrator`
// HTTP entry uses. The legacy action-based functions stay operational and
// backward compatible; this is the agent-native /v1 front door.
//
// Phase O1 scope:
//   - Auth: Base44 user auth (createClientFromRequest + base44.auth.me()).
//     Agent API keys / machine tokens are O2.
//   - Application linkage: stored on Run.provenance (LaunchPlan.provenance is an
//     existing freeform object) so no schema churn is needed in O1. O2 promotes
//     application_id to a first-class indexed field on LaunchPlan.
//   - Endpoints: runs, tasks, agents, agent-teams, capabilities, providers,
//     approvals, events. All reuse existing engine + entity reads.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  launchRun, advanceRun, runStatus, approveTask, rejectTask, retryTask, cancelRun,
  dispatchStandaloneTask, defineTemplate, ensureSeedTemplates,
} from "../../shared/operations/engine.ts";
import { resolveProvider } from "../../shared/operations/resolver.ts";
import { validateAgentConfig } from "../../shared/agents/lifecycle.ts";

const VERSION = "v1";

function actorOf(u: any): string {
  return (u && (u.full_name || u.email)) || (u && u.id) || "system";
}

// Route dispatch table. Each entry: [METHOD, pathPattern, handler].
// pathParams are extracted from :segments.
type Handler = (svc: any, user: any, body: any, params: Record<string, string>, actor: string) => Promise<any>;

const ROUTES: Array<{ method: string; segs: string[]; handler: Handler }> = [];

function route(method: string, path: string, handler: Handler) {
  ROUTES.push({ method: method.toUpperCase(), segs: path.split("/").filter(Boolean), handler });
}

// ---- Runs ----
route("POST", "/v1/runs", async (svc, user, body, _p, actor) => {
  // Resolve the Application boundary. business_id may come from the Application
  // link or be passed directly (legacy compatibility). The engine still needs a
  // Business row to anchor tenant + context snapshot; O2 will decouple this.
  const applicationId = body.application_id || null;
  let businessId = body.business_id || null;
  let application: any = null;
  if (applicationId) {
    application = await svc.entities.Application.get(applicationId).catch(() => null);
    if (!application) return { error: "Application not found", code: "APPLICATION_NOT_FOUND" };
    if (!businessId && application.business_id) businessId = application.business_id;
  }
  if (!businessId) return { error: "business_id or application_id (with a linked business_id) is required", code: "BAD_REQUEST" };
  const templateId = body.template_id;
  if (!templateId) return { error: "template_id is required", code: "BAD_REQUEST" };
  const result = await launchRun(svc, {
    businessId, templateId, goal: body.goal, requestedBy: actor, input: body.input,
  });
  // Stamp the Application boundary onto the Run's provenance (additive, no schema change).
  if (applicationId) {
    const run = result.run;
    const provenance = { ...(run.provenance || {}), application_id: applicationId, project_id: application?.project_id || null, organization_id: application?.organization_id || null, api: VERSION };
    await svc.entities.LaunchPlan.update(run.id, { provenance }).catch(() => {});
    result.run = await svc.entities.LaunchPlan.get(run.id);
  }
  return result;
});

route("GET", "/v1/runs/:id", async (svc, _u, _b, p) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  return await runStatus(svc, { runId: p.id });
});

route("POST", "/v1/runs/:id/resume", async (svc, _u, _b, p, actor) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  return await advanceRun(svc, { runId: p.id, actor });
});

route("POST", "/v1/runs/:id/cancel", async (svc, _u, _b, p, actor) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  return await cancelRun(svc, { runId: p.id, actor });
});

route("POST", "/v1/runs/:id/approve", async (svc, _u, body, p, actor) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  try { return await approveTask(svc, { runId: p.id, taskId: body.task_id, decision: body.decision, actor }); }
  catch (e: any) { return { error: e.message, code: e.code }; }
});

route("POST", "/v1/runs/:id/reject", async (svc, _u, body, p, actor) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  try { return await rejectTask(svc, { runId: p.id, taskId: body.task_id, reason: body.reason, actor }); }
  catch (e: any) { return { error: e.message, code: e.code }; }
});

// ---- Tasks ----
route("GET", "/v1/tasks/:id", async (svc, _u, _b, p) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  const task = await svc.entities.LaunchTask.get(p.id).catch(() => null);
  if (!task) return { error: "Task not found", code: "NOT_FOUND" };
  return { task };
});

route("POST", "/v1/tasks/:id/retry", async (svc, _u, _b, p, actor) => {
  if (!p.id) return { error: "id is required", code: "BAD_REQUEST" };
  const task = await svc.entities.LaunchTask.get(p.id).catch(() => null);
  if (!task) return { error: "Task not found", code: "NOT_FOUND" };
  try { return await retryTask(svc, { runId: task.launch_id, taskId: task.id, actor }); }
  catch (e: any) { return { error: e.message, code: e.code }; }
});

// ---- Templates (versioned execution plans = DAGs) ----
route("POST", "/v1/templates", async (svc, _u, body, _p, _actor) => {
  try { return await defineTemplate(svc, { templateId: body.template_id, name: body.name, tasks: body.tasks, description: body.description, lifecycleGoal: body.lifecycle_goal, overwrite: body.overwrite, tenant: body.tenant }); }
  catch (e: any) { return { error: e.message, code: e.code }; }
});

route("GET", "/v1/templates", async (svc, _u, _b, _p) => {
  const rows = await svc.entities.PlanTemplate.filter({ active: true }).catch(() => []);
  const latest: Record<string, any> = {};
  for (const r of rows || []) if (!latest[r.template_id] || (r.version || 0) > (latest[r.template_id].version || 0)) latest[r.template_id] = r;
  return { templates: Object.values(latest).map((t: any) => ({ template_id: t.template_id, version: t.version, name: t.name, task_count: (t.tasks || []).length })) };
});

// ---- Agents (reuse shared validation; entity CRUD directly) ----
route("GET", "/v1/agents", async (svc, _u, body, _p) => {
  const q: any = {};
  if (body.business_id) q.business_id = body.business_id;
  const rows = await svc.entities.AIAgent.filter(q, "-created_date", body.limit || 50).catch(() => []);
  return { agents: rows || [] };
});

route("POST", "/v1/agents", async (svc, _u, body, _p, actor) => {
  if (!body.business_id || !body.name) return { error: "business_id and name are required", code: "BAD_REQUEST" };
  const v = validateAgentConfig(body.name, body.instructions || "", body.config || {});
  if (!v.ok) return { error: `Agent configuration is invalid: ${v.errors.join(" ")}`, code: "AGENT_CONFIG_INVALID", errors: v.errors };
  const business: any = await svc.entities.Business.get(body.business_id).catch(() => null);
  if (!business) return { error: "Business not found", code: "BUSINESS_NOT_FOUND" };
  const row = await svc.entities.AIAgent.create({
    tenant_id: business.tenant_id, business_id: business.id, provider_id: body.provider_id || null,
    name: body.name, purpose: body.purpose || [], instructions: body.instructions || "",
    status: body.status || "active", human_escalation_enabled: body.human_escalation_enabled ?? true,
    lead_capture_enabled: body.lead_capture_enabled ?? false, external_reference: body.external_reference || null,
    config: body.config || {}, version: 1, last_run_at: null,
  });
  return { agent: row };
});

// ---- Agent Teams (reuse shared helpers; entity CRUD directly) ----
route("GET", "/v1/agent-teams", async (svc, _u, body, _p) => {
  if (!body.business_id) return { error: "business_id is required", code: "BAD_REQUEST" };
  const rows = await svc.entities.AgentTeam.filter({ business_id: body.business_id }, "-created_date", 50).catch(() => []);
  return { teams: rows || [] };
});

route("POST", "/v1/agent-teams", async (svc, _u, body, _p, actor) => {
  if (!body.business_id || !body.team_id || !body.name || !Array.isArray(body.agents)) return { error: "business_id, team_id, name and agents[] are required", code: "BAD_REQUEST" };
  const business: any = await svc.entities.Business.get(body.business_id).catch(() => null);
  if (!business) return { error: "Business not found", code: "BUSINESS_NOT_FOUND" };
  const existing: any[] = await svc.entities.AgentTeam.filter({ business_id: business.id, team_id: body.team_id }).catch(() => []);
  const version = (existing || []).reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;
  const def: any = {
    tenant_id: business.tenant_id, business_id: business.id, team_id: body.team_id, name: body.name, description: body.description || "",
    version, status: "active", agents: body.agents, execution_mode: body.execution_mode || "dependent",
    entry_agent: body.entry_agent || (body.agents[0] && body.agents[0].key) || "",
    output_schema: body.output_schema || null, timeout_ms: body.timeout_ms ?? 120000,
    max_total_iterations: body.max_total_iterations ?? 20, max_total_tool_calls: body.max_total_tool_calls ?? 30,
    budget_limit: body.budget_limit ?? 0, approval_required: !!body.approval_required, enabled: body.enabled !== false,
    config_hash: "", created_by: actor,
  };
  def.config_hash = JSON.stringify(def);
  for (const r of existing || []) if (r.status === "active") await svc.entities.AgentTeam.update(r.id, { status: "superseded" }).catch(() => {});
  const row = await svc.entities.AgentTeam.create(def);
  return { team: row };
});

// ---- Capabilities + Providers (capability-based resolution surface) ----
route("GET", "/v1/capabilities", async (svc, _u, _b, _p) => {
  const providers = await svc.entities.Provider.filter({}).catch(() => []);
  const caps: Record<string, { capability: string; providers: any[] }> = {};
  for (const p of providers || []) for (const c of p.capabilities || []) {
    if (!caps[c]) caps[c] = { capability: c, providers: [] };
    caps[c].providers.push({ id: p.id, name: p.name, key: p.key, category: p.category, enabled: p.enabled, health: p.health_status });
  }
  return { capabilities: Object.values(caps) };
});

route("GET", "/v1/providers", async (svc, _u, body, _p) => {
  const q: any = {};
  if (body.category) q.category = body.category;
  const rows = await svc.entities.Provider.filter(q).catch(() => []);
  return { providers: rows || [] };
});

route("POST", "/v1/providers/resolve", async (svc, _u, body, _p) => {
  if (!body.business_id || !body.capability) return { error: "business_id and capability are required", code: "BAD_REQUEST" };
  return { resolved: await resolveProvider(svc, body.business_id, body.capability) };
});

// ---- Approvals (pending awaiting_approval tasks across runs) ----
route("GET", "/v1/approvals", async (svc, _u, body, _p) => {
  const q: any = { status: "awaiting_approval" };
  if (body.business_id) q.business_id = body.business_id;
  const rows = await svc.entities.LaunchTask.filter(q, "-created_date", body.limit || 100).catch(() => []);
  return { approvals: rows || [] };
});

// ---- Events (audit trail surface) ----
route("GET", "/v1/events", async (svc, _u, body, _p) => {
  const q: any = {};
  if (body.run_id) q.run_id = body.run_id;
  if (body.business_id) q.business_id = body.business_id;
  const rows = await svc.entities.AuditEvent.filter(q, "-created_date", body.limit || 100).catch(() => []);
  return { events: rows || [] };
});

function matchRoute(method: string, pathSegs: string[]): { handler: Handler; params: Record<string, string> } | null {
  for (const r of ROUTES) {
    if (r.method !== method || r.segs.length !== pathSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const rs = r.segs[i];
      const ps = pathSegs[i];
      if (rs.startsWith(":")) params[rs.slice(1)] = ps;
      else if (rs !== ps) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const svc = base44.asServiceRole;
    try { (svc as any).__base44 = base44; } catch {}
    await ensureSeedTemplates(svc).catch(() => {});
    const body = await req.json().catch(() => ({}));
    // Route is sent in-body as { method, path } so the single Base44 endpoint can
    // emulate a REST tree without path-routing support. (body.path is optional;
    // callers may also pass route="POST /v1/runs".)
    const method = String(body.method || req.method || "GET").toUpperCase();
    const path = String(body.path || body.route || "/");
    const pathSegs = path.split("?")[0].split("/").filter(Boolean);
    const match = matchRoute(method, pathSegs);
    if (!match) return Response.json({ error: `No ${method} route for ${path}`, code: "NOT_FOUND", version: VERSION }, { status: 404 });
    const actor = actorOf(user);
    const result = await match.handler(svc, user, body, match.params, actor);
    const status = result && result.error && result.code ? 400 : 200;
    return Response.json({ ...result, _version: VERSION }, { status });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error), code: error?.code }, { status: 500 });
  }
}