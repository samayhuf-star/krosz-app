// Agent Context Builder (Phase 13b) — one canonical, layered, budgeted context.
//
// Layers (spec step 2):
//   1 system     — agent instructions + runtime rules
//   2 business   — immutable run snapshot (buildContextSnapshot, captured at launch)
//   3 run        — run_id / workflow / version / state
//   4 task       — task definition + task input
//   5 dependencies — ONLY this task's declared depends_on upstream outputs
//   6 memory     — relevant durable business memory (live, tenant/business scoped)
//   7 input      — current user/request input
//
// Reuses the existing run snapshot (never refreshed mid-run → run immutability intact)
// and the engine's prior_task_outputs, scoped to task.depends_on. A context BUDGET
// truncates lower-priority layers and records what was omitted. The agent never
// constructs arbitrary queries and never sees another tenant's context.

import { retrieveRelevantMemory } from "./memory.ts";

const TOKEN_BUDGET_DEFAULT = 6000;
const CHARS_PER_TOKEN = 4;

export interface AgentLayeredContext {
  system: any;
  business: any;
  run: any;
  task: any;
  dependencies: Record<string, any>;
  memory: any[];
  input: any;
  budget: { tokenEstimate: number; budget: number; omitted: number; omittedLayers: string[]; sources: Record<string, string> };
  durations: { totalMs: number; memoryMs: number; depsMs: number; businessMs: number };
  snapshotRef: { run_id: string; capturedBusinessName: string } | null;
}

function est(v: any): number {
  try {
    const s = v == null ? "" : (typeof v === "string" ? v : JSON.stringify(v));
    return Math.ceil(s.length / CHARS_PER_TOKEN);
  } catch { return 0; }
}

export async function buildAgentContext(svc: any, opts: {
  agent: any; run: any; task: any; business?: any; context: any; input?: any; budget?: number;
}): Promise<AgentLayeredContext> {
  const { agent, run, task, context } = opts as any;
  const budget = opts.budget && opts.budget > 0 ? opts.budget : TOKEN_BUDGET_DEFAULT;
  const t0 = Date.now();

  // LAYER 2 — Business Context (immutable run snapshot; never refreshed mid-run).
  const bm0 = Date.now();
  let business: any = (context && context.business) ? context.business : (run && run.context_snapshot && run.context_snapshot.business) || {};
  const businessMs = Date.now() - bm0;

  // LAYER 3 — Run + LAYER 4 — Task.
  const runLayer: any = context && context.run_context
    ? { run_id: run?.id, template: context.run_context.plan_template, template_version: context.run_context.plan_version, goal: run?.goal, status: run?.status }
    : { run_id: run?.id, goal: run?.goal, status: run?.status };
  const objective = (task?.input_context && task.input_context.objective) || run?.goal || `Execute agent "${agent.name}".`;
  const taskLayer: any = { task_id: task?.id, task_key: task?.task_key, type: task?.type, objective, input: task?.input_context || null };

  // LAYER 5 — Dependency Outputs (scoped to THIS task's declared depends_on only).
  const dm0 = Date.now();
  const prior: Record<string, any> = (context && context.prior_task_outputs) || {};
  const deps: Record<string, any> = {};
  for (const k of (task?.depends_on || [])) if (prior[k] !== undefined) deps[k] = prior[k];
  const depsMs = Date.now() - dm0;

  // LAYER 6 — Relevant Memory (live; failures degrade to empty — memory is optional).
  const mm0 = Date.now();
  let memory: any[] = [];
  try { memory = await retrieveRelevantMemory(svc, { tenant_id: run?.tenant_id, business_id: run?.business_id, agent_id: agent?.id }); }
  catch { memory = []; }
  const memoryMs = Date.now() - mm0;

  // LAYER 1 — System + LAYER 7 — Current input.
  const system: any = {
    agent_name: agent.name, description: agent.description || "",
    instructions: agent.instructions || agent.config?.system_prompt_override || "",
    model: agent.config?.model || "automatic", allowed_tools: agent.config?.tools || [],
    max_iterations: agent.config?.max_iterations, timeout_ms: agent.config?.timeout_ms,
    budget_limit: agent.config?.budget_limit, approval_required: !!agent.config?.approval_required,
  };
  const inputLayer: any = (opts.input && Object.keys(opts.input || {}).length) ? opts.input : (task?.input_context && task.input_context.objective ? { objective: task.input_context.objective } : {});

  // CONTEXT BUDGET — priority: system > task > input > dependencies > business > memory.
  const sources: Record<string, string> = {
    system: "included", task: "included", input: "included",
    dependencies: Object.keys(deps).length ? "included" : "omitted",
    business: "included", memory: memory.length ? "included" : "omitted",
  };
  const omittedLayers: string[] = [];
  let tokenEstimate = est(system) + est(taskLayer) + est(inputLayer) + est(deps) + est(business) + est(memory);

  if (tokenEstimate > budget) {
    const keepCore = est(system) + est(taskLayer) + est(inputLayer) + est(deps);
    let remaining = budget - keepCore;
    if (remaining <= 0) {
      if (memory.length) { memory = []; sources.memory = "truncated"; omittedLayers.push("memory"); }
      business = { id: business.id, name: business.name, industry: business.industry, lifecycle_stage: business.lifecycle_stage };
      sources.business = "truncated"; omittedLayers.push("business_extras");
    } else {
      let memUsed = 0; const trimmed: any[] = [];
      for (const m of memory) { const t = est(m); if (memUsed + t <= remaining) { trimmed.push(m); memUsed += t; } else break; }
      if (trimmed.length < memory.length) { sources.memory = "truncated"; omittedLayers.push(`memory:${memory.length - trimmed.length} records`); memory = trimmed; }
      remaining -= memUsed;
      if (remaining <= 0) { business = { id: business.id, name: business.name, industry: business.industry, lifecycle_stage: business.lifecycle_stage }; sources.business = "truncated"; omittedLayers.push("business_extras"); }
    }
    tokenEstimate = keepCore + est(business) + est(memory);
  }

  return {
    system, business, run: runLayer, task: taskLayer, dependencies: deps, memory, input: inputLayer,
    budget: { tokenEstimate, budget, omitted: omittedLayers.length, omittedLayers, sources },
    durations: { totalMs: Date.now() - t0, memoryMs, depsMs, businessMs },
    snapshotRef: { run_id: run?.id, capturedBusinessName: business?.name || "" },
  };
}

