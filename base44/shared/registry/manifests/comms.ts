// Communication Hub — module manifest for the Platform Kernel (auto-discovery).
import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

const manifest: ModuleManifest = {
  id: 'email',
  name: 'Communication Hub',
  version: '1.0.0',
  icon: 'Mail',
  available: true,
  stage: 'communications',
  dependencies: ['BusinessBlueprint', 'Domain', 'CRM'],
  capabilities: ['EmailGeneration', 'EmailRouting', 'EmailAIAssist', 'CommunicationTelemetry', 'ChannelProvisioning', 'DomainDnsManagement'],
  requiredProviders: ['email_provider', 'ai_provider'],
  requiredAiEngines: ['ai_execution_engine'],
  permissions: ['comms:read', 'comms:manage', 'comms:provision', 'comms:ai', 'comms:telemetry'],
  routes: [{ path: '/communications', label: 'Communication Hub' }],
  sidebar: [{ path: '/communications', label: 'Communication Hub', icon: 'Mail' }],
};

const capabilities: Capability[] = [
  { key: 'EmailGeneration', moduleId: 'email', kind: 'engine', description: 'AI-recommended mailbox set from approved Blueprint; human-approved provisioning.' },
  { key: 'EmailRouting', moduleId: 'email', kind: 'engine', description: 'Inbound routing automations (invoice→finance, complaint→support, lead→CRM, appointment→calendar, VIP→priority).' },
  { key: 'EmailAIAssist', moduleId: 'email', kind: 'engine', description: 'Summarize, draft reply, rewrite, translate, categorize, extract action items, extract lead, suggest next action.' },
  { key: 'CommunicationTelemetry', moduleId: 'email', kind: 'service', description: 'Per provider/mailbox/workspace/business latency, sync duration, storage, messages, AI cost, errors, retries.' },
  { key: 'ChannelProvisioning', moduleId: 'email', kind: 'service', description: 'Provider-agnostic mailbox lifecycle: create/delete/suspend/reset/aliases/forwarding/catch-all/auto-reply/quotas.' },
  { key: 'DomainDnsManagement', moduleId: 'email', kind: 'service', description: 'Deterministic MX/SPF/DKIM/DMARC/Autodiscover/Return-Path blueprint per selected provider + DNS health score.' },
];

registerModule(manifest, capabilities);