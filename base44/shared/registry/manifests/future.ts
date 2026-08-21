import { registerModule } from '../registry.ts';
import type { ModuleManifest, Capability } from '../types.ts';

// Announced-but-unbuilt modules. Registered so the platform (and feature flags)
// already know about them; `available:false` keeps them out of active capability sets.
const future: Array<{ m: ModuleManifest; c: Capability[] }> = [
  {
    m: {
      id: 'marketing', name: 'Marketing Engine', version: '0.1.0', icon: 'Megaphone', available: false, stage: 'marketing',
      dependencies: ['BusinessBlueprint', 'WebsiteGeneration', 'SEOGeneration'], capabilities: ['CampaignGeneration'],
      requiredProviders: ['ai_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'CampaignGeneration', moduleId: 'marketing', kind: 'engine', description: 'Future: campaign planning and generation.' }],
  },
  {
    m: {
      id: 'email', name: 'Email Engine', version: '0.1.0', icon: 'Mail', available: false, stage: 'email',
      dependencies: ['BusinessBlueprint'], capabilities: ['EmailDelivery'],
      requiredProviders: ['email_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'EmailDelivery', moduleId: 'email', kind: 'service', description: 'Future: transactional and campaign email.' }],
  },
  {
    m: {
      id: 'phone', name: 'Phone Engine', version: '0.1.0', icon: 'Phone', available: false, stage: 'phone',
      dependencies: ['BusinessBlueprint'], capabilities: ['Telephony'],
      requiredProviders: ['phone_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'Telephony', moduleId: 'phone', kind: 'service', description: 'Future: telephony and number provisioning.' }],
  },
  {
    m: {
      id: 'support', name: 'Support Engine', version: '0.1.0', icon: 'LifeBuoy', available: false, stage: 'support',
      dependencies: ['BusinessBlueprint', 'LeadManagement'], capabilities: ['SupportTicketing'],
      requiredProviders: ['ai_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'SupportTicketing', moduleId: 'support', kind: 'service', description: 'Future: support ticketing and knowledge base.' }],
  },
  {
    m: {
      id: 'chatbot', name: 'Chatbot Engine', version: '0.1.0', icon: 'Bot', available: false, stage: 'chatbot',
      dependencies: ['BusinessBlueprint', 'WebsiteGeneration'], capabilities: ['ConversationalAI'],
      requiredProviders: ['ai_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'ConversationalAI', moduleId: 'chatbot', kind: 'engine', description: 'Future: conversational assistants over business content.' }],
  },
  {
    m: {
      id: 'analytics', name: 'Analytics Engine', version: '0.1.0', icon: 'BarChart3', available: false, stage: 'analytics',
      dependencies: ['BusinessBlueprint', 'WebsiteGeneration'], capabilities: ['Analytics'],
      requiredProviders: ['analytics_provider'], requiredAiEngines: ['ai_execution_engine'],
      permissions: [], routes: [], sidebar: [],
    },
    c: [{ key: 'Analytics', moduleId: 'analytics', kind: 'service', description: 'Future: analytics and insights.' }],
  },
];

for (const { m, c } of future) registerModule(m, c);