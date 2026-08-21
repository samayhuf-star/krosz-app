import { base44 } from '@/api/base44Client';

// Client for the universal Workflow Engine (the `orchestrator` backend function,
// formerly the Business Operations Orchestrator). Reads come from entities
// directly (LaunchPlan / LaunchTask / AIExecution); this client only exposes
// the ACTIONS the engine owns: launch, step (advance), approve, reject, skip,
// retry, cancel, plus template listing.
const invoke = (payload) => base44.functions.invoke('orchestrator', payload).then((r) => r.data);

export const workflowsApi = {
  listTemplates: () => invoke({ action: 'list-templates' }),
  launch: (business_id, template_id, goal, input) =>
    invoke({ action: 'launch', business_id, template_id, goal, input }),
  step: (run_id) => invoke({ action: 'step', run_id }),
  approve: (run_id, task_id, decision) =>
    invoke({ action: 'approve', run_id, task_id, decision }),
  reject: (run_id, task_id, reason) =>
    invoke({ action: 'reject', run_id, task_id, reason }),
  skip: (run_id, task_id) => invoke({ action: 'skip', run_id, task_id }),
  retry: (run_id, task_id) => invoke({ action: 'retry', run_id, task_id }),
  cancel: (run_id) => invoke({ action: 'cancel', run_id }),
};