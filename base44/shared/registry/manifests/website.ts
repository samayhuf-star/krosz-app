import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'website',
  name: 'Website Factory',
  version: '1.0.0',
  icon: 'Factory',
  available: true,
  stage: 'website',
  dependencies: ['BusinessBlueprint'],
  capabilities: ['WebsiteGeneration'],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['website:read', 'website:generate', 'website:publish', 'website:rollback'],
  routes: [{ path: '/website', label: 'Website Factory' }],
  sidebar: [{ path: '/website', label: 'Website Factory', icon: 'Factory' }],
};

const capabilities: Capability[] = [
  { key: 'WebsiteGeneration', moduleId: 'website', kind: 'engine', description: 'Generates production-ready website versions from an approved Business Blueprint.' },
];

registerModule(manifest, capabilities);