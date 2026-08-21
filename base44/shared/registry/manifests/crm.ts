import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'crm',
  name: 'CRM Factory',
  version: '2.0.0',
  icon: 'Users',
  available: true,
  stage: 'crm',
  dependencies: ['BusinessBlueprint', 'WebsiteGeneration', 'SEOGeneration'],
  capabilities: ['LeadManagement', 'SalesAutomation', 'CRMReporting', 'CustomerProfiles'],
  requiredProviders: ['ai_provider'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['crm:read', 'crm:generate', 'crm:approve', 'crm:publish', 'crm:rollback'],
  routes: [{ path: '/crm', label: 'CRM Factory' }],
  sidebar: [{ path: '/crm', label: 'CRM Factory', icon: 'Users' }],
};

const capabilities: Capability[] = [
  { key: 'LeadManagement', moduleId: 'crm', kind: 'engine', description: 'Pipeline, lead scoring, and lead lifecycle generated from blueprint + website + approved SEO version.' },
  { key: 'SalesAutomation', moduleId: 'crm', kind: 'engine', description: 'Automation rules, task templates, and email templates that drive the sales process.' },
  { key: 'CRMReporting', moduleId: 'crm', kind: 'engine', description: 'Dashboards and scheduled reports generated for this business.' },
  { key: 'CustomerProfiles', moduleId: 'crm', kind: 'data', description: 'Custom lead fields and contact profile model tailored to the industry.' },
];

registerModule(manifest, capabilities);