// Visual Workflow Builder — HTTP entry point (Phase 12).
//
// The studio is ONLY a designer over the existing Workflow Engine. It creates
// and edits PlanTemplates the engine already understands. There is NO new
// execution engine here — publishing calls the shared engine's defineTemplate,
// simulation is a pure dry-run, and the debugger reads existing AIExecution rows.
//
// Actions:
//   node-library | ai-build | validate | simulate |
//   save-draft | get-draft | list-drafts | publish | delete-draft |
//   versions | rollback | diff | clone | export | import | share | favorite |
//   debug-node

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { actorOf, verifyTenant } from "../../shared/ai/coo.ts";
import { defineTemplate, launchRun } from "../../shared/operations/engine.ts";
import { validateDag } from "../../shared/operations/dag.ts";
import { generateNodeLibrary, autoLayout, estimateCost } from "../../shared/studio/registry.ts";

const KNOWN = new Set(["generate_blueprint", "generate_website", "generate_seo", "generate_crm", "activate_marketing", "configure_domain", "verify_domain", "approval_gate"]);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    const actor = actorOf(user);

    if (action === "node-library") return Response.json(generateNodeLibrary());
    if (action === "ai-build") return Response.json(await aiBuild(svc, body, user));
    if (action === "validate") return Response.json(validateCanvas(body.canvas || body.tasks));
    if (action === "simulate") return Response.json(simulate(body.canvas || body.tasks));

    if (action === "save-draft") return Response.json(await saveDraft(svc, body, user, actor));
    if (action === "get-draft") return Response.json(await getDraft(svc, body, user));
    if (action === "list-drafts") return Response.json(await listDrafts(base44, body, user));
    if (action === "publish") return Response.json(await publish(svc, body, user, actor));
    if (action === "delete-draft") return Response.json(await deleteDraft(svc, body, user));
    if (action === "favorite") return Response.json(await favorite(svc, body, user));

    if (action === "versions") return Response.json(await versions(svc, body, user));
    if (action === "rollback") return Response.json(await rollback(svc, body, user));
    if (action === "diff") return Response.json(await diff(svc, body, user));
    if (action === "clone") return Response.json(await cloneTemplate(svc, body, user, actor));
    if (action === "export") return Response.json(await exportDraft(svc, body, user));
    if (action === "import") return Response.json(await importDraft(svc, body, user, actor));
    if (action === "share") return Response.json(await share(svc, body, user, actor));
    if (action === "debug-node") return Response.json(await debugNode(svc, body, user));
    if (action === "list-templates") return Response.json(await listTemplates(svc, body, user));
    if (action === "execution-preview") return Response.json(executionPreview(body.canvas || body.tasks));
    if (action === "execute") return Response.json(await executeTemplate(svc, body, user, actor));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error), code: error?.code }, { status: 500 });
  }
}

// ---------------- AI-ASSISTED BUILD ----------------
async function aiBuild(svc: any, body: any, user: any): Promise<any> {
  if (!body.prompt) throw Object.assign(new Error("prompt is required"), { code: "BAD_REQUEST" });
  const business = body.business_id ? await verifyTenant(svc, body.business_id, user) : null;
  const schema = { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: {
    key: { type: "string" }, type: { type: "string" }, title: { type: "string" }, description: { type: "string" },
    needs_approval: { type: "boolean" }, money_spending: { type: "boolean" }, capability: { type: "string" },
    depends_on: { type: "array", items: { type: "string" } },
  }, required: ["key", "type"] } } } };
  const ctx = business ? `Business: ${business.name} (${business.industry || "unknown"}). ` : "";
  const prompt = `Convert this natural-language automation into a workflow DAG of tasks.
Use these task types where possible (they run on the existing Workflow Engine): generate_blueprint, generate_website, generate_seo, generate_crm, activate_marketing, configure_domain, verify_domain, approval_gate. Other types (exec.<role>, connector.<key>, notify.email, noop.delay) are allowed for AI-executive / integration / notification steps.
Every task needs a snake_case key, a human title, and depends_on referencing earlier keys. Add an approval_gate before any money-spending step. ${ctx}
Request: ${body.prompt}`;
  let plan: any;
  try { plan = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { plan = { tasks: [{ key: "step_1", type: "approval_gate", title: "Review", depends_on: [] }] }; }
  const tasks = sanitize(plan.tasks || []);
  const layout = autoLayout(tasks);
  const v = validateDag(tasks);
  return { tasks, canvas: layout, validation: v };
}

