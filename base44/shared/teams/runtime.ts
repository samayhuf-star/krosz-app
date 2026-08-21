// Phase 13C — Agent Team Runtime.
//
// An Agent Team is a controlled execution group of specialized agents that runs
// INSIDE A SINGLE LaunchTask (task type `run_agent_team`). This module is NOT a
// second workflow engine: it never creates LaunchPlans/LaunchTasks, never decides
// run-level ordering, retries, approvals or DAG state — the Workflow Engine owns
// all of that. It only runs the team's internal agent graph within the one
// dispatched task.
//
// REUSE MAP (no duplicate infrastructure):
//   • Per-agent execution  -> executeAgent (shared/agents/runtime.ts)
//   • Provider/model calls -> runStructuredAI / Provider Runtime (via executeAgent)
//   • Tool permission      -> enforceToolPermission (via executeAgent) on a NARROWED
//                             tool list (effective = team allowed_tools, validated to
//                             be a subset of the agent's own config.tools). Team can
//                             NEVER grant an agent a tool it does not already have.
//   • Context scoping      -> buildAgentContext (via executeAgent) with a crafted
//                             `context` that exposes ONLY the agent's declared
//                             depends_on upstream outputs as prior_task_outputs.
//                             An agent never sees another agent's private reasoning
//                             — only structured, scoped handoffs.
//   • Telemetry            -> AIExecution checkpoints via executeAgent + a single
//                             team.final checkpoint via recordExecution. Costs,
//                             tokens, latency aggregate from per-agent executions.
//   • Langfuse             -> a team span nested under the engine's launch_task span;
//                             each agent's span (created by executeAgent) nests under
//                             the team span. Hierarchy: LaunchTask -> AgentTeam ->
//                             Agent -> LLM/Tool.
//   • Memory               -> retrieveRelevantMemory (via executeAgent's context).
//   • Approval             -> owned by the Workflow Engine (approval_gate tasks in
//                             the PlanTemplate). The team never self-approves.
//
// STRUCTURED HANDOFFS: each agent returns a structured object (validated against its
// output_schema by executeAgent). Downstream agents receive ONLY their declared
// depends_on agents' structured outputs. The final team output is assembled from
// the agent outputs and validated against team.output_schema.
//
// LIMITS (structured failure codes):
//   TEAM_TIMEOUT · TEAM_BUDGET_EXCEEDED · TEAM_ITERATION_LIMIT · TEAM_TOOL_LIMIT
//   TEAM_DEADLOCK · TEAM_CONFIG_INVALID · TEAM_NOT_FOUND · TEAM_VERSION_PIN_MISMATCH
//   AGENT_FAILED · QA_REJECTED · TEAM_INVALID_OUTPUT

import { executeAgent, AgentDefinition, AgentExecResult } from "../agents/runtime.ts";
import { recordExecution, hashOf } from "../operations/adapterContract.ts";
import { getObsCtx, setObsCtx } from "../observability/index.ts";

// ---------------- Types ----------------
export interface TeamAgentSpec {
  key: string;
  role: string;
  agent_id?: string;
  agent_purpose?: string;
  allowed_tools: string[];
  depends_on: string[];
  model?: string;
  instructions_override?: string;
  output_schema?: any;
}

export interface AgentTeamDef {
  id?: string;
  tenant_id: string;
  business_id: string;
  team_id: string;
  name: string;
  description?: string;
  version: number;
  status: string;
  agents: TeamAgentSpec[];
  execution_mode: string;
  entry_agent: string;
  output_schema?: any;
  timeout_ms: number;
  max_total_iterations: number;
  max_total_tool_calls: number;
  budget_limit: number;
  approval_required: boolean;
  enabled: boolean;
  config_hash?: string;
}

export interface TeamExecResult {
  status: "completed" | "failed";
  output?: any;
  error?: { code: string; message: string; retryable: boolean; detail?: any };
  last_stage?: string;
  executionIds?: string[];
  summary?: TeamSummary;
}

