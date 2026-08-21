import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

// Adiology is a first-class tenant-scoped product module that sits on top of
// the shared orchestration/runtime kernel. It never owns a second workflow
// engine: long-running or AI-assisted work is dispatched through Orchestral.
const manifest: ModuleManifest = {
  id: 'adiology',
  name: 'Adiology Growth OS',
  version: '1.0.0',
  icon: 'Megaphone',
  available: true,
  stage: 'application',
  dependencies: ['AIExecution', 'Telemetry'],
  capabilities: [
    'CampaignIntelligence',
    'KeywordIntelligence',
    'GoogleAdsOperations',
    'DomainMonitoring',
    'GrowthAnalytics',
    'AdiologyWorkspace',
  ],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: ['AIExecution'],
  permissions: [
    'adiology:read',
    'adiology:write',
    'adiology:execute',
    'adiology:billing',
    'adiology:admin',
  ],
  routes: [
    { path: '/dashboard', label: 'Adiology Dashboard' },
    { path: '/campaign-builder', label: 'Campaign Builder' },
    { path: '/keyword-planner', label: 'Keyword Planner' },
    { path: '/domain-monitoring', label: 'Domain Monitoring' },
  ],
  sidebar: [
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { path: '/campaign-builder', label: 'Campaigns', icon: 'Megaphone' },
    { path: '/keyword-planner', label: 'Keywords', icon: 'Search' },
    { path: '/domain-monitoring', label: 'Domains', icon: 'Globe' },
  ],
};

const capabilities: Capability[] = [
  { key: 'CampaignIntelligence', moduleId: 'adiology', kind: 'engine', description: 'Tenant-scoped campaign planning, validation, generation and optimization.' },
  { key: 'KeywordIntelligence', moduleId: 'adiology', kind: 'engine', description: 'Keyword discovery, grouping, negative-keyword generation and intent scoring.' },
  { key: 'GoogleAdsOperations', moduleId: 'adiology', kind: 'service', description: 'Approval-gated Google Ads account operations and publishing.' },
  { key: 'DomainMonitoring', moduleId: 'adiology', kind: 'service', description: 'Workspace-scoped domain, DNS, SSL and expiry monitoring.' },
  { key: 'GrowthAnalytics', moduleId: 'adiology', kind: 'data', description: 'Attribution and growth-performance telemetry scoped to a workspace.' },
  { key: 'AdiologyWorkspace', moduleId: 'adiology', kind: 'data', description: 'Canonical Adiology workspace, membership, entitlement and isolation boundary.' },
];

registerModule(manifest, capabilities);