// ---------------- VALIDATE ----------------
export function validateCanvas(canvasOrTasks: any): any {
  const tasks = Array.isArray(canvasOrTasks) ? canvasOrTasks : deriveTasks(canvasOrTasks);
  const dag = validateDag(tasks);
  const errors = [...dag.errors];
  const warnings = [...dag.warnings];
  // Disconnected: a non-structural node with no deps and nothing depending on it (and not the only root) is suspicious.
  const tasksForKey = new Set(tasks.map((t) => t.key));
  const referenced = new Set<string>();
  for (const t of tasks) for (const d of t.depends_on || []) referenced.add(d);
  const roots = tasks.filter((t) => !t.depends_on.length);
  const orphans = tasks.filter((t) => !t.depends_on.length && !referenced.has(t.key) && tasks.length > 1);
  if (orphans.length) warnings.push(`Disconnected node(s): ${orphans.map((o) => o.key).join(", ")}`);
  // Per-node error map (so the UI can badge affected nodes — Test C/D).
  const node_errors: Record<string, string[]> = {};
  // Unsupported capability → ERROR (Test D). The generic per-node mapping below
  // attributes the prefixed error to its node, so no separate push is needed here.
  for (const t of tasks) if (!KNOWN.has(t.type) && !/^(exec\.|connector\.|notify\.|noop\.)/.test(t.type)) {
    errors.push(`${t.key}: Unsupported capability "${t.type}" — the Workflow Engine has no adapter for this task.`);
  }
  // Highlight every node that sits on a circular dependency (Test C: affected nodes).
  if (dag.errors.some((e) => e.includes("Circular dependency"))) {
    const adj: Record<string, string[]> = {};
    for (const t of tasks) for (const d of t.depends_on || []) (adj[t.key] ||= []).push(d);
    for (const t of tasks) {
      const seen = new Set<string>(); const stack: string[] = [t.key];
      while (stack.length) {
        const k = stack.pop() as string;
        if (k === t.key && seen.size) { (node_errors[t.key] ||= []).push("Part of a circular dependency"); break; }
        if (seen.has(k)) continue;
        seen.add(k);
        for (const d of adj[k] || []) stack.push(d);
      }
    }
  }
  // At least one starting node.
  if (tasks.length && roots.length === 0 && !errors.some((e) => e.includes("Circular"))) errors.push("No starting node — every task depends on another");
  // Invalid approval: approval_gate that is depended on by nothing.
  const gates = tasks.filter((t) => t.type === "approval_gate");
  for (const g of gates) if (!referenced.has(g.key)) warnings.push(`Approval "${g.key}" gates nothing (no downstream dependents)`);
  // Per-node mapping for cycle/unknown-dep errors so the UI can badge the node.
  for (const e of errors) { const m = e.match(/^"?(.+?)"?(?: depends on unknown task|" depends on itself|: )/); if (m) (node_errors[m[1]] ||= []).push(e); }
  return { ok: errors.length === 0, errors, warnings, task_count: tasks.length, roots: roots.map((r) => r.key), node_errors };
}

function deriveTasks(canvas: any): any[] {
  const nodes: any[] = (canvas?.nodes || []).filter((n: any) => !n.structural);
  const depMap: Record<string, string[]> = {};
  for (const e of canvas?.edges || []) (depMap[e.to] ||= []).push(e.from);
  return nodes.map((n: any) => ({
    key: n.id, type: n.engine_type || n.type, capability: n.capability, title: n.title,
    depends_on: (depMap[n.id] || []).filter((d) => nodes.find((x) => x.id === d)),
    needs_approval: !!n.needs_approval, money_spending: !!n.money_spending,
    retryable: (n.max_retries ?? 3) !== 0, max_retries: n.max_retries ?? 3,
  }));
}

// ---------------- SIMULATE (dry-run, no engine calls) ----------------
export function simulate(canvasOrTasks: any): any {
  const tasks = Array.isArray(canvasOrTasks) ? canvasOrTasks : deriveTasks(canvasOrTasks);
  const v = validateDag(tasks);
  if (!v.ok) return { ok: false, errors: v.errors, execution_path: [], approvals: [], totals: { runtime_ms: 0, ai_cost: 0, api_cost: 0 } };
  // Topological order (Kahn).
  const indeg: Record<string, number> = {};
  for (const t of tasks) indeg[t.key] = 0;
  for (const t of tasks) for (const d of t.depends_on || []) indeg[t.key]++;
  let queue = tasks.filter((t) => indeg[t.key] === 0).map((t) => t.key);
  const order: string[] = [];
  const adj: Record<string, string[]> = {};
  for (const t of tasks) for (const d of t.depends_on || []) (adj[d] ||= []).push(t.key);
  let waves = 0;
  while (queue.length && waves < 1000) {
    const next: string[] = [];
    for (const k of queue) { order.push(k); for (const c of adj[k] || []) if (--indeg[c] === 0) next.push(c); }
    queue = next; waves++;
  }
  if (order.length < tasks.length) return { ok: false, errors: ["Could not order tasks (cycle or disconnected)"], execution_path: [], approvals: [], totals: { runtime_ms: 0, ai_cost: 0, api_cost: 0 } };

  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const nodeCost = (k: string) => estimateCost({ type: byKey.get(k)?.type });
  // Simulate waves of parallel execution; approval gates add a human wait.
  let t = 0, ai = 0, api = 0;
  const waiting: string[] = [], blocked: string[] = [], approvals: string[] = [];
  const completedAt: Record<string, number> = {};
  for (const k of order) {
    const task = byKey.get(k);
    const readyAt = Math.max(t, ...(task.depends_on || []).map((d) => completedAt[d] ?? 0));
    if (task.type === "approval_gate") { approvals.push(k); completedAt[k] = readyAt; waiting.push(k); continue; }
    const c = nodeCost(k);
    if (c.runtime_ms === 0 && task.type !== "approval_gate") { /* delay/notify maybe 0 */ }
    t = Math.max(t, readyAt + c.runtime_ms);
    completedAt[k] = readyAt + c.runtime_ms;
    ai += c.ai; api += c.api;
  }
  return { ok: true, execution_path: order, approvals, waiting, blocked, estimated_runtime_ms: t, estimated_runtime_human: humanMs(t), totals: { ai_cost: round(ai), api_cost: round(api), total_cost: round(ai + api) }, wave_count: waves };
}

// ---------------- DRAFTS ----------------
async function saveDraft(svc: any, body: any, user: any, actor: string): Promise<any> {
  const business = await verifyTenant(svc, body.business_id, user);
  const canvas = body.canvas || { nodes: [], edges: [] };
  if (body.draft_id) {
    const rows: any[] = await svc.entities.WorkflowDraft.filter({ id: body.draft_id }).catch(() => []);
    const d = (rows || [])[0];
    if (!d || (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin")) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
    const update: any = { canvas, name: body.name ?? d.name, description: body.description ?? d.description, trigger: body.trigger ?? d.trigger, category: body.category ?? d.category, version: (d.version || 1) + 1 };
    await svc.entities.WorkflowDraft.update(d.id, update);
    return { draft: await svc.entities.WorkflowDraft.get(d.id) };
  }
  const row: any = await svc.entities.WorkflowDraft.create({
    tenant_id: business.tenant_id, business_id: business.id, name: body.name || "Untitled Workflow", description: body.description || "",
    status: "draft", canvas, trigger: body.trigger || { type: "manual", config: {} }, category: body.category || "general",
    version: 1, created_by: actor,
  });
  return { draft: row };
}

async function getDraft(svc: any, body: any, user: any): Promise<any> {
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin" && !(body.share_token && d.share_token === body.share_token)) {
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  }
  return { draft: d };
}

async function listDrafts(base44: any, body: any, user: any): Promise<any> {
  const filter: any = body.business_id ? { business_id: body.business_id } : { tenant_id: user.data?.tenant_id };
  if (body.status) filter.status = body.status;
  const rows: any[] = await base44.entities.WorkflowDraft.filter(filter, "-updated_date", 100).catch(() => []);
  return { drafts: rows || [] };
}

async function deleteDraft(svc: any, body: any, user: any): Promise<any> {
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  await svc.entities.WorkflowDraft.update(d.id, { status: "archived" }).catch(() => {});
  return { archived: d.id };
}

async function favorite(svc: any, body: any, user: any): Promise<any> {
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  await svc.entities.WorkflowDraft.update(d.id, { favorite: !!body.favorite });
  return { draft: await svc.entities.WorkflowDraft.get(d.id) };
}

// ---------------- PUBLISH (→ existing Workflow Engine) ----------------
async function publish(svc: any, body: any, user: any, actor: string): Promise<any> {
  // Publishing creates a PlanTemplate (admin-only by RLS). asServiceRole bypasses
  // RLS, so enforce the role explicitly server-side — do not rely on hiding the nav.
  if (user.role !== "admin") throw Object.assign(new Error("Only admins can publish workflow templates"), { code: "FORBIDDEN" });
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });

  const tasks = deriveTasks(d.canvas);
  // Publish uses the STRICT validate (unsupported capabilities block publishing — Test D).
  const v = validateCanvas(d.canvas);
  if (!v.ok) throw Object.assign(new Error(`Cannot publish: ${v.errors.join("; ")}`), { code: "PLAN_INVALID", detail: v });

  const templateId = d.template_id || `wf_${d.id}`;
  // Reuse the engine's single source of template creation (no duplicate engine).
  const def = await defineTemplate(svc, {
    templateId, name: d.name, tasks, description: d.description, lifecycleGoal: "operating",
    tenant: body.system ? "system" : d.tenant_id,
  });
  // Only ONE active version per template_id: deactivate every prior active version so
  // launchRun's latestActiveTemplate resolves to the new one. Existing LaunchPlan runs
  // keep their own plan_version snapshot, so they remain immutable (Test H).
  const priorActive: any[] = await svc.entities.PlanTemplate.filter({ template_id: templateId, active: true }).catch(() => []);
  for (const p of priorActive) if ((p.version || 0) !== def.version) await svc.entities.PlanTemplate.update(p.id, { active: false }).catch(() => {});
  await svc.entities.WorkflowDraft.update(d.id, {
    status: "published", template_id: templateId, published_version: def.version, tasks,
  });
  // Mark this draft as a reusable template if requested.
  if (body.as_template) await svc.entities.WorkflowDraft.update(d.id, { is_template: true }).catch(() => {});
  return { published: true, template_id: templateId, version: def.version, validated: def.validated, warnings: v.warnings };
}

// ---------------- VERSIONING ----------------
async function versions(svc: any, body: any, user: any): Promise<any> {
  const rows: any[] = await svc.entities.PlanTemplate.filter({ template_id: body.template_id }, "-version", 50).catch(() => []);
  let list = rows || [];
  if (user.role !== "admin") list = list.filter((r) => r.tenant_id === "system" || r.tenant_id === user.data?.tenant_id);
  return { template_id: body.template_id, versions: list.map((r) => ({ version: r.version, name: r.name, active: r.active, created_date: r.created_date, tenant_id: r.tenant_id, task_count: (r.tasks || []).length })) };
}

async function rollback(svc: any, body: any, user: any): Promise<any> {
  // Flipping active version is an admin-only write (PlanTemplate RLS). Enforce it.
  if (user.role !== "admin") throw Object.assign(new Error("Only admins can roll back template versions"), { code: "FORBIDDEN" });
  const rows: any[] = await svc.entities.PlanTemplate.filter({ template_id: body.template_id }).catch(() => []);
  if (!rows || !rows.length) throw Object.assign(new Error("Template not found"), { code: "NOT_FOUND" });
  for (const r of rows) {
    const active = r.version === body.version;
    if (user.role !== "admin" && r.tenant_id !== "system" && r.tenant_id !== user.data?.tenant_id) continue;
    await svc.entities.PlanTemplate.update(r.id, { active }).catch(() => {});
  }
  return { template_id: body.template_id, rolled_back_to: body.version };
}

async function diff(svc: any, body: any, user: any): Promise<any> {
  const rows: any[] = await svc.entities.PlanTemplate.filter({ template_id: body.template_id }).catch(() => []);
  const a: any = (rows || []).find((r) => r.version === body.versionA);
  const b: any = (rows || []).find((r) => r.version === body.versionB);
  if (!a || !b) throw Object.assign(new Error("Version not found"), { code: "NOT_FOUND" });
  const ta = new Map((a.tasks || []).map((t) => [t.key, t]));
  const tb = new Map((b.tasks || []).map((t) => [t.key, t]));
  const added = (b.tasks || []).filter((t) => !ta.has(t.key)).map((t) => t.key);
  const removed = (a.tasks || []).map((t) => t.key).filter((k) => !tb.has(k));
  const changed: any[] = [];
  for (const [k, t] of tb) {
    const o = ta.get(k);
    if (o && JSON.stringify({ ...o, depends_on: (o.depends_on || []).sort() }) !== JSON.stringify({ ...t, depends_on: (t.depends_on || []).sort() })) changed.push(k);
  }
  return { template_id: body.template_id, versionA: body.versionA, versionB: body.versionB, added, removed, changed };
}

async function cloneTemplate(svc: any, body: any, user: any, actor: string): Promise<any> {
  const business = await verifyTenant(svc, body.business_id, user);
  const rows: any[] = await svc.entities.PlanTemplate.filter({ template_id: body.template_id, active: true }).catch(() => []);
  const tmpl = (rows || []).sort((a, b) => (b.version || 0) - (a.version || 0))[0];
  if (!tmpl) throw Object.assign(new Error("Template not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && tmpl.tenant_id !== "system" && tmpl.tenant_id !== user.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const tasks = (tmpl.tasks || []).map((t) => ({ ...t, title: t.key.replace(/_/g, " ") }));
  const layout = autoLayout(tasks);
  const row: any = await svc.entities.WorkflowDraft.create({
    tenant_id: business.tenant_id, business_id: business.id, name: `${tmpl.name} (copy)`, description: tmpl.description || "",
    status: "draft", canvas: layout, trigger: { type: "manual", config: {} }, category: "general", version: 1, created_by: actor,
  });
  return { draft: row };
}

async function exportDraft(svc: any, body: any, user: any): Promise<any> {
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin" && !(body.share_token && d.share_token === body.share_token)) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  return { workflow: { name: d.name, description: d.description, canvas: d.canvas, trigger: d.trigger, category: d.category, schema: "launchos.workflow/v1" } };
}

async function importDraft(svc: any, body: any, user: any, actor: string): Promise<any> {
  const business = await verifyTenant(svc, body.business_id, user);
  const w = body.workflow || body.json;
  if (!w || !w.canvas) throw Object.assign(new Error("Invalid workflow JSON (expected {canvas, name})"), { code: "BAD_REQUEST" });
  const row: any = await svc.entities.WorkflowDraft.create({
    tenant_id: business.tenant_id, business_id: business.id, name: body.name || w.name || "Imported Workflow", description: w.description || "",
    status: "draft", canvas: w.canvas, trigger: w.trigger || { type: "manual", config: {} }, category: w.category || "general", version: 1, created_by: actor,
  });
  return { draft: row };
}

async function share(svc: any, body: any, user: any, actor: string): Promise<any> {
  const d: any = await svc.entities.WorkflowDraft.get(body.draft_id).catch(() => null);
  if (!d) throw Object.assign(new Error("Draft not found"), { code: "NOT_FOUND" });
  if (user?.data?.tenant_id && d.tenant_id !== user?.data?.tenant_id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const token = d.share_token || randToken();
  // Publish to the system namespace so every tenant can read it (PlanTemplate RLS allows tenant_id 'system').
  const tasks = deriveTasks(d.canvas);
  const ok = validateDag(tasks);
  let published = null;
  if (tasks.length && ok.ok) {
    const templateId = d.template_id || `wf_${d.id}`;
    published = await defineTemplate(svc, { templateId, name: d.name, tasks, description: d.description, lifecycleGoal: "operating", tenant: "system" }).catch(() => null);
  }
  await svc.entities.WorkflowDraft.update(d.id, { share_token: token, is_template: true });
  return { draft_id: d.id, share_token: token, published };
}

// ---------------- DEBUGGER (reads existing AIExecution rows) ----------------
async function debugNode(svc: any, body: any, user: any): Promise<any> {
  const tasks: any[] = await svc.entities.LaunchTask.filter({ launch_id: body.run_id, task_key: body.task_key }).catch(() => []);
  const task = (tasks || [])[0];
  if (!task) throw Object.assign(new Error("Task not found in this run"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && user.data?.tenant_id && task.tenant_id !== user?.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const execs: any[] = await svc.entities.AIExecution.filter({ task_id: task.id }, "attempt", 50).catch(() => []);
  return {
    task: { id: task.id, task_key: task.task_key, status: task.status, provider_id: task.provider_id, retry_count: task.retry_count, max_retries: task.max_retries, attempt: task.attempt, duration_ms: task.duration_ms, error_code: task.error_code, error_detail: task.error_detail, input_context: task.input_context, output: task.output, logs: task.logs || [] },
    executions: (execs || []).map((e: any) => ({ id: e.id, attempt: e.attempt, stage: e.stage, provider: e.provider, model: e.model, success: e.success, tokens: e.tokens, estimated_cost: e.estimated_cost, latency_ms: e.latency_ms, duration_ms: e.duration_ms, error_code: e.error_code, retryable: e.retryable, completed_at: e.completed_at })),
  };
}

// ---------------- TEMPLATE LIBRARY + EXECUTION ----------------
// Lists published PlanTemplates (latest active version per template_id) the user may
// open/duplicate/run. Respects the existing PlanTemplate RLS (system + own tenant).
async function listTemplates(svc: any, _body: any, user: any): Promise<any> {
  const rows: any[] = await svc.entities.PlanTemplate.filter({ active: true }, "-version", 300).catch(() => []);
  let list = rows || [];
  if (user.role !== "admin") list = list.filter((r: any) => r.tenant_id === "system" || r.tenant_id === user.data?.tenant_id);
  const byId = new Map<string, any>();
  for (const r of list) { const ex = byId.get(r.template_id); if (!ex || (r.version || 0) > (ex.version || 0)) byId.set(r.template_id, r); }
  const templates = [...byId.values()].map((r: any) => {
    const prev = executionPreview(r.tasks);
    return {
      template_id: r.template_id, version: r.version, name: r.name, description: r.description,
      tenant_id: r.tenant_id, task_count: (r.tasks || []).length, active: r.active,
      approval_gates: (r.tasks || []).filter((t: any) => t.type === "approval_gate").length,
      dependencies_waiting: prev.dependencies_waiting || 0,
      // Per-task dependency summary so the Run Preview can render dependency info
      // without an extra round trip. Pure read of the published snapshot.
      tasks: (r.tasks || []).map((t: any) => ({ key: t.key, type: t.type, depends_on: t.depends_on || [], needs_approval: !!t.needs_approval, money_spending: !!t.money_spending })),
      execution_path: prev.execution_path || [],
      created_date: r.created_date, updated_date: r.updated_date,
    };
  });
  return { templates };
}

// Execution preview: counts, approval gates, topological execution path. Pure dry-run,
// no engine calls. Mirrors simulate() but returns only what the Run dialog needs.
function executionPreview(canvasOrTasks: any): any {
  const tasks = Array.isArray(canvasOrTasks) ? canvasOrTasks : deriveTasks(canvasOrTasks);
  const v = validateDag(tasks);
  if (!v.ok) return { ok: false, errors: v.errors, task_count: tasks.length, approval_gates: 0, execution_path: [] };
  const indeg: Record<string, number> = {};
  for (const t of tasks) indeg[t.key] = 0;
  for (const t of tasks) for (const d of t.depends_on || []) indeg[t.key]++;
  let queue = tasks.filter((t) => indeg[t.key] === 0).map((t) => t.key);
  const order: string[] = []; const adj: Record<string, string[]> = {};
  for (const t of tasks) for (const d of t.depends_on || []) (adj[d] ||= []).push(t.key);
  while (queue.length) { const next: string[] = []; for (const k of queue) { order.push(k); for (const c of adj[k] || []) if (--indeg[c] === 0) next.push(c); } queue = next; }
  if (order.length < tasks.length) return { ok: false, errors: ["Could not order tasks (cycle or disconnected)"], task_count: tasks.length, approval_gates: 0, execution_path: [] };
  const approvalGates = tasks.filter((t) => t.type === "approval_gate").length;
  const waiting = tasks.filter((t) => (t.depends_on || []).length > 1).length;
  return { ok: true, task_count: tasks.length, approval_gates: approvalGates, dependencies_waiting: waiting, execution_path: order };
}

// Execute a PUBLISHED template by calling the existing Workflow Engine's launchRun.
// No BuilderRun / no parallel runtime — the builder is an authoring layer. The
// resulting LaunchPlan is automatically visible in /workflows (Test G).
async function executeTemplate(svc: any, body: any, user: any, actor: string): Promise<any> {
  if (!body.template_id || !body.business_id) throw Object.assign(new Error("template_id and business_id are required"), { code: "BAD_REQUEST" });
  const business = await verifyTenant(svc, body.business_id, user);
  const rows: any[] = await svc.entities.PlanTemplate.filter({ template_id: body.template_id, active: true }).catch(() => []);
  if (!rows || !rows.length) throw Object.assign(new Error("Published template not found"), { code: "NOT_FOUND" });
  const tmpl = rows.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
  if (user.role !== "admin" && tmpl.tenant_id !== "system" && tmpl.tenant_id !== user.data?.tenant_id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const res = await launchRun(svc, { businessId: business.id, templateId: body.template_id, goal: body.goal || `Run ${tmpl.name}`, requestedBy: actor });
  return { run_id: res.run.id, template_id: body.template_id, version: res.run.plan_version, idempotent: !!res.idempotent, status: res.run.status };
}

// ---------------- HELPERS ----------------
function sanitize(tasks: any[]): any[] {
  const out: any[] = []; const keys = new Set<string>();
  for (const t of tasks || []) {
    if (!t || !t.key || !t.type || keys.has(t.key)) continue;
    keys.add(t.key);
    out.push({ key: t.key, type: t.type, title: t.title || t.key, description: t.description || "", capability: t.capability, depends_on: (t.depends_on || []).filter((d: string) => keys.has(d) && d !== t.key), needs_approval: !!t.needs_approval, money_spending: !!t.money_spending });
  }
  const all = new Set(out.map((o) => o.key));
  for (const o of out) o.depends_on = (o.depends_on || []).filter((d: string) => all.has(d) && d !== o.key);
  return out;
}
function round(n: number): number { return Math.round(n * 10000) / 10000; }
function humanMs(ms: number): string { if (ms < 1000) return `${ms}ms`; if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`; const m = Math.floor(ms / 60000); const s = Math.round((ms % 60000) / 1000); return `${m}m ${s}s`; }
function randToken(len = 20): string { const chars = "abcdefghijklmnopqrstuvwxyz0123456789"; let out = ""; for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }