// AI Executive Team (Phase 10 — AI Business Operating System).
//
// Specialised executives (CEO, CMO, Sales, Operations, Support, Finance) that
// ORCHESTRATE the existing engines instead of duplicating logic:
//   - Observation Engine  → reads BusinessObservation (written by aiBusinessManager)
//   - Recommendation Engine → writes LaunchRecommendation (role-specific lens)
//   - Goals Engine         → decomposes a BusinessGoal into a workflow DAG and
//                            launches it on the Workflow Engine DIRECTLY (imports
//                            the shared engine, no HTTP hop, no auth friction)
//   - Business Memory      → executive briefings + approved-action allowlist
//   - Autonomous Execution → only actions the user has approved once may auto-run
//
// The customer still talks to ONE AI; executives collaborate internally.
//
// Autonomous/aggregate entry points (run by the workflow):
//   morning-briefing | run-all
// Per-business actions:
//   seed-executives | run-executive | briefing | create-goal | plan-goal |
//   collaborate | approve-action | auto-execute
// Reads: list-executives | list-goals | get-briefing

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { EXECUTIVES, ROLES, getExecutive, GOAL_TASK_TYPES } from "../../shared/executives/registry.ts";
import { defineTemplate, launchRun } from "../../shared/operations/engine.ts";
import { requireBusinessId, verifyTenant, actorOf, collectMemory, upsertMemory, pad, isoWeek, listActiveBusinesses } from "../../shared/ai/coo.ts";
import { getActiveBlueprint, blueprintContextSlice } from "../../shared/industries/engine.ts";

const DAY = 86400000;
const READ_ACTIONS = new Set(["list-executives", "list-goals", "get-briefing"]);
const AUTONOMOUS_ACTIONS = new Set([
  "morning-briefing", "run-all", "run-executive", "briefing", "plan-goal", "auto-execute",
]);
const VALID_GOAL_TYPES = new Set(GOAL_TASK_TYPES);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    if (user.role !== "admin" && AUTONOMOUS_ACTIONS.has(action)) {
      return Response.json({ error: "Admin only" }, { status: 403 });
    }
    const svc = base44.asServiceRole;
    const actor = actorOf(user, "ai_executives");
    const rd = user ? base44 : svc;

    if (action === "seed-executives") return Response.json(await seedExecutives(svc, requireBusinessId(body)));
    if (action === "run-executive") return Response.json(await runExecutive(svc, requireBusinessId(body), body.role, actor));
    if (action === "briefing") return Response.json(await briefing(svc, requireBusinessId(body), body.kind || "morning", body.role, actor));
    if (action === "create-goal") return Response.json(await createGoal(svc, body, user, actor));
    if (action === "plan-goal") return Response.json(await planGoal(svc, requireBusinessId(body), body.goal_id, actor));
    if (action === "collaborate") return Response.json(await collaborate(svc, requireBusinessId(body), body, actor));
    if (action === "approve-action") return Response.json(await approveAction(svc, requireBusinessId(body), body.recommendation_id, user));
    if (action === "auto-execute") return Response.json(await autoExecute(svc, requireBusinessId(body), actor));

    if (action === "morning-briefing") return Response.json(await runAll(svc, body.business_id, "morning", actor));
    if (action === "run-all") return Response.json(await runAll(svc, body.business_id, body.kind || "morning", actor));

    if (action === "list-executives") return Response.json(await listExecutives(rd, body, user));
    if (action === "list-goals") return Response.json(await listGoals(rd, body, user));
    if (action === "get-briefing") return Response.json(await getBriefing(rd, body, user));

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

// requireBusinessId + verifyTenant imported from ../../shared/ai/coo.ts

// =================================================================
// SEED
// =================================================================
async function seedExecutives(svc: any, businessId: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const existing: any[] = await svc.entities.BusinessExecutive.filter({ business_id: businessId }).catch(() => []);
  const have = new Set((existing || []).map((e: any) => e.role));
  const created: any[] = [];
  for (const role of ROLES) {
    if (have.has(role)) continue;
    const def = EXECUTIVES[role];
    const row = await svc.entities.BusinessExecutive.create({
      tenant_id: business.tenant_id, business_id: businessId, role, title: def.title, department: def.department,
      responsibilities: def.responsibilities, status: "active", posture_score: null, active_goals: [], settings: { architecture_only: !!def.architecture_only },
    });
    created.push(row.id);
  }
  const all = await svc.entities.BusinessExecutive.filter({ business_id: businessId }).catch(() => []);
  return { business_id: businessId, created: created.length, executives: (all || []).map((e: any) => ({ role: e.role, title: e.title, status: e.status, posture: e.posture_score })) };
}

// =================================================================
// RUN ONE EXECUTIVE (role-specific lens over shared observations)
// =================================================================
async function runExecutive(svc: any, businessId: string, role: string, actor: string): Promise<any> {
  const def = getExecutive(role);
  if (!def) throw Object.assign(new Error(`Unknown executive role: ${role}`), { code: "BAD_ROLE" });
  if (def.architecture_only) return { business_id: businessId, role, architecture_only: true, note: "Finance is architecture-only in Phase 10." };
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });

  const obs: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }, "-generated_at", 60).catch(() => []);
  const domainObs = obs.filter((o: any) => def.observation_sources.includes(o.source));
  const memory = await collectMemory(svc, businessId);
  const goals: any[] = await svc.entities.BusinessGoal.filter({ business_id: businessId, owner_role: role, status: "executing" }, "-created_date", 10).catch(() => []);

  const schema = {
    type: "object",
    properties: {
      posture_score: { type: "number" },
      summary: { type: "string" },
      recommendations: { type: "array", items: { type: "object", properties: {
        key: { type: "string" }, title: { type: "string" }, category: { type: "string", enum: def.recommendation_categories.length ? def.recommendation_categories : ["other"] },
        priority: { type: "number" }, rationale: { type: "string" }, action_target: { type: "string" },
        confidence: { type: "number" }, expected_impact: { type: "string" }, estimated_effort: { type: "string", enum: ["low", "medium", "high"] },
        decision: { type: "string", enum: ["recommend", "auto_fix", "ask_user", "escalate", "ignore"] }, approval_required: { type: "boolean" },
      }, required: ["key", "title", "priority"] } },
    },
  };

  let industrySlice: any = null;
  try { if (business.industry_key) { const ib = await getActiveBlueprint(svc, business.industry_key, business.tenant_id); if (ib) industrySlice = blueprintContextSlice(ib); } } catch {}

  const prompt = `You are the ${def.title} of "${business.name}"${business.industry ? ", a " + business.industry : ""}.
Your responsibilities: ${def.responsibilities.join(", ")}.
INDUSTRY CONTEXT — a "${industrySlice?.industry_label || business.industry || "general"}" business. Tailor recommendations to this industry's norms (typical services, pricing, funnel, KPIs, risks). Industry Blueprint: ${industrySlice ? JSON.stringify(industrySlice) : "(generic — use general best practice)"}.
Reason ONLY over the observations from your domain (${def.observation_sources.join(", ")}); leave other domains to their executives.

Decide a posture score (0-100) for your domain, write a one-line summary, and produce concrete recommendations. Each recommendation needs priority (0-100), rationale, confidence (0-1), expected impact, effort, a decision (auto_fix only for safe reversible low-risk actions you may self-execute once approved), and approval_required (true unless decision=auto_fix). Respect the business memory (brand tone, past approvals). Plain language, no jargon.

DOMAIN OBSERVATIONS:
${JSON.stringify(domainObs.slice(0, 25), null, 2)}

ACTIVE GOALS YOU OWN:
${JSON.stringify(goals.map((g) => g.title), null, 2)}

MEMORY:
${JSON.stringify(memory, null, 2)}`;

  let plan: any;
  try { plan = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { plan = fallbackExecutive(def, domainObs); }

  const iso = new Date().toISOString();
  let created = 0;
  for (const r of plan.recommendations || []) {
    if (!r.key || !r.title) continue;
    const existing: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, key: `${role}.${r.key}`, status: "open" }).catch(() => []);
    const doc = {
      tenant_id: business.tenant_id, business_id: businessId, launch_id: `exec:${role}:${businessId}`,
      key: `${role}.${r.key}`, title: r.title, category: def.recommendation_categories.includes(r.category) ? r.category : (def.recommendation_categories[0] || "other"),
      priority: Math.max(0, Math.min(100, r.priority ?? 50)), rationale: r.rationale || "", action_label: "Open", action_target: r.action_target || "",
      status: "open", confidence: r.confidence ?? 0.7, expected_impact: r.expected_impact || "", estimated_effort: r.estimated_effort || "low",
      decision: r.decision || "recommend", source_observations: [],
      generated_at: iso, provenance: { executive: role, actor, source: "ai_executives", architecture_only: false, approval_required: r.approval_required !== false },
    };
    if (existing && existing.length) await svc.entities.LaunchRecommendation.update(existing[0].id, doc).catch(() => {});
    else { await svc.entities.LaunchRecommendation.create(doc); created++; }
  }

  const execRow: any[] = await svc.entities.BusinessExecutive.filter({ business_id: businessId, role }).catch(() => []);
  if (execRow && execRow.length) {
    await svc.entities.BusinessExecutive.update(execRow[0].id, { posture_score: plan.posture_score ?? null, last_run_at: iso }).catch(() => {});
  }
  return { business_id: businessId, role, posture: plan.posture_score, summary: plan.summary, created, observations_in_domain: domainObs.length };
}

function fallbackExecutive(def: any, obs: any[]): any {
  const critical = obs.filter((o) => o.severity === "critical").length;
  const posture = Math.max(0, 100 - critical * 25 - Math.min(40, obs.length * 3));
  return { posture_score: posture, summary: `${def.title} reporting ${obs.length} signals in domain.`, recommendations: [] };
}

// =================================================================
// BRIEFINGS (CEO aggregates; others specialise)
// =================================================================
async function briefing(svc: any, businessId: string, kind: string, role: string | undefined, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });

  let executives: string[];
  if (role) {
    const def = getExecutive(role);
    if (!def) throw Object.assign(new Error(`Unknown role: ${role}`), { code: "BAD_ROLE" });
    executives = [role];
  } else {
    // CEO aggregate uses every active executive's posture + recommendations.
    executives = ROLES.filter((r) => !EXECUTIVES[r].architecture_only);
  }

  const recos: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, status: "open" }, "-priority", 30).catch(() => []);
  const execRecos = recos.filter((r: any) => r.provenance && r.provenance.executive && executives.includes(r.provenance.executive));
  const execs: any[] = await svc.entities.BusinessExecutive.filter({ business_id: businessId }).catch(() => []);
  const obs = await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }, "-generated_at", 30).catch(() => []);
  const memory = await collectMemory(svc, businessId);
  const now = new Date();
  const periodKey = kind === "weekly" ? `weekly:${now.getFullYear()}-W${isoWeek(now)}` : kind === "monthly" ? `monthly:${now.getFullYear()}-${pad(now.getMonth() + 1)}` : kind === "quarterly" ? `quarterly:${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}` : `${kind}:${now.toISOString().slice(0, 10)}`;

  const schema = { type: "object", properties: {
    headline: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: {
      title: { type: "string" }, body: { type: "array", items: { type: "string" } },
    }, required: ["title"] } },
    risks: { type: "array", items: { type: "string" } },
    ask: { type: "string", description: "The one thing the owner should approve or do." },
  } };

  const tone = kind === "morning" ? "morning executive brief" : kind === "evening" ? "evening summary of what happened today and what carries to tomorrow" : kind === "weekly" ? "weekly executive review" : kind === "monthly" ? "monthly executive report" : "quarterly strategy report";
  const prompt = `Write the ${tone} for "${business.name}"${role ? `, from the ${getExecutive(role)?.title} 's perspective` : ", as the CEO aggregating all executives"}.
