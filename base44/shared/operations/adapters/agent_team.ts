// Phase 13C — Factory adapter: run_agent_team.
//
// Bridges the Workflow Engine to the Agent Team Runtime. The engine dispatches a
// single LaunchTask of type `run_agent_team` (an Agent Team is a controlled
// execution group inside ONE task). The adapter loads the PINNED team version
// (immutability), verifies its config_hash, and delegates to executeTeam, which
// runs the internal agent graph reusing executeAgent per agent.
//
// The adapter NEVER owns run/task/approval/retry state — the Workflow Engine does.

import { executeTeam, loadTeam, latestActiveTeam } from "../../teams/runtime.ts";
import type { ExecuteInput, ExecuteResult } from "../adapters.ts";

export function createAgentTeamAdapter() {
  return async (input: ExecuteInput): Promise<ExecuteResult> => {
    const { svc, run, task, context, resolvedProvider, actor } = input;
    const inp = task.input_context || {};
    const teamId = inp.team_id;
    if (!teamId) {
      return { status: "failed", error: { code: "TEAM_CONFIG_INVALID", message: "team_id is required on the task input_context.", retryable: false }, last_stage: "team.load", executionIds: [] };
    }
    const version = inp.team_version ? Number(inp.team_version) : null;
    const team = version ? await loadTeam(svc, teamId, version) : await latestActiveTeam(svc, teamId);
    if (!team) {
      return { status: "failed", error: { code: "TEAM_NOT_FOUND", message: `No AgentTeam ${teamId}@v${version || "active"}.`, retryable: false }, last_stage: "team.load", executionIds: [] };
    }
    if (!team.enabled) {
      return { status: "failed", error: { code: "TEAM_CONFIG_INVALID", message: `Team ${teamId} is disabled.`, retryable: false }, last_stage: "team.load", executionIds: [] };
    }
    // Immutability pin: if a config_hash was recorded on the dispatch input, it must
    // match the loaded version's hash. A mismatch means the team was edited after the
    // run was created — the run stays pinned to the original (fail rather than drift).
    if (inp.team_config_hash && team.config_hash && String(inp.team_config_hash) !== String(team.config_hash)) {
      return { status: "failed", error: { code: "TEAM_VERSION_PIN_MISMATCH", message: "Team config_hash differs from the dispatch pin; run is immutable.", retryable: false }, last_stage: "team.load", executionIds: [] };
    }
    const res = await executeTeam(svc, { team, run, task, context, resolvedProvider, actor });
    return {
      status: res.status,
      output: res.output || { team_status: res.status, error: res.error },
      error: res.error,
      last_stage: res.last_stage,
      executionIds: res.executionIds || [],
    };
  };
}