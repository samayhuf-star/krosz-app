// Agent Runtime (Phase 13) — executes ONE agent task end-to-end.
//
// ARCHITECTURAL BOUNDARY (do not violate):
//   Orchestrator -> Workflow/DAG -> Task -> Agent Runtime -> Tool (capability) -> Provider Runtime
//
// The Agent Runtime is NOT an orchestrator. It never decides what task runs next,
// never sets task lifecycle outside the single task the Workflow Engine dispatched
// to it, and never touches the DAG. The engine owns DAG/approval/retry/blocked
// state; this module only executes the task it was handed: it runs the agent loop
// (model call via the real Provider Runtime, optional tool call via the existing
// capability registry, structured-output validation), records truthful
// AIExecution checkpoints with token/cost/latency, and returns the adapter
// ExecuteResult contract.
//
// REUSE MAP (no duplicate runtimes):
//   - Provider/model call   -> runStructuredAI (shared/operations/ai_provider.ts)
//                              -> executeAIChat (shared/providers/runtime.ts) failover.
//   - Tool registry         -> CAPABILITIES (shared/actions/capabilities.ts).
//   - Tool execution (read) -> readListCustomers / readShowStatus / readAdviceToday
//                              (shared/actions/interpreter.ts) — real backends.
//   - Token/cost/latency    -> surfaced from runStructuredAI, written via recordExecution.
//   - Context snapshot      -> built by the engine (buildContextSnapshot / withPriorOutputs)
//                              and present on the task.
//   - Memory                -> collectMemory (shared/ai/coo.ts) — injected, not rebuilt.
//   - Tenant isolation      -> AIAgent RLS (own tenant/admin) + verifyTenant at the HTTP
//                              entry + per-business provider resolution.
//   - Human approval        -> owned by the Workflow Engine (approval_gate tasks). The
//                              Agent Runtime never bypasses a gate.
//
// Invoked by the `run_agent` factory adapter (shared/operations/adapters/agent.ts),
// which the Workflow Engine dispatches like any other task type.

import { runStructuredAI } from "../operations/ai_provider.ts";
import { recordExecution, hashOf } from "../operations/adapterContract.ts";
import { CAPABILITIES } from "../actions/capabilities.ts";
import { buildAgentContext, renderAgentContext } from "./context.ts";
import { enforceToolPermission, validateToolArgs, executeAgentTool } from "./tools.ts";
import { getObsCtx, setObsCtx } from "../observability/index.ts";

const DEFAULT_MAX_ITERATIONS = 2;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MODEL = "automatic";
const DEFAULT_MAX_TOOL_CALLS = 5;

export interface AgentDefinition {
  id?: string;
  name: string;
  description?: string;
  instructions: string;
  config?: AgentConfig;
  status?: string;
  version?: number;
}

export interface AgentConfig {
  model?: string;
  temperature?: number;
  max_iterations?: number;
  max_tool_calls?: number;
  timeout_ms?: number;
  budget_limit?: number;
  approval_required?: boolean;
  tools?: string[];
  input_schema?: any;
  output_schema?: any;
  system_prompt_override?: string;
}

export interface AgentExecResult {
  status: "completed" | "failed";
  output?: any;
  error?: { code: string; message: string; retryable: boolean };
  last_stage?: string;
  executionIds?: string[];
  provider?: any;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("Agent loop timeout"), { code: "AGENT_TIMEOUT" })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function loadAgent(svc: any, agentId: string): Promise<AgentDefinition | null> {
  const a: any = await svc.entities.AIAgent.get(agentId).catch(() => null);
  if (!a) return null;
  return { id: a.id, name: a.name, description: a.description, instructions: a.instructions || "", config: a.config || {}, status: a.status, version: a.version || 1 };
}

function availableTools(toolKeys: string[] | undefined): { key: string; label: string; summary: string; kind: string; args: any }[] {
  const allow = toolKeys && toolKeys.length ? toolKeys : [];
  const out: any[] = [];
  for (const k of allow) {
    const c: any = CAPABILITIES[k];
    if (!c) continue;
    out.push({ key: c.key, label: c.label, summary: c.summary, kind: c.kind, args: c.argsSchema || null });
  }
  return out;
}

function outputSchemaOf(agent: AgentDefinition): any {
  if (agent.config?.output_schema) return agent.config.output_schema;
  return {
    type: "object",
    properties: {
      answer: { type: "string", description: "The agent's plain-language answer to the task." },
      tool_used: { type: "string", description: "The capability key called, or empty." },
      result_summary: { type: "string" },
    },
    required: ["answer", "tool_used", "result_summary"],
  };
}