Tone: calm, confident, personal — like a C-suite reporting to the owner. No jargon, no emojis.
Use the executives' posture scores and their open recommendations. Group into sections (e.g. Marketing, Sales, Operations, Support). List risks. End with exactly one "ask" the owner should approve or do.

EXECUTIVES (posture):
${JSON.stringify(execs.map((e) => ({ role: e.role, title: e.title, posture: e.posture_score })))}

OPEN RECOMMENDATIONS (by executive):
${JSON.stringify(execRecos.slice(0, 20).map((r) => ({ exec: r.provenance?.executive, title: r.title, priority: r.priority, decision: r.decision })))}

OBSERVATIONS:
${JSON.stringify(obs.slice(0, 20))}

MEMORY:
${JSON.stringify(memory)}`;

  let payload: any;
  try { payload = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { payload = { headline: `${kind} brief for ${business.name}`, sections: [{ title: "Status", body: ["Systems operating."] }], risks: [], ask: "Review today's priorities." }; }

  const body = renderBrief(payload);
  const memory_id = await upsertMemory(svc, business, "executive_brief", periodKey, `${kind} executive brief — ${business.name}`, body, payload, { source: "ai", actor, period_date: now.toISOString().slice(0, 10), tags: [kind, role || "ceo"] });
  // Stamp the owning executive's last_briefing_at.
  for (const r of (role ? [role] : ["ceo"])) {
    const ex: any[] = await svc.entities.BusinessExecutive.filter({ business_id: businessId, role: r }).catch(() => []);
    if (ex && ex[0]) await svc.entities.BusinessExecutive.update(ex[0].id, { last_briefing_at: new Date().toISOString() }).catch(() => {});
  }
  return { business_id: businessId, kind, role: role || "ceo", memory_id, payload };
}

function renderBrief(p: any): string {
  const out: string[] = [];
  if (p.headline) out.push(p.headline, "");
  for (const s of p.sections || []) { out.push(s.title); for (const b of s.body || []) out.push(`• ${b}`); out.push(""); }
  if (p.risks?.length) { out.push("Risks"); for (const r of p.risks) out.push(`• ${r}`); out.push(""); }
  if (p.ask) out.push(`Ask: ${p.ask}`);
  return out.join("\n").trim();
}

// =================================================================
// GOALS ENGINE — goal → Workflow Engine DAG → launch
// =================================================================
async function createGoal(svc: any, body: any, user: any, actor: string): Promise<any> {
  const businessId = requireBusinessId(body);
  const business = await verifyTenant(svc, businessId, user);
  if (!body.title) throw Object.assign(new Error("title is required"), { code: "BAD_REQUEST" });
  const owner = body.owner_role || "ceo";
  if (!getExecutive(owner)) throw Object.assign(new Error(`Unknown owner_role: ${owner}`), { code: "BAD_ROLE" });
  const goal: any = await svc.entities.BusinessGoal.create({
    tenant_id: business.tenant_id, business_id: businessId, title: body.title, description: body.description || "",
    target_metric: body.target_metric || null, target_value: body.target_value ?? null, deadline: body.deadline || null,
    priority: body.priority || "medium", owner_role: owner, status: "draft", progress: 0, created_by: actor, provenance: { actor },
  });
  if (body.plan) await planGoal(svc, businessId, goal.id, actor);
  return { goal };
}

async function planGoal(svc: any, businessId: string, goalId: string, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const goal: any = await svc.entities.BusinessGoal.get(goalId).catch(() => null);
  if (!goal || goal.business_id !== businessId) throw Object.assign(new Error("Goal not found"), { code: "GOAL_NOT_FOUND" });
  await svc.entities.BusinessGoal.update(goalId, { status: "planning", decomposed_by: "ceo" }).catch(() => {});

  const memory = await collectMemory(svc, businessId);
  let industrySlice: any = null;
  try { if (business.industry_key) { const ib = await getActiveBlueprint(svc, business.industry_key, business.tenant_id); if (ib) industrySlice = blueprintContextSlice(ib); } } catch {}
  const schema = { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: {
    key: { type: "string" }, type: { type: "string", enum: GOAL_TASK_TYPES as any },
    depends_on: { type: "array", items: { type: "string" } }, needs_approval: { type: "boolean" }, capability: { type: "string" },
  }, required: ["key", "type"] } } } };
  const prompt = `You are the CEO AI decomposing a business goal into an execution plan that runs on the existing Workflow Engine.