export interface TeamSummary {
  agents: number;
  total_iterations: number;
  total_tool_calls: number;
  total_cost: number;
  total_latency_ms: number;
  per_agent: { key: string; role: string; status: string; iterations?: number; tool_calls?: number; cost?: number; tool_used?: string; error_code?: string }[];
}

// ---------------- Persistence helpers ----------------
function toDef(row: any): AgentTeamDef {
  return {
    id: row.id, tenant_id: row.tenant_id, business_id: row.business_id, team_id: row.team_id,
    name: row.name, description: row.description, version: row.version || 1, status: row.status,
    agents: row.agents || [], execution_mode: row.execution_mode || "dependent", entry_agent: row.entry_agent || "",
    output_schema: row.output_schema, timeout_ms: row.timeout_ms ?? 120000, max_total_iterations: row.max_total_iterations ?? 20,
    max_total_tool_calls: row.max_total_tool_calls ?? 30, budget_limit: row.budget_limit ?? 0,
    approval_required: !!row.approval_required, enabled: row.enabled !== false, config_hash: row.config_hash,
  };
}

export async function loadTeam(svc: any, teamId: string, version: number): Promise<AgentTeamDef | null> {
  const rows: any[] = await svc.entities.AgentTeam.filter({ team_id: teamId, version }).catch(() => []);
  return rows && rows[0] ? toDef(rows[0]) : null;
}

export async function latestActiveTeam(svc: any, teamId: string): Promise<AgentTeamDef | null> {
  const rows: any[] = await svc.entities.AgentTeam.filter({ team_id: teamId, status: "active" }).catch(() => []);
  if (!rows || !rows.length) return null;
  rows.sort((a, b) => (b.version || 0) - (a.version || 0));
  return toDef(rows[0]);
}

export function teamConfigHash(team: AgentTeamDef): string {
  return hashOf(JSON.stringify({
    agents: team.agents, execution_mode: team.execution_mode, entry_agent: team.entry_agent,
    output_schema: team.output_schema, timeout_ms: team.timeout_ms, max_total_iterations: team.max_total_iterations,
    max_total_tool_calls: team.max_total_tool_calls, budget_limit: team.budget_limit, approval_required: team.approval_required,
  }));
}

// ---------------- Security: effective permission (§21) ----------------
// Team allowed_tools MUST be a subset of the agent's own config.tools. The team
// can never grant an agent more permission than it already has.
export function effectiveTools(agentRecord: any, spec: TeamAgentSpec): { ok: boolean; tools: string[]; reason?: string } {
  const agentTools: string[] = (agentRecord?.config?.tools) || [];
  const want: string[] = spec.allowed_tools || [];
  for (const t of want) {
    if (!agentTools.includes(t)) {
      return { ok: false, tools: [], reason: `Team grants tool '${t}' to agent '${agentRecord?.name || spec.key}' which the agent does not have. Team permission must not exceed agent permission.` };
    }
  }
  // Narrowed list = the team's allowed_tools (validated subset). Empty team list
  // means "use the agent's own tools" (team grants no narrowing).
  return { ok: true, tools: want.length ? want : agentTools };
}

// ---------------- Limits (§12) ----------------
export function evaluateTeamLimits(state: { totalCost: number; totalTools: number; totalIter: number; elapsedMs: number }, limits: { budget_limit: number; max_total_tool_calls: number; max_total_iterations: number; timeout_ms: number }): { code: string; message: string } | null {
  if (limits.timeout_ms > 0 && state.elapsedMs > limits.timeout_ms) return { code: "TEAM_TIMEOUT", message: `Team exceeded ${limits.timeout_ms}ms wall clock.` };
  if (limits.max_total_iterations > 0 && state.totalIter > limits.max_total_iterations) return { code: "TEAM_ITERATION_LIMIT", message: `Team exceeded ${limits.max_total_iterations} total iterations.` };
  if (limits.max_total_tool_calls > 0 && state.totalTools > limits.max_total_tool_calls) return { code: "TEAM_TOOL_LIMIT", message: `Team exceeded ${limits.max_total_tool_calls} total tool calls.` };
  if (limits.budget_limit > 0 && state.totalCost > limits.budget_limit) return { code: "TEAM_BUDGET_EXCEEDED", message: `Team exceeded budget ${limits.budget_limit} (spent ${state.totalCost.toFixed(6)}).` };
  return null;
}