function loopSchema(agent: AgentDefinition): any {
  const tools = availableTools(agent.config?.tools);
  const enumKeys = tools.map((t) => t.key);
  // Phase 13C: merge the agent's custom output fields into the decide/answer schema
  // so a tool-less agent (e.g. QA) that answers on iteration 1 returns its structured
  // fields, and the answer branch (below) preserves them. Required stays ["action"]
  // so a tool-using agent may still choose `call_tool` without producing final fields.
  const out = outputSchemaOf(agent);
  const outProps = (out && out.properties) || {};
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      action: { type: "string", enum: ["answer", "call_tool"] },
      tool: { type: "object", properties: { capability: { type: "string", enum: enumKeys.length ? enumKeys : ["__none__"] }, args: { type: "object", additionalProperties: true } } },
      ...outProps,
    },
    required: ["action"],
  };
}

function providerRefFrom(res: any, fallback: any): any {
  return {
    provider_id: res?.provider_id || fallback?.provider_id || "",
    provider_key: res?.provider_key || fallback?.key || fallback?.provider_key || "",
    adapter_key: res?.adapter_key || fallback?.adapter_key || "",
    name: res?.provider_key || fallback?.name || "",
    category: "ai",
    via: fallback?.via || "agent_runtime",
  };
}

function validateStructured(data: any, schema: any): { ok: boolean; missing: string[] } {
  if (!data || typeof data !== "object") return { ok: false, missing: ["(root object)"] };
  const req = (schema && schema.required) || [];
  const missing = req.filter((k: string) => data[k] === undefined || data[k] === null || data[k] === "");
  return { ok: missing.length === 0, missing };
}