Build a DAG of tasks using ONLY these task types (each is a real orchestrator adapter): ${GOAL_TASK_TYPES.join(", ")}.
Rules: every task needs a snake_case key, a type, depends_on referencing earlier keys, and needs_approval=true for anything that spends money or is irreversible. Plan to move the business toward the goal. Keep it 4-8 tasks.

GOAL: ${goal.title}
${goal.description ? "DETAIL: " + goal.description : ""}
${goal.target_metric ? "METRIC: " + goal.target_metric + (goal.target_value ? " target " + goal.target_value : "") : ""}
BUSINESS: ${business.name} (${business.industry || "unknown"})
INDUSTRY BLUEPRINT: ${industrySlice ? JSON.stringify(industrySlice) : "(generic)"}
MEMORY: ${JSON.stringify(memory)}`;

  let plan: any;
  try { plan = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { plan = { tasks: [{ key: "plan", type: "generate_blueprint", depends_on: [] }] }; }

  const tasks = sanitizeTasks(plan.tasks || []);
  if (!tasks.length) throw Object.assign(new Error("AI produced no valid tasks"), { code: "PLAN_EMPTY" });

  // Register the plan as a reusable template on the Workflow Engine, then launch it.
  const templateId = `goal_${goalId}`;
  let defined: any;
  try { defined = await defineTemplate(svc, { templateId, name: `Goal: ${goal.title}`, tasks, lifecycleGoal: "operating", tenant: business.tenant_id }); }
  catch (e: any) { throw Object.assign(new Error(`defineTemplate failed: ${e.message}`), { code: "PLAN_INVALID", detail: tasks }); }

  let launched: any;
  try { launched = await launchRun(svc, { businessId, templateId, goal: goal.title, requestedBy: `exec:ceo:${actor}`, input: { goal_id: goalId } }); }
  catch (e: any) { throw Object.assign(new Error(`launchRun failed: ${e.message}`), { code: "LAUNCH_FAILED" }); }

  const run = launched?.run;
  await svc.entities.BusinessGoal.update(goalId, {
    status: "executing", plan_template_id: templateId, plan_version: defined?.version, run_id: run?.id || null,
    task_count: tasks.length, provenance: { actor, decomposed_by: "ceo", defined_at: new Date().toISOString() },
  }).catch(() => {});

  // Attach the goal to the owning executive.
  const ex: any[] = await svc.entities.BusinessExecutive.filter({ business_id: businessId, role: goal.owner_role }).catch(() => []);
  if (ex && ex[0]) {
    const goals = (ex[0].active_goals || []).includes(goalId) ? ex[0].active_goals : [...(ex[0].active_goals || []), goalId];
    await svc.entities.BusinessExecutive.update(ex[0].id, { active_goals: goals }).catch(() => {});
  }

  return { goal_id: goalId, plan_template_id: templateId, run_id: run?.id, task_count: tasks.length, tasks };
}

// Ensure the AI DAG is valid for the Workflow Engine: unique keys, known types,
// deps reference existing keys, drop unknown deps. Falls back to a trivial plan.
function sanitizeTasks(tasks: any[]): any[] {
  const out: any[] = [];
  const keys = new Set<string>();
  for (const t of tasks) {
    if (!t || !t.key || !t.type) continue;
    if (keys.has(t.key)) continue;
    if (!VALID_GOAL_TYPES.has(t.type)) continue;
    keys.add(t.key);
    out.push({ key: t.key, type: t.type, depends_on: (t.depends_on || []).filter((d: string) => keys.has(d) || (tasks.find((x: any) => x.key === d) && out.find((o: any) => o.key === d))), needs_approval: !!t.needs_approval, capability: t.capability || undefined });
  }
  // Fix deps that reference later-defined keys (re-resolve against full set).
  const allKeys = new Set(out.map((o) => o.key));
  for (const o of out) o.depends_on = (o.depends_on || []).filter((d: string) => allKeys.has(d) && d !== o.key);
  return out;
}

// =================================================================
// COLLABORATION (one executive asks another; internal, never exposed)
// =================================================================
async function collaborate(svc: any, businessId: string, body: any, actor: string): Promise<any> {
  const from = body.from_role, to = body.to_role, request = body.request;
  if (!getExecutive(from) || !getExecutive(to)) throw Object.assign(new Error("Invalid from_role/to_role"), { code: "BAD_ROLE" });
  if (!request) throw Object.assign(new Error("request is required"), { code: "BAD_REQUEST" });
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const def = getExecutive(to);
  // Record the handoff in memory (auditable collaboration trail).
  await upsertMemory(svc, business, "decision", `collab:${from}:${to}:${Date.now()}`, `${getExecutive(from)?.title} → ${def?.title}`, request, { request }, { source: "ai", actor, tags: ["collaboration"] });

  const obs: any[] = await svc.entities.BusinessObservation.filter({ business_id: businessId, status: "open" }, "-generated_at", 40).catch(() => []);
  const domainObs = obs.filter((o: any) => def!.observation_sources.includes(o.source));
  const schema = { type: "object", properties: { answer: { type: "string" }, proposal: { type: "string" }, recommendation: { type: "object", properties: { title: { type: "string" }, action_target: { type: "string" } } } } };
  const prompt = `You are the ${def?.title} of "${business.name}". The ${getExecutive(from)?.title} asked you: "${request}".
