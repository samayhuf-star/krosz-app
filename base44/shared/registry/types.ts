// Module & Capability contracts — the Platform Kernel's discovery surface.

export type ModuleId =
  | 'domain' | 'blueprint' | 'website' | 'seo' | 'crm'
  | 'marketing' | 'email' | 'phone' | 'support' | 'chatbot' | 'analytics'
  | 'ai_orchestration' | 'knowledge_graph' | 'adiology';

export interface ModuleRoute {
  path: string;
  label: string;
}

export interface ModuleSidebarItem {
  path: string;
  label: string;
  icon: string; // lucide-react icon name
}

export interface ModuleManifest {
  id: ModuleId;
  name: string;
  version: string;
  icon: string;
  available: boolean;          // false for announced-but-unbuilt modules (governed by feature flags)
  stage?: string;              // launch pipeline stage (blueprint/domain/website/seo/crm/...)
  dependencies: string[];      // capability keys this module requires (never module ids)
  capabilities: string[];      // capability keys this module provides
  requiredProviders: string[];
  requiredAiEngines: string[];
  permissions: string[];
  routes: ModuleRoute[];
  sidebar: ModuleSidebarItem[];
}

export type CapabilityKind = 'data' | 'service' | 'engine';

export interface Capability {
  key: string;
  moduleId: ModuleId;
  kind: CapabilityKind;
  description: string;
}