// Main entry — called by the run_agent adapter with the canonical dispatch input.
export async function executeAgent(svc: any, opts: {
  agent: AgentDefinition;
  run: any;
  task: any;
  context: any;
  resolvedProvider: any;
  actor?: string;
  resumeFromStage?: string;
}): Promise<AgentExecResult> {
  const { agent, run, task, context, resolvedProvider, actor } = opts as any;
  const base44 = (svc && svc.__base44) || svc;
  const attempt = task.attempt || 1;
  const cfg = agent.config || {};
  const maxIter = Math.max(1, Math.min(cfg.max_iterations || DEFAULT_MAX_ITERATIONS, 5));
  const maxToolCalls = Math.max(0, cfg.max_tool_calls && cfg.max_tool_calls > 0 ? cfg.max_tool_calls : DEFAULT_MAX_TOOL_CALLS);
  const budgetLimit = cfg.budget_limit && cfg.budget_limit > 0 ? cfg.budget_limit : 0; // 0 = unlimited
  const timeoutMs = cfg.timeout_ms || DEFAULT_TIMEOUT_MS;
  const model = cfg.model || DEFAULT_MODEL;
  const temperature = cfg.temperature ?? DEFAULT_TEMPERATURE;
  const allowedTools = cfg.tools || [];
  const execIds: string[] = [];

  // Langfuse (Phase 12.6): own AGENT span nested under the engine's launch_task span.
  const obsCtx: any = await getObsCtx();
  const obs: any = obsCtx?.service || null;
  const cfgHash = hashOf(JSON.stringify({ name: agent.name, instructions: agent.instructions || "", config: cfg, tools: allowedTools }));
  const agentSpan = obs ? obs.startSpan({ name: `agent:${agent.name}#v${agent.version || 1}`, parentObservationId: obsCtx?.parentObservationId || null, metadata: { agent_id: agent.id || agent.name, agent_name: agent.name, agent_version: agent.version || 1, config_hash: cfgHash, task_id: task?.id, run_id: run?.id, allowed_tools: allowedTools, model, max_iterations: maxIter, max_tool_calls: maxToolCalls, budget_limit: budgetLimit, approval_required: !!cfg.approval_required } }) : null;
  const agentStart = Date.now();

  // ----- 13b: canonical layered + budgeted context (reuses immutable snapshot + memory) -----
  const cbSpan = obs ? obs.startSpan({ name: "context_build", parentObservationId: agentSpan?.id || null, metadata: { business_id: run?.business_id, task_key: task?.task_key } }) : null;
  const cbT0 = Date.now();
  const agentCtx = await buildAgentContext(svc, { agent, run, task, business: (context && context.business) || undefined, context, input: task.input_context || null });
  if (obs && cbSpan) obs.endSpan(cbSpan, { status: "completed", metadata: { token_estimate: agentCtx.budget.tokenEstimate, sources: agentCtx.budget.sources, memory_count: agentCtx.memory.length, dependency_count: Object.keys(agentCtx.dependencies).length, omitted: agentCtx.budget.omitted, duration_ms: Date.now() - cbT0 } });
  const mrSpan = obs ? obs.startSpan({ name: "memory_retrieval", parentObservationId: agentSpan?.id || null, metadata: {} }) : null;
  if (obs && mrSpan) obs.endSpan(mrSpan, { status: "completed", metadata: { memory_count: agentCtx.memory.length, retrieved_keys: agentCtx.memory.map((m) => m.key), duration_ms: agentCtx.durations.memoryMs } });

  const business: any = agentCtx.business || {};
  const objective = agentCtx.task.objective || run.goal || `Execute agent "${agent.name}".`;
  const memory = agentCtx.memory;
  const tools = availableTools(allowedTools);
  const systemBlock = [
    renderAgentContext(agentCtx),
    tools.length ? `Available tools (capabilities): ${tools.map((t) => `${t.key} — ${t.summary}${t.args ? ` (args: ${JSON.stringify(t.args)}).` : "."}`).join("; ")}.` : "No tools available.",
    `To use a tool, return action="call_tool" with tool.capability and tool.args. Otherwise return action="answer" with the final structured answer. You may call one tool per turn before answering.`,
  ].filter(Boolean).join("\n\n");

  const llmRun = (iterSchema: any, stage: string): Promise<any> => {
    const userPrompt = [
      `OBJECTIVE: ${objective}`,
      toolResult ? `TOOL RESULT (${toolUsed}): ${JSON.stringify(toolResult).slice(0, 4000)}` : "",
      toolResult ? "Now produce the final structured answer using the tool result." : "Decide whether to call a tool or answer directly.",
      "Respond ONLY with a JSON object matching the schema.",
    ].filter(Boolean).join("\n\n");
    const inner = () => withTimeout(runStructuredAI(base44, svc, {
      tenantId: run.tenant_id, businessId: run.business_id,
      prompt: `${systemBlock}\n\n${userPrompt}`,
      schema: iterSchema, stage, model, temperature, actor,
    }), timeoutMs);
    // Nest the provider-runtime generation under the agent span.
    if (!obs) return inner();
    return setObsCtx({ service: obs, traceId: obsCtx.traceId, parentObservationId: agentSpan?.id || null, run_id: run?.id, task_id: task?.id }, inner);
  };

  let iteration = 0;
  let toolCallCount = 0;
  let toolUsed = "";
  let toolResult: any = null;
  let lastModelRes: any = null;
  let totalCost = 0;
  let lastError: { code: string; message: string; retryable: boolean } | null = null;

  while (iteration < maxIter) {
    iteration++;
    const isFirst = iteration === 1;
    const schema = isFirst ? loopSchema(agent) : outputSchemaOf(agent);

    let res: any;
    try {
      res = await llmRun(schema, `agent.${isFirst ? "decide" : "answer"}`);
    } catch (e: any) {
      lastError = { code: e?.code || "AGENT_TIMEOUT", message: String(e?.message || e), retryable: e?.code === "AGENT_TIMEOUT" };
      break;
    }
    lastModelRes = res;
    if (!res.ok) { lastError = { code: res.error_code || "AI_FAILED", message: res.error_message || "Model call failed.", retryable: true }; break; }
    totalCost += (res.estimated_cost || 0);

    const mId = await recordExecution(svc, {
      run, task, attempt, stage: isFirst ? `decide:${iteration}` : `answer:${iteration}`,
      operation: `run_agent.${isFirst ? "decide" : "answer"}`,
      capability: task.provider_capability || "ai_generation",
      provider: providerRefFrom(res, resolvedProvider),
      model: res.model || model,
      inputHash: task.input_hash, outputHash: hashOf(res.data),
      success: true, durationMs: res.latency_ms || 0, actor,
      tokens: res.tokens, estimatedCost: res.estimated_cost,
      output: { action: res.data?.action, tool: res.data?.tool || null, iteration, context: { agent_version: agent.version || 1, config_hash: cfgHash, budget_limit: budgetLimit, max_tool_calls: maxToolCalls, max_iterations: maxIter, token_estimate: agentCtx.budget.tokenEstimate, memory_count: agentCtx.memory.length, dependency_count: Object.keys(agentCtx.dependencies).length, omitted: agentCtx.budget.omitted, sources: agentCtx.budget.sources, snapshot_business: agentCtx.snapshotRef?.capturedBusinessName || null } },
    });
    execIds.push(mId);

    // ----- Budget ceiling (spec step 6) -----
    if (budgetLimit > 0 && totalCost > budgetLimit) {
      lastError = { code: "BUDGET_EXCEEDED", message: `Agent budget limit (${budgetLimit}) exceeded (spent ${totalCost.toFixed(6)}).`, retryable: false };
      break;
    }

    if (isFirst && res.data && res.data.action === "call_tool" && res.data.tool && res.data.tool.capability) {
      const capKey = res.data.tool.capability;
      const toolArgs = res.data.tool.args || {};

      // ----- 5/6. TOOL PERMISSION + ARG VALIDATION + HARD LIMITS -----
      const perm = enforceToolPermission(allowedTools, capKey);
      if (!perm.ok) {
        const deniedId = await recordExecution(svc, {
          run, task, attempt, stage: `tool_denied:${capKey}`, operation: "run_agent.tool.denied",
          capability: capKey, provider: { provider_id: "(agent_tool)", provider_key: "(agent_tool)", adapter_key: capKey, name: capKey, category: "tool", via: "agent_runtime" },
          model: "", inputHash: task.input_hash, outputHash: hashOf(null),
          success: false, errorCode: "TOOL_NOT_ALLOWED", errorMessage: perm.reason || "Tool not permitted.", retryable: false, durationMs: 0, actor,
          output: { tool: capKey, denied: true, reason: perm.reason },
        });
        execIds.push(deniedId);
        if (obs) obs.recordError({ name: "tool_denied", code: "TOOL_NOT_ALLOWED", message: perm.reason, parentObservationId: agentSpan?.id || null, metadata: { tool: capKey } });
        lastError = { code: "TOOL_NOT_ALLOWED", message: perm.reason || `Tool '${capKey}' is not permitted for this agent.`, retryable: false };
        break;
      }

      if (toolCallCount >= maxToolCalls) {
        lastError = { code: "MAX_TOOL_CALLS", message: `Agent tool-call limit (${maxToolCalls}) reached.`, retryable: false };
        break;
      }

      const av = validateToolArgs(capKey, toolArgs);
      if (!av.ok) {
        const badArgsId = await recordExecution(svc, {
          run, task, attempt, stage: `tool_invalid_args:${capKey}`, operation: "run_agent.tool.invalid_args",
          capability: capKey, provider: { provider_id: "(agent_tool)", provider_key: "(agent_tool)", adapter_key: capKey, name: capKey, category: "tool", via: "agent_runtime" },
          model: "", inputHash: task.input_hash, outputHash: hashOf(null),
          success: false, errorCode: "TOOL_INVALID_ARGS", errorMessage: av.reason || `Invalid args for ${capKey}.`, retryable: false, durationMs: 0, actor,
          output: { tool: capKey, args: toolArgs },
        });
        execIds.push(badArgsId);
        lastError = { code: "TOOL_INVALID_ARGS", message: av.reason || `Invalid args for ${capKey}.`, retryable: false };
        break;
      }

      // ----- 6. TOOL EXECUTION (under a tool span) -----
      toolCallCount++;
      const toolSpan = obs ? obs.startSpan({ name: `tool:${capKey}`, parentObservationId: agentSpan?.id || null, metadata: { tool: capKey, args: toolArgs, call_index: toolCallCount } }) : null;
      const t0 = Date.now();
      let tr: ToolResult;
      try { tr = await executeAgentTool(svc, business, capKey, toolArgs, { run, task, agent }); }
      catch (e: any) { tr = { ok: false, error: String(e?.message || e), errorCode: "TOOL_FAILED" }; }
      const toolDur = Date.now() - t0;
      if (obs && toolSpan) obs.endSpan(toolSpan, { status: tr.ok ? "completed" : "failed", metadata: { duration_ms: toolDur, tool: capKey }, error: tr.ok ? undefined : { code: tr.errorCode || "TOOL_FAILED", message: tr.error } });
      const toolExecId = await recordExecution(svc, {
        run, task, attempt, stage: `tool:${capKey}`, operation: `run_agent.tool.${capKey}`,
        capability: capKey,
        provider: { provider_id: "(agent_tool)", provider_key: "(agent_tool)", adapter_key: capKey, name: capKey, category: "tool", via: "agent_runtime" },
        model: "", inputHash: task.input_hash, outputHash: hashOf(tr.data),
        success: tr.ok, errorCode: tr.ok ? "" : (tr.errorCode || "TOOL_FAILED"), errorMessage: tr.error || "", retryable: false, durationMs: toolDur, actor,
        output: { tool: capKey, ok: tr.ok, call_index: toolCallCount, tool_result: tr.ok ? tr.data : undefined, tool_error: tr.ok ? undefined : tr.error },
      });
      execIds.push(toolExecId);
      if (!tr.ok) { lastError = { code: "TOOL_FAILED", message: tr.error || `Tool '${capKey}' failed.`, retryable: false }; break; }
      toolUsed = capKey; toolResult = tr.data;
      continue;
    }

    // ----- 7. STRUCTURED OUTPUT VALIDATION -----
    const finalData = res.data;
    // Phase 13C: preserve the agent's custom structured fields (business_name, passed,
    // technologies, ...) when it answers on the decide turn — not just answer/tool_used/
    // result_summary. The iteration-2 path (tool-using agents) already returns the full
    // custom object as `finalData`; this brings the iteration-1 answer path to parity so
    // structured handoffs survive for tool-less agents like QA.
    const answering = (finalData.action === "answer" || !finalData.action) && finalData.answer;
    const answerObj = answering
      ? { ...finalData, answer: finalData.answer, tool_used: finalData.tool_used || toolUsed, result_summary: finalData.result_summary || "" }
      : finalData;
    const v = validateStructured(answerObj, outputSchemaOf(agent));
    const ansId = await recordExecution(svc, {
      run, task, attempt, stage: "validate", operation: "run_agent.validate",
      capability: task.provider_capability || "ai_generation",
      provider: providerRefFrom(res, resolvedProvider), model: res.model || model,
      inputHash: task.input_hash, outputHash: hashOf(answerObj),
      success: v.ok, errorCode: v.ok ? "" : "INVALID_OUTPUT", errorMessage: v.ok ? "" : `Missing/empty required fields: ${v.missing.join(", ")}`, retryable: false, durationMs: 0, actor,
      output: { answer: answerObj, tool_used: toolUsed || finalData.tool_used || "" },
    });
    execIds.push(ansId);
    if (!v.ok) { lastError = { code: "INVALID_OUTPUT", message: `Agent output missing required fields: ${v.missing.join(", ")}`, retryable: false }; break; }

    if (obs && agentSpan) obs.endSpan(agentSpan, { status: "completed", metadata: { iterations: iteration, tool_calls: toolCallCount, tool_used: toolUsed, cost: totalCost, duration_ms: Date.now() - agentStart } });
    return {
      status: "completed",
      output: { ...answerObj, tool_used: toolUsed || answerObj.tool_used || "", iterations: iteration, tool_calls: toolCallCount, cost: totalCost, agent: agent.name, agent_version: agent.version || 1, config_hash: cfgHash },
      last_stage: "validate",
      executionIds: execIds,
      provider: providerRefFrom(res, resolvedProvider),
    };
  }

  // ----- 12. FAILURE HANDLING — structured, never leaks credentials -----
  if (!lastError) lastError = { code: "MAX_ITERATIONS", message: `Agent exceeded max_iterations (${maxIter}) without a final answer.`, retryable: true };
  const fId = await recordExecution(svc, {
    run, task, attempt, stage: "failed", operation: "run_agent.failed",
    capability: task.provider_capability || "ai_generation",
    provider: providerRefFrom(lastModelRes, resolvedProvider), model: lastModelRes?.model || model,
    inputHash: task.input_hash, outputHash: hashOf(null),
    success: false, errorCode: lastError.code, errorMessage: lastError.message, retryable: lastError.retryable, durationMs: lastModelRes?.latency_ms || 0, actor,
    tokens: lastModelRes?.tokens, estimatedCost: lastModelRes?.estimated_cost,
    output: { iterations: iteration, tool_calls: toolCallCount, tool_used: toolUsed, cost: totalCost, failure_code: lastError.code },
  });
  execIds.push(fId);
  if (obs && agentSpan) obs.endSpan(agentSpan, { status: "failed", error: lastError, metadata: { iterations: iteration, tool_calls: toolCallCount, tool_used: toolUsed, cost: totalCost, duration_ms: Date.now() - agentStart } });
  return { status: "failed", output: { iterations: iteration, tool_calls: toolCallCount, tool_used: toolUsed, cost: totalCost }, error: lastError, last_stage: "failed", executionIds: execIds, provider: providerRefFrom(lastModelRes, resolvedProvider) };
}