// Render the layered context into a compact prompt for the model. Only structured
// metadata + facts are emitted — never secrets (those live in platform secrets).
export function renderAgentContext(ctx: AgentLayeredContext): string {
  const mem = ctx.memory.length
    ? ctx.memory.map((m) => `- ${m.key} = ${m.body} (confidence ${m.confidence}, source ${m.source})`).join("\n")
    : "(none)";
  const deps = Object.keys(ctx.dependencies).length
    ? Object.entries(ctx.dependencies).map(([k, v]) => `- ${k}: ${JSON.stringify(v).slice(0, 800)}`).join("\n")
    : "(none)";
  return [
    `AGENT: ${ctx.system.agent_name}${ctx.system.description ? " — " + ctx.system.description : ""}`,
    ctx.system.instructions || "",
    `BUSINESS: ${ctx.business?.name || ""} (${ctx.business?.industry || "unknown"} in ${ctx.business?.city || ""}). Lifecycle: ${ctx.business?.lifecycle_stage || "draft"}.`,
    ctx.business?.services_products?.length ? `SERVICES/PRODUCTS: ${(ctx.business.services_products || []).join(", ")}` : "",
    ctx.business?.target_customers ? `TARGET CUSTOMERS: ${ctx.business.target_customers}` : "",
    ctx.run?.template ? `RUN: ${ctx.run.template} (v${ctx.run.template_version}).` : "",
    `TASK: ${ctx.task.task_key || "(standalone)"} — ${ctx.task.objective || ""}`,
    Object.keys(ctx.dependencies).length ? `DEPENDENCY OUTPUTS:\n${deps}` : "",
    ctx.memory.length ? `RELEVANT BUSINESS MEMORY:\n${mem}` : "",
    (ctx.input && ctx.input.objective && ctx.input.objective !== ctx.task.objective) ? `CURRENT INPUT: ${JSON.stringify(ctx.input)}` : "",
  ].filter(Boolean).join("\n\n");
}