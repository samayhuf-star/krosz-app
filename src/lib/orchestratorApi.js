import { base44 } from '@/api/base44Client';

// Frontend client for the AI Orchestration Engine backend function.
export const orchestratorApi = {
  orchestrate: (payload) => base44.functions.invoke('aiOrchestrator', { action: 'orchestrate', ...payload }).then((r) => r.data),
  listPrompts: (tenant_id) => base44.functions.invoke('aiOrchestrator', { action: 'listPrompts', tenant_id }).then((r) => r.data),
  getPrompt: (prompt_id, version, tenant_id) => base44.functions.invoke('aiOrchestrator', { action: 'getPrompt', prompt_id, version, tenant_id }).then((r) => r.data),
  registerPrompt: (p) => base44.functions.invoke('aiOrchestrator', { action: 'registerPrompt', ...p }).then((r) => r.data),
  publishPrompt: (prompt_id, version, status = 'published', tenant_id) => base44.functions.invoke('aiOrchestrator', { action: 'publishPrompt', prompt_id, version, status, tenant_id }).then((r) => r.data),
  telemetry: (opts = {}) => base44.functions.invoke('aiOrchestrator', { action: 'telemetry', ...opts }).then((r) => r.data),
  getContext: (business_id) => base44.functions.invoke('aiOrchestrator', { action: 'getContext', business_id }).then((r) => r.data),
  seedTestPrompt: (tenant_id) => base44.functions.invoke('aiOrchestrator', { action: 'seedTestPrompt', tenant_id }).then((r) => r.data),
  assistantRoute: (business_id, request) => base44.functions.invoke('aiOrchestrator', { action: 'assistantRoute', business_id, request }).then((r) => r.data),
};