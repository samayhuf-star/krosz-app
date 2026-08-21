import { base44 } from '@/api/base44Client';

// Frontend client for the Launch Assistant — a thin client over the Operations
// Orchestrator. Every launch creates/continues an Orchestrator Run; every factory
// operation is an Orchestrator Task dispatched via the DAG. The assistant owns only
// assessment, recommendations, health, and the launch report (read-only — no factory
// execution, no recordStep, no runModuleStep).
export const launchApi = {
  prepare: (payload) => base44.functions.invoke('launchAssistant', { action: 'prepare', ...payload }).then((r) => r.data),
  getStatus: (payload) => base44.functions.invoke('launchAssistant', { action: 'getStatus', ...payload }).then((r) => r.data),
  start: (launch_id) => base44.functions.invoke('launchAssistant', { action: 'start', launch_id }).then((r) => r.data),
  approve: (launch_id, step_id) => base44.functions.invoke('launchAssistant', { action: 'approve', launch_id, step_id }).then((r) => r.data),
  reject: (launch_id, step_id) => base44.functions.invoke('launchAssistant', { action: 'reject', launch_id, step_id }).then((r) => r.data),
  skip: (launch_id, step_id) => base44.functions.invoke('launchAssistant', { action: 'skip', launch_id, step_id }).then((r) => r.data),
  retry: (launch_id, step_id) => base44.functions.invoke('launchAssistant', { action: 'retry', launch_id, step_id }).then((r) => r.data),
  cancel: (launch_id) => base44.functions.invoke('launchAssistant', { action: 'cancel', launch_id }).then((r) => r.data),
  recommendations: (launch_id) => base44.functions.invoke('launchAssistant', { action: 'recommendations', launch_id }).then((r) => r.data),
  health: (launch_id) => base44.functions.invoke('launchAssistant', { action: 'health', launch_id }).then((r) => r.data),
  report: (launch_id) => base44.functions.invoke('launchAssistant', { action: 'report', launch_id }).then((r) => r.data),
  history: (business_id) => base44.functions.invoke('launchAssistant', { action: 'history', business_id }).then((r) => r.data),
};