// ---------------- QA gate (§10) ----------------
export function checkQaGate(team: AgentTeamDef, agentOutputs: Record<string, any>): { ok: boolean; issues: string[]; qaKey?: string } {
  const qa = team.agents.find((a) => a.key === "qa" || /qa|valid/i.test(a.role || ""));
  if (!qa) return { ok: true, issues: [] };
  const qaOut = agentOutputs[qa.key];
  if (!qaOut) return { ok: true, issues: [] };
  if (qaOut.passed === false) return { ok: false, issues: Array.isArray(qaOut.issues) ? qaOut.issues : [], qaKey: qa.key };
  return { ok: true, issues: [], qaKey: qa.key };
}

// ---------------- Output assembly + validation (§9) ----------------
export function assembleTeamOutput(team: AgentTeamDef, agentOutputs: Record<string, any>, summary: TeamSummary): any {
  const out: any = { status: "success" };
  for (const a of team.agents) out[a.key] = agentOutputs[a.key] || null;
  out.summary = summary;
  return out;
}

export function validateOutput(data: any, schema: any): { ok: boolean; missing: string[] } {
  if (!schema || typeof schema !== "object") return { ok: true, missing: [] };
  const req: string[] = schema.required || [];
  const missing = req.filter((k) => data?.[k] === undefined || data?.[k] === null || data?.[k] === "");
  return { ok: missing.length === 0, missing };
}

// ---------------- Objective builder ----------------
function buildObjective(spec: TeamAgentSpec, team: AgentTeamDef, url: string): string {
  const deps = spec.depends_on.length ? ` The following structured inputs from teammates are provided in the dependency context: ${spec.depends_on.join(", ")}. Use them and do not re-fetch unless necessary.` : "";
  const roleHint: Record<string, string> = {
    research: `Analyze the website at ${url}. Extract business_name, website, industry, and a short description, with a confidence score (0-1). Use the website_fetch tool with that URL first.`,
    technology: `Identify the technologies used by the website at ${url}. Use the technology_detector tool (and website_fetch if needed) with that URL. Return the technologies list and a confidence score (0-1).`,
    seo: `Assess basic SEO signals for the website at ${url}. Use the metadata, robots, and sitemap tools with that URL. Return an seo_score (0-100), a list of issues, and recommendations.`,
    qa: `Review the Research, Technology, and SEO outputs provided in the dependency context. Validate required fields are present and consistent (website is a valid URL, technologies is a list, seo_score is a number). Set passed=true if valid, else false with a list of issues. Do not call any tool.`,
  };
  return (spec.instructions_override ? spec.instructions_override : roleHint[spec.key] || `Perform your role: ${spec.role}.`) + deps;
}