Answer from your domain (${def?.responsibilities.join(", ")}), using these observations. Propose a concrete next step. Plain language.

OBSERVATIONS: ${JSON.stringify(domainObs.slice(0, 15))}`;
  let resp: any;
  try { resp = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { resp = { answer: "Unable to reason just now.", proposal: "Review manually." }; }
  return { from, to, request, response: resp };
}

// =================================================================
// AUTONOMOUS EXECUTION — only actions the user approved once may auto-run
// =================================================================
async function approveAction(svc: any, businessId: string, recommendationId: string, user: any): Promise<any> {
  const business = await verifyTenant(svc, businessId, user);
  const rec: any = await svc.entities.LaunchRecommendation.get(recommendationId).catch(() => null);
  if (!rec || rec.business_id !== businessId) throw Object.assign(new Error("Recommendation not found"), { code: "NOT_FOUND" });
  await svc.entities.LaunchRecommendation.update(rec.id, { status: "done" }).catch(() => {});
  // Add to the auto-allowlist (BusinessMemory) so future identical auto_fix may self-execute.
  const sig = `${rec.provenance?.executive || "ai"}.${rec.key}`;
  await upsertMemory(svc, business, "fact", `approved_action:${sig}`, `Approved action: ${rec.title}`, rec.title, { recommendation_id: rec.id, key: rec.key, executive: rec.provenance?.executive }, { source: "user", actor: (user && (user.full_name || user.email)) || "user", confidence: 1, tags: ["approved_action"] });
  return { approved: rec.id, allowlist_signature: sig };
}

async function autoExecute(svc: any, businessId: string, actor: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId).catch(() => null);
  if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
  const approved: any[] = await svc.entities.BusinessMemory.filter({ business_id: businessId, kind: "fact" }, "-updated_at", 100).catch(() => []);
  const allowed = new Set(approved.filter((m: any) => (m.tags || []).includes("approved_action")).map((m: any) => (m.payload && (m.payload.executive ? m.payload.executive + "." : "") + m.payload.key) || m.key?.replace("approved_action:", "")));
  if (!allowed.size) return { business_id: businessId, executed: 0, note: "No approved actions in the allowlist yet." };

  const recos: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: businessId, status: "open", decision: "auto_fix" }, "-priority", 50).catch(() => []);
  const executable = recos.filter((r: any) => allowed.has(`${r.provenance?.executive || "ai"}.${r.key}`));
  const executed: any[] = [];
  for (const r of executable) {
    // Phase 10: autonomous execution is gated to registering the action as done + an observation.
    // (Wiring the actual workflow dispatch is the Phase-11+ department work; the allowlist is the gate.)
    await svc.entities.LaunchRecommendation.update(r.id, { status: "done" }).catch(() => {});
    await svc.entities.BusinessObservation.create({
      tenant_id: business.tenant_id, business_id: businessId, source: "ai", category: "automation",
      severity: "info", signal_key: `auto_exec.${r.id}`, title: `Auto-executed: ${r.title}`, detail: `Approved action ran autonomously (${r.provenance?.executive || "ai"}).`,
      evidence: { recommendation_id: r.id }, status: "open", decision: "ignore", decision_rationale: "Auto-executed via allowlist.", generated_at: new Date().toISOString(), provenance: { actor, autonomous: true },
    }).catch(() => {});
    executed.push(r.id);
  }
  return { business_id: businessId, executed: executed.length, ids: executed };
}

// =================================================================
// RUN ALL (morning routine for the executive team)
// =================================================================
async function runAll(svc: any, onlyBusinessId: string | undefined, kind: string, actor: string): Promise<any> {
  const targets = await listActiveBusinesses(svc, onlyBusinessId);
  const results: any[] = [];
  for (const b of targets) {
    try {
      await seedExecutives(svc, b.id);
      const execResults: any[] = [];
      for (const role of ROLES) {
        if (EXECUTIVES[role].architecture_only) continue;
        execResults.push(await runExecutive(svc, b.id, role, actor).catch((e: any) => ({ role, error: e?.message })));
      }
      const brf = await briefing(svc, b.id, kind || "morning", undefined, actor);
      const auto = await autoExecute(svc, b.id, actor).catch(() => ({ executed: 0 }));
      results.push({ business_id: b.id, name: b.name, executives: execResults.map((e) => ({ role: e.role, posture: e.posture, created: e.created })), brief_id: brf.memory_id, auto_executed: auto.executed });
    } catch (e: any) { results.push({ business_id: b.id, name: b.name, error: e?.message || String(e) }); }
  }
  return { routine: kind, processed: targets.length, results };
}

// =================================================================
// READS
// =================================================================
async function listExecutives(rd: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  const rows: any[] = await rd.entities.BusinessExecutive.filter({ business_id: businessId }, "role", 50).catch(() => []);
  return { executives: rows || [] };
}
async function listGoals(rd: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  const rows: any[] = await rd.entities.BusinessGoal.filter({ business_id: businessId }, "-created_date", 50).catch(() => []);
  return { goals: rows || [] };
}
async function getBriefing(rd: any, body: any, user: any): Promise<any> {
  const businessId = requireBusinessId(body);
  await verifyTenant(rd, businessId, user);
  let filter: any = { business_id: businessId, kind: "executive_brief" };
  if (body.kind) filter.key = { $regex: `^${body.kind}:` }; // best-effort; falls back if unsupported
  let rows: any[] = await rd.entities.BusinessMemory.filter({ business_id: businessId, kind: "executive_brief" }, "-created_date", 5).catch(() => []);
  if (body.kind) rows = (rows || []).filter((m: any) => (m.key || "").startsWith(`${body.kind}:`));
  return { brief: (rows || [])[0] || null };
}

// =================================================================
// MEMORY HELPERS
// =================================================================
// collectMemory, upsertMemory, pad, isoWeek imported from ../../shared/ai/coo.ts