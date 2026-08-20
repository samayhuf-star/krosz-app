// Factory adapter for task type "run_agent" — bridges the Workflow Engine to the
// Agent Runtime. The engine dispatches it exactly like any factory adapter; this
// adapter only resolves the agent definition and delegates to executeAgent. It
// never orchestrates — the engine owns DAG/approval/retry/blocked state.
//
// The agent to run is supplied as `agent_id` on the task/run input context.

import { executeAgent, loadAgent } from "../../agents/runtime.ts";
import type { Adapter } from "../adapters.ts";

export function createAgentAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor, resumeFromStage } = input as any;
    const agentId =
      (task.input_context && task.input_context.agent_id) ||
      (run.context_snapshot && run.context_snapshot.agent_id) ||
      (context && context.agent_id);
    if (!agentId) {
      return { status: "failed", error: { code: "AGENT_NOT_CONFIGURED", message: "No agent_id supplied for run_agent task.", retryable: false }, last_stage: "init", executionIds: [] };
    }
    const agent = await loadAgent(svc, agentId);
    if (!agent) {
      return { status: "failed", error: { code: "AGENT_NOT_FOUND", message: `Agent ${agentId} not found.`, retryable: false }, last_stage: "init", executionIds: [] };
    }
    if (agent.status && agent.status !== "active" && agent.status !== "draft") {
      return { status: "failed", error: { code: "AGENT_INACTIVE", message: `Agent ${agent.name} is ${agent.status}.`, retryable: false }, last_stage: "init", executionIds: [] };
    }
    const result = await executeAgent(svc, { agent, run, task, context, resolvedProvider, actor, resumeFromStage });
    return {
      status: result.status,
      output: result.output,
      error: result.error,
      last_stage: result.last_stage,
      executionIds: result.executionIds,
      provider: result.provider,
    };
  };
}