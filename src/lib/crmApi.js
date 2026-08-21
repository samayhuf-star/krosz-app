import { base44 } from '@/api/base44Client';

// Client for the crmFactory backend function — the AI CRM Factory (version lifecycle).
export async function callCrmFactory(action, payload = {}) {
  const res = await base44.functions.invoke('crmFactory', { action, ...payload });
  return res.data;
}

// CRM generation is dispatched through the Operations Orchestrator (NOT crmFactory
// directly). The orchestrator creates the Run + Task, builds the full context
// snapshot, enforces DAG dependencies, and runs the real CRM adapter with truthful
// provenance + checkpoints. Returns the resulting run + CRM version output.
export async function dispatchCrmGeneration(business_id, goal) {
  const res = await base44.functions.invoke('orchestrator', {
    action: 'dispatch-task', task_type: 'generate_crm', task_key: 'crm', capability: 'ai_generation',
    business_id, goal: goal || 'Generate CRM program',
  });
  return res.data;
}