// ---------------- Main entry: executeTeam ----------------
export async function executeTeam(svc: any, opts: {
  team: AgentTeamDef; run: any; task: any; context: any; resolvedProvider: any; actor?: string;
}): Promise<TeamExecResult> {
  const { team, run, task, context, resolvedProvider, actor } = opts as any;
  const base44 = (svc && svc.__base44) || svc;
  const t0 = Date.now();
  const execIds: string[] = [];
  const agentOutputs: Record<string, any> = {};
  let totalIter = 0, totalTools = 0, totalCost = 0;
  const perAgent: TeamSummary["per_agent"] = [];
  const url: string = (task?.input_context?.url) || (context?.url) || "https://example.com";

  // Langfuse: team span nested under the engine's launch_task span.
  const obsCtx: any = await getObsCtx();
  const obs: any = obsCtx?.service || null;
  const teamSpan: any = obs ? obs.startSpan({
    name: `agent_team:${team.team_id}#v${team.version}`,
    parentObservationId: obsCtx?.parentObservationId || null,
    metadata: { team_id: team.team_id, team_version: team.version, team_name: team.name, config_hash: team.config_hash || "", agent_count: team.agents.length, run_id: run?.id, task_id: task?.id, url },
  }) : null;

  function fail(code: string, message: string, retryable: boolean, detail?: any): TeamExecResult {
    if (obs && teamSpan) obs.endSpan(teamSpan, { status: "failed", error: { code, message }, metadata: { duration_ms: Date.now() - t0, total_iterations: totalIter, total_tool_calls: totalTools, total_cost: totalCost } });
    return { status: "failed", error: { code, message, retryable, detail }, last_stage: "team", executionIds: execIds, summary: { agents: team.agents.length, total_iterations: totalIter, total_tool_calls: totalTools, total_cost: totalCost, total_latency_ms: Date.now() - t0, per_agent: perAgent } };
  }

  // ---- Resolve backing AIAgent records + effective tools (security) ----
  const resolved: { spec: TeamAgentSpec; agentRec: any; tools: string[] }[] = [];
  for (const spec of team.agents) {
    let agentRec: any = null;
    if (spec.agent_id) agentRec = await svc.entities.AIAgent.get(spec.agent_id).catch(() => null);
    if (!agentRec && spec.agent_purpose) {
      // Auto-seed the standard agent for this purpose (idempotent).
      try { const { resolveStandardAgent } = await import("../agents/lifecycle.ts"); agentRec = await resolveStandardAgent(svc, { id: run.business_id, tenant_id: run.tenant_id } as any, spec.agent_purpose); } catch {}
    }
    if (!agentRec) return fail("TEAM_CONFIG_INVALID", `No backing AIAgent for team agent '${spec.key}' (agent_id missing or not found).`, false);
    if (agentRec.status && agentRec.status !== "active" && agentRec.status !== "draft") return fail("TEAM_CONFIG_INVALID", `Backing agent '${agentRec.name}' is ${agentRec.status}, not runnable.`, false);
    const et = effectiveTools(agentRec, spec);
    if (!et.ok) return fail("TEAM_CONFIG_INVALID", et.reason || "Team permission exceeds agent permission.", false);
    resolved.push({ spec, agentRec, tools: et.tools });
  }

  // ---- Topological execution rounds (parallel where deps allow; no second scheduler) ----
  const done = new Set<string>();
  const failed = new Set<string>();
  let safety = 0;
  while (done.size < resolved.length) {
    safety++;
    if (safety > 200) return fail("TEAM_ITERATION_LIMIT", "Scheduling exceeded 200 rounds (cycle?).", false);
    const lim = evaluateTeamLimits({ totalCost, totalTools, totalIter, elapsedMs: Date.now() - t0 }, { budget_limit: team.budget_limit, max_total_tool_calls: team.max_total_tool_calls, max_total_iterations: team.max_total_iterations, timeout_ms: team.timeout_ms });
    if (lim) return fail(lim.code, lim.message, lim.code === "TEAM_TIMEOUT");

    const ready = resolved.filter((r) => !done.has(r.spec.key) && r.spec.depends_on.every((d) => done.has(d)));
    if (!ready.length) {
      const remaining = resolved.filter((r) => !done.has(r.spec.key)).map((r) => r.spec.key);
      return fail("TEAM_DEADLOCK", `No runnable agents (remaining: ${remaining.join(", ")}).`, false);
    }

    const results = await Promise.all(ready.map((r) => runOne(r)));
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const spec = ready[i].spec;
      if (res.status !== "completed") {
        perAgent.push({ key: spec.key, role: spec.role, status: "failed", iterations: res.output?.iterations, tool_calls: res.output?.tool_calls, cost: res.output?.cost, tool_used: res.output?.tool_used, error_code: res.error?.code });
        return fail(res.error?.code || "AGENT_FAILED", `Agent '${spec.key}' failed: ${res.error?.message || ""}`, res.error?.retryable ?? true, { agent: spec.key, agentError: res.error });
      }
      agentOutputs[spec.key] = res.output;
      done.add(spec.key);
      totalIter += res.output?.iterations || 0;
      totalTools += res.output?.tool_calls || 0;
      totalCost += res.output?.cost || 0;
      perAgent.push({ key: spec.key, role: spec.role, status: "completed", iterations: res.output?.iterations, tool_calls: res.output?.tool_calls, cost: res.output?.cost, tool_used: res.output?.tool_used });
      for (const eid of res.executionIds || []) execIds.push(eid);
      const lim2 = evaluateTeamLimits({ totalCost, totalTools, totalIter, elapsedMs: Date.now() - t0 }, { budget_limit: team.budget_limit, max_total_tool_calls: team.max_total_tool_calls, max_total_iterations: team.max_total_iterations, timeout_ms: team.timeout_ms });
      if (lim2) return fail(lim2.code, lim2.message, lim2.code === "TEAM_TIMEOUT");
    }
  }

  // ---- QA gate (no silent success) ----
  const qa = checkQaGate(team, agentOutputs);
  if (!qa.ok) {
    return fail("QA_REJECTED", `QA agent '${qa.qaKey}' rejected outputs: ${(qa.issues || []).join("; ")}`, false, { qa: agentOutputs[qa.qaKey || ""] });
  }

  // ---- Assemble + validate final output ----
  const summary: TeamSummary = { agents: resolved.length, total_iterations: totalIter, total_tool_calls: totalTools, total_cost: totalCost, total_latency_ms: Date.now() - t0, per_agent: perAgent };
  const finalOutput = assembleTeamOutput(team, agentOutputs, summary);
  const v = validateOutput(finalOutput, team.output_schema);
  if (!v.ok) return fail("TEAM_INVALID_OUTPUT", `Final team output missing required fields: ${v.missing.join(", ")}`, false);

  // ---- Team-level checkpoint (single ledger row; per-agent rows already recorded by executeAgent) ----
  try {
    const teamExecId = await recordExecution(svc, {
      run, task, attempt: task.attempt || 1, stage: "team.final", operation: "run_agent_team.final",
      capability: task.provider_capability || "ai_generation",
      provider: resolvedProvider || { provider_id: "(team)", provider_key: "(team)", adapter_key: "team", name: "agent_team", category: "ai", via: "agent_team" },
      model: "", inputHash: task.input_hash, outputHash: hashOf(finalOutput),
      success: true, durationMs: Date.now() - t0, actor,
      tokens: 0, estimatedCost: totalCost, output: finalOutput,
    });
    if (teamExecId) execIds.push(teamExecId);
  } catch {}

  if (obs && teamSpan) obs.endSpan(teamSpan, { status: "completed", metadata: { duration_ms: Date.now() - t0, total_iterations: totalIter, total_tool_calls: totalTools, total_cost: totalCost, agents: resolved.length } });
  return { status: "completed", output: finalOutput, last_stage: "team.final", executionIds: execIds, summary };

  // ---- Per-agent runner: narrows tools + scopes dependency outputs + nests Langfuse span ----
  async function runOne(r: { spec: TeamAgentSpec; agentRec: any; tools: string[] }): Promise<AgentExecResult> {
    const { spec, agentRec, tools } = r;
    const agentDef: AgentDefinition = {
      id: agentRec.id, name: agentRec.name, description: agentRec.description,
      instructions: spec.instructions_override || agentRec.instructions || "",
      config: { ...(agentRec.config || {}), tools, model: spec.model || agentRec.config?.model || "automatic", output_schema: spec.output_schema || agentRec.config?.output_schema },
      status: agentRec.status, version: agentRec.version || 1,
    };
    // Scoped context: business + run_context + ONLY declared dependency outputs.
    const priorForAgent: Record<string, any> = {};
    for (const d of spec.depends_on) priorForAgent[d] = agentOutputs[d];
    const agentContext = { business: context?.business, run_context: context?.run_context, prior_task_outputs: priorForAgent };
    const objective = buildObjective(spec, team, url);
    const agentTask: any = {
      ...task, task_key: `${task.task_key}.${spec.key}`, type: "run_agent", depends_on: spec.depends_on,
      input_context: { objective, agent_id: agentRec.id, team_agent_key: spec.key, team_id: team.team_id, team_version: team.version, url },
    };
    const tA = Date.now();
    let res: AgentExecResult;
    try {
      if (obs) {
        res = await setObsCtx({ service: obs, traceId: obsCtx?.traceId, parentObservationId: teamSpan?.id || obsCtx?.parentObservationId || null, run_id: run?.id, task_id: task?.id },
          async () => executeAgent(svc, { agent: agentDef, run, task: agentTask, context: agentContext, resolvedProvider, actor }));
      } else {
        res = await executeAgent(svc, { agent: agentDef, run, task: agentTask, context: agentContext, resolvedProvider, actor });
      }
    } catch (e: any) {
      res = { status: "failed", output: {}, error: { code: e?.code || "AGENT_FAILED", message: String(e?.message || e), retryable: true }, executionIds: [] };
    }
    // Record a team-side handoff checkpoint (traceable inter-agent handoff metadata).
    try {
      const hid = await recordExecution(svc, {
        run, task, attempt: task.attempt || 1, stage: `team.handoff:${spec.key}`, operation: `run_agent_team.handoff.${spec.key}`,
        capability: task.provider_capability || "ai_generation",
        provider: { provider_id: "(team)", provider_key: "(team)", adapter_key: "team", name: spec.key, category: "team", via: "agent_team" },
        model: "", inputHash: task.input_hash, outputHash: hashOf(res.output),
        success: res.status === "completed", errorCode: res.error?.code || "", errorMessage: res.error?.message || "", retryable: !!res.error?.retryable,
        durationMs: Date.now() - tA, actor,
        output: { agent_key: spec.key, role: spec.role, depends_on: spec.depends_on, iterations: res.output?.iterations, tool_calls: res.output?.tool_calls, cost: res.output?.cost, tool_used: res.output?.tool_used },
      });
      if (hid) execIds.push(hid);
    } catch {}
    return res;
  }
}

