import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'blueprint',
  name: 'Blueprint Engine',
  version: '1.0.0',
  icon: 'ScrollText',
  available: true,
  stage: 'blueprint',
  dependencies: [],
  capabilities: ['BusinessBlueprint'],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['blueprint:read', 'blueprint:draft', 'blueprint:approve'],
  routes: [{ path: '/blueprint', label: 'Blueprint' }],
  sidebar: [{ path: '/blueprint', label: 'Blueprint', icon: 'ScrollText' }],
};

const capabilities: Capability[] = [
  { key: 'BusinessBlueprint', moduleId: 'blueprint', kind: 'data', description: 'Single source of truth for business strategy; consumed by every downstream factory.' },
];

registerModule(manifest, capabilities);