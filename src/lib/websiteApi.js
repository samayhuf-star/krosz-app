import { base44 } from '@/api/base44Client';

// Client for the websiteFactory backend function — the AI Website Factory.
// The browser sends only business_id / website_id; all blueprint reading and
// LLM orchestration happen server-side.
export async function callWebsiteFactory(action, payload = {}) {
  const res = await base44.functions.invoke('websiteFactory', { action, ...payload });
  return res.data;
}

// Website generation is dispatched through the Operations Orchestrator (NOT
// websiteFactory directly). The orchestrator creates the Run + Task, builds the
// full context snapshot, enforces DAG dependencies, resolves the provider, and
// runs the real Website adapter with truthful provenance + checkpoints. Returns
// the resulting run + website output. status/publish/rollback remain direct
// (lifecycle, not generation).
export async function dispatchWebsiteGeneration(business_id, goal) {
  const res = await base44.functions.invoke('orchestrator', {
    action: 'dispatch-task', task_type: 'generate_website', task_key: 'website', capability: 'ai_generation',
    business_id, goal: goal || 'Generate website from approved blueprint',
  });
  return res.data;
}