// ---------------- Seed: Website Intelligence Team (§16) ----------------
export const WEBSITE_INTELLIGENCE_TEAM_ID = "website_intelligence";

export async function seedWebsiteIntelligenceTeam(svc: any, business: any): Promise<AgentTeamDef> {
  const tenant_id = business.tenant_id;
  const business_id = business.id;

  // 1) Idempotently seed the 4 backing AIAgent records (idempotent by name).
  const agentDefs: { key: string; name: string; purpose: string[]; instructions: string; tools: string[]; output_schema: any; model?: string }[] = [
    {
      key: "research", name: "Website Research Agent", purpose: ["website_research"],
      instructions: "You are the Research Agent on the Website Intelligence Team. Use the website_fetch tool with the URL from the objective to fetch the site, then extract the business name, website URL, industry, and a short description FROM THE FETCHED PAGE CONTENT, with a confidence score (0-1). The business context is background only — never use it for the extracted business_name/website/industry fields. Be grounded in the fetched result — never invent details.",
      tools: ["website_fetch"],
      output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" }, business_name: { type: "string" }, website: { type: "string" }, industry: { type: "string" }, description: { type: "string" }, confidence: { type: "number" } }, required: ["answer", "business_name", "website", "industry", "confidence"] },
    },
    {
      key: "technology", name: "Website Technology Agent", purpose: ["website_technology"],
      instructions: "You are the Technology Agent on the Website Intelligence Team. Use the technology_detector tool (and website_fetch if needed) with the URL to identify the website's technologies (CMS, frameworks, hosting, analytics). Return the list and a confidence score (0-1). Use the research result in the dependency context if helpful.",
      tools: ["website_fetch", "technology_detector"],
      output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" }, technologies: { type: "array", items: { type: "string" } }, confidence: { type: "number" } }, required: ["answer", "technologies", "confidence"] },
    },
    {
      key: "seo", name: "Website SEO Agent", purpose: ["website_seo"],
      instructions: "You are the SEO Agent on the Website Intelligence Team. Use the metadata tool with the URL to assess basic SEO signals (title, meta description, Open Graph, viewport). Return an seo_score (0-100), a list of issues, and a list of recommendations. Use the research result in the dependency context if helpful.",
      tools: ["metadata"],
      output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" }, seo_score: { type: "number" }, issues: { type: "array", items: { type: "string" } }, recommendations: { type: "array", items: { type: "string" } } }, required: ["answer", "seo_score", "issues", "recommendations"] },
    },
    {
      key: "qa", name: "Website QA Agent", purpose: ["website_qa"],
      instructions: "You are the QA Agent on the Website Intelligence Team. Review the Research, Technology, and SEO outputs in the dependency context. Validate ONLY structural presence and internal consistency across the three outputs: required fields are present (website is a valid URL, technologies is a list, seo_score is a number 0-100, confidence is 0-1), and the website URL is the same across research/technology/seo. Do NOT compare the outputs against the business record — the target URL may be any public website unrelated to the business. Set passed=true if structurally valid and internally consistent, else false with a list of issues. Do not call any tool.",
      tools: [],
      output_schema: { type: "object", properties: { answer: { type: "string" }, tool_used: { type: "string" }, result_summary: { type: "string" }, passed: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } }, required: ["answer", "passed", "issues"] },
    },
  ];

  const agentIds: Record<string, string> = {};
  for (const def of agentDefs) {
    const existing: any[] = await svc.entities.AIAgent.filter({ business_id, name: def.name }).catch(() => []);
    if (existing && existing.length) { agentIds[def.key] = existing[0].id; continue; }
    const row = await svc.entities.AIAgent.create({
      tenant_id, business_id, name: def.name, purpose: def.purpose, instructions: def.instructions,
      status: "active", human_escalation_enabled: true, lead_capture_enabled: false,
      config: { tools: def.tools, max_iterations: 2, max_tool_calls: 4, timeout_ms: 60000, temperature: 0.3, budget_limit: 0, output_schema: def.output_schema },
      last_run_at: null,
    });
    agentIds[def.key] = row.id;
  }

  // 2) Idempotently seed the AgentTeam v1 (active).
  const existing: any[] = await svc.entities.AgentTeam.filter({ business_id, team_id: WEBSITE_INTELLIGENCE_TEAM_ID, version: 1 }).catch(() => []);
  if (existing && existing.length) return toDef(existing[0]);

  const agents: TeamAgentSpec[] = [
    { key: "research", role: "Research", agent_id: agentIds.research, allowed_tools: ["website_fetch"], depends_on: [], output_schema: agentDefs[0].output_schema },
    { key: "technology", role: "Technology", agent_id: agentIds.technology, allowed_tools: ["website_fetch", "technology_detector"], depends_on: ["research"], output_schema: agentDefs[1].output_schema },
    { key: "seo", role: "SEO", agent_id: agentIds.seo, allowed_tools: ["metadata"], depends_on: ["research"], output_schema: agentDefs[2].output_schema },
    { key: "qa", role: "QA", agent_id: agentIds.qa, allowed_tools: [], depends_on: ["technology", "seo"], output_schema: agentDefs[3].output_schema },
  ];
  const team: AgentTeamDef = {
    tenant_id, business_id, team_id: WEBSITE_INTELLIGENCE_TEAM_ID, name: "Website Intelligence Team",
    description: "Research → Technology + SEO (parallel) → QA. Analyzes a public website and returns validated business, tech, and SEO signals.",
    version: 1, status: "active", agents, execution_mode: "dependent", entry_agent: "research",
    output_schema: { type: "object", properties: { status: { type: "string" }, research: { type: "object" }, technology: { type: "object" }, seo: { type: "object" }, qa: { type: "object" }, summary: { type: "object" } }, required: ["status", "research", "technology", "seo", "qa"] },
    timeout_ms: 120000, max_total_iterations: 20, max_total_tool_calls: 30, budget_limit: 0, approval_required: false, enabled: true,
  };
  (team as any).config_hash = teamConfigHash(team);
  const row = await svc.entities.AgentTeam.create({
    tenant_id, business_id, team_id: team.team_id, name: team.name, description: team.description, version: 1, status: "active",
    agents: team.agents, execution_mode: team.execution_mode, entry_agent: team.entry_agent, output_schema: team.output_schema,
    timeout_ms: team.timeout_ms, max_total_iterations: team.max_total_iterations, max_total_tool_calls: team.max_total_tool_calls, budget_limit: team.budget_limit,
    approval_required: team.approval_required, enabled: true, config_hash: team.config_hash, created_by: "system",
  });
  return toDef(row);
}