// Context Resolution — the orchestration engine consumes ONLY the Business
// Knowledge Graph. Business modules never manually assemble AI context.
//
// Three public helpers (mirroring the spec):
//   • loadBusinessContext(svc, businessId)           → full read-only snapshot
//   • loadCapabilityContext(capability, snapshot)    → capability-relevant slice
//   • loadPromptContext(svc, businessId, promptId)    → snapshot + resolved prompt

import { getBusinessContext, getGraph } from '../knowledge-graph/index.ts';
import { latestPrompt } from './registry.ts';

export async function loadBusinessContext(svc: any, businessId: string): Promise<any | null> {
  return getBusinessContext(svc, businessId);
}

// Return the Knowledge Graph version used for the last context load (for telemetry).
export async function loadGraphVersion(svc: any, businessId: string): Promise<number | null> {
  const g = await getGraph(svc, businessId);
  return g?.version ?? null;
}

const CAPABILITY_SLICES: Record<string, string[]> = {
  BusinessBlueprint: ['business', 'brand', 'services', 'target_audience', 'locations', 'lead_sources'],
  WebsiteGeneration: ['business', 'brand', 'services', 'target_audience', 'locations', 'pages'],
  SEOGeneration: ['business', 'brand', 'services', 'pages', 'locations', 'target_audience', 'pipeline_stages', 'lead_sources', 'owner_roles'],
  LeadManagement: ['business', 'services', 'pipeline_stages', 'lead_sources', 'target_audience'],
  SalesAutomation: ['business', 'pipeline_stages', 'lead_sources'],
  CRMReporting: ['business', 'services', 'pipeline_stages'],
  CampaignGeneration: ['business', 'brand', 'services', 'target_audience', 'locations'],
  EmailDelivery: ['business', 'brand', 'services'],
  ConversationalAI: ['business', 'brand', 'services', 'pages'],
  Analytics: ['business', 'services', 'pages'],
};

/** Slice the snapshot down to the fields a capability actually needs. */
export function loadCapabilityContext(capability: string, snapshot: any): any {
  if (!snapshot) return null;
  const keys = CAPABILITY_SLICES[capability];
  if (!keys) return snapshot;
  const slice: any = {};
  for (const k of keys) if (snapshot[k] !== undefined && snapshot[k] !== null) slice[k] = snapshot[k];
  // Always carry business identity for grounding.
  if (!slice.business && snapshot.business) slice.business = snapshot.business;
  return slice;
}

/** Snapshot + resolved prompt (for inspection / prompt authoring). */
export async function loadPromptContext(svc: any, businessId: string, promptId: string, tenant_id?: string): Promise<{ context: any; prompt: any } | null> {
  const context = await loadBusinessContext(svc, businessId);
  const prompt = await latestPrompt(svc, promptId, tenant_id);
  if (!prompt) return null;
  const capability = prompt.capability;
  return { context: loadCapabilityContext(capability, context), prompt };
}