import { base44 } from '@/api/base44Client';

// Browser client for the agentRuntime backend function. Sends only action names +
// ids + scope references; never receives raw provider credentials. Used by the
// Advanced-only /agents and /agents/playground pages.
export async function callAgent(action, payload = {}) {
  const res = await base44.functions.invoke('agentRuntime', { action, ...payload });
  return res.data;
}

export const listAgents = (business_id) => callAgent('list-agents', { business_id });
export const getAgent = (agent_id) => callAgent('get-agent', { agent_id });
export const getAgentStats = (agent_id) => callAgent('get-agent-stats', { agent_id });
export const defineAgent = (data) => callAgent('define-agent', data);
export const updateAgent = (data) => callAgent('update-agent', data);
export const runAgent = (business_id, agent_id, objective, task_key) =>
  callAgent('run-agent', { business_id, agent_id, objective, task_key });
export const getResult = (run_id) => callAgent('get-result', { run_id });
export const runWebsiteSliceTest = (business_id) => callAgent('run-website-slice-test', { business_id });
export const runHardeningTest = (business_id) => callAgent('run-hardening-test', { business_id });