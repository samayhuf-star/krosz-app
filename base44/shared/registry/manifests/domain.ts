import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'domain',
  name: 'Domain Engine',
  version: '1.0.0',
  icon: 'Globe',
  available: true,
  stage: 'domain',
  dependencies: [],
  capabilities: ['DomainRegistration'],
  requiredProviders: ['domain_registrar'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['domain:read', 'domain:search', 'domain:purchase', 'domain:manage'],
  routes: [{ path: '/domains', label: 'Domain Engine' }],
  sidebar: [{ path: '/domains', label: 'Domain Engine', icon: 'Globe' }],
};

const capabilities: Capability[] = [
  { key: 'DomainRegistration', moduleId: 'domain', kind: 'service', description: 'AI-scored domain search and registration via configured registrars.' },
];

registerModule(manifest, capabilities);