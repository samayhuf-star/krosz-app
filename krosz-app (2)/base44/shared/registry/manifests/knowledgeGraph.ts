import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

// The Business Knowledge Graph is a platform foundation module — it depends on
// nothing but the source modules it observes (Blueprint, Website, CRM, Domain,
// SEO), and everything else depends on IT. It has no write-side coupling to any
// module: it reads sources directly and exposes one read-only Context API.
const manifest: ModuleManifest = {
  id: 'business_knowledge_graph',
  name: 'Business Knowledge Graph',
  version: '1.0.0',
  icon: 'Network',
  available: true,
  stage: 'foundation',
  dependencies: ['BusinessBlueprint', 'WebsiteGeneration', 'CRM', 'Domain', 'SEOGeneration'],
  capabilities: ['BusinessContext', 'EntityRelationships', 'CrossModuleReferences', 'ChangeDetection'],
  requiredProviders: [],
  requiredAiEngines: [],
  permissions: ['knowledge_graph:read', 'knowledge_graph:rebuild'],
  routes: [{ path: '/knowledge-graph', label: 'Knowledge Graph' }],
  sidebar: [{ path: '/knowledge-graph', label: 'Knowledge Graph', icon: 'Network' }],
};

const capabilities: Capability[] = [
  { key: 'BusinessContext', moduleId: 'business_knowledge_graph', kind: 'api', description: 'Single read-only context snapshot every present and future module consumes (SEO, Marketing, Email, Support, Chatbot, Analytics).' },
  { key: 'EntityRelationships', moduleId: 'business_knowledge_graph', kind: 'engine', description: 'Denormalized graph of nodes + cross-module relationships (pages↔keywords↔clusters↔stages↔automations↔tasks↔email templates↔content opportunities).' },
  { key: 'CrossModuleReferences', moduleId: 'business_knowledge_graph', kind: 'data', description: 'source_versions index tracking which Blueprint/Website/CRM/Domain/SEO version each graph was built from.' },
  { key: 'ChangeDetection', moduleId: 'business_knowledge_graph', kind: 'engine', description: 'Detects when upstream modules advanced and self-heals the graph on the next read — no cross-function event bus required.' },
];

registerModule(manifest, capabilities);