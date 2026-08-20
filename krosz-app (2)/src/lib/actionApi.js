import { base44 } from '@/api/base44Client';

const invoke = (payload) => base44.functions.invoke('actionEngine', payload).then((r) => r.data);

export const actionApi = {
  request: (business_id, request) => invoke({ action: 'request', business_id, request }),
  getStatus: (business_id, action_id) => invoke({ action: 'get-status', business_id, action_id }),
  approve: (business_id, action_id) => invoke({ action: 'approve', business_id, action_id }),
  retry: (business_id, action_id) => invoke({ action: 'retry', business_id, action_id }),
  listActions: (business_id) => invoke({ action: 'list-actions', business_id }),
};

// Customer-language status labels (no internal codes leaked to the UI).
export const ACTION_LABEL = {
  understanding: 'Understanding',
  preparing: 'Preparing',
  queued: 'Queued',
  running: "I'm on it",
  waiting_for_approval: 'Needs your approval',
  awaiting_clarification: 'Needs a detail',
  completed: 'Done',
  failed: 'Needs attention',
  blocked: 'Waiting on another step',
  capability_not_available: "Not available yet",
};