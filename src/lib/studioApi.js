import { base44 } from '@/api/base44Client';

const invoke = (action, payload = {}) => base44.functions.invoke('workflowStudio', { action, ...payload }).then((r) => r.data);

export const studioApi = {
  nodeLibrary: () => invoke('node-library'),
  aiBuild: (prompt, business_id) => invoke('ai-build', { prompt, business_id }),
  validate: (canvas) => invoke('validate', { canvas }),
  simulate: (canvas) => invoke('simulate', { canvas }),
  saveDraft: (p) => invoke('save-draft', p),
  getDraft: (draft_id) => invoke('get-draft', { draft_id }),
  listDrafts: (business_id, status) => invoke('list-drafts', { business_id, status }),
  publish: (draft_id, opts = {}) => invoke('publish', { draft_id, ...opts }),
  deleteDraft: (draft_id) => invoke('delete-draft', { draft_id }),
  favorite: (draft_id, favorite) => invoke('favorite', { draft_id, favorite }),
  versions: (template_id) => invoke('versions', { template_id }),
  rollback: (template_id, version) => invoke('rollback', { template_id, version }),
  clone: (template_id, business_id) => invoke('clone', { template_id, business_id }),
  exportDraft: (draft_id) => invoke('export', { draft_id }),
  importDraft: (business_id, workflow, name) => invoke('import', { business_id, workflow, name }),
  share: (draft_id) => invoke('share', { draft_id }),
  debugNode: (run_id, task_key) => invoke('debug-node', { run_id, task_key }),
  listTemplates: () => invoke('list-templates'),
  executionPreview: (canvas) => invoke('execution-preview', { canvas }),
  execute: (template_id, business_id, goal) => invoke('execute', { template_id, business_id, goal }),
};