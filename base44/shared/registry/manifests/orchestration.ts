import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

// The AI Orchestration Engine is the single entry point for ALL AI generation.
// No module executes AI directly; every request flows through this engine,
// which handles context loading, prompt resolution, provider/model selection,
// retry/fallback, validation, telemetry, cache, and approval integration.
const manifest: ModuleManifest = {
  id: 'ai_orchestration',
  name: 'AI Orchestration Engine',
  version: '1.0.0',
  icon: 'Workflow',
  available: true,
  stage: 'foundation',
  dependencies: ['BusinessContext', 'ai_execution_engine', 'version_engine'],
  capabilities: ['AIExecution', 'PromptManagement', 'ContextResolution', 'Validation', 'Telemetry', 'Approval'],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: [],
  permissions: ['orchestration:execute', 'orchestration:manage', 'orchestration:observe'],
  routes: [{ path: '/orchestration', label: 'AI Orchestration' }],
  sidebar: [{ path: '/orchestration', label: 'AI Orchestration', icon: 'Workflow' }],
};

const capabilities: Capability[] = [
  { key: 'AIExecution', moduleId: 'ai_orchestration', kind: 'engine', description: 'Runs the full orchestration pipeline: context → prompt → provider → execution → validation → telemetry → knowledge-graph update.' },
  { key: 'PromptManagement', moduleId: 'ai_orchestration', kind: 'service', description: 'Versioned Prompt Registry. Modules reference prompt ids; never embed prompts.' },
  { key: 'ContextResolution', moduleId: 'ai_orchestration', kind: 'service', description: 'loadBusinessContext / loadCapabilityContext / loadPromptContext — reads only the Business Knowledge Graph.' },
  { key: 'Validation', moduleId: 'ai_orchestration', kind: 'service', description: 'Reusable validator registry. Modules register shape/quality validators per capability.' },
  { key: 'Telemetry', moduleId: 'ai_orchestration', kind: 'data', description: 'Unified AIExecution ledger: provider, model, prompt version, KG version, tokens, latency, retries, cost, success.' },
  { key: 'Approval', moduleId: 'ai_orchestration', kind: 'service', description: 'Integrates drafts/approvals with the shared Version Engine lifecycle.' },
];

registerModule(manifest, capabilities);