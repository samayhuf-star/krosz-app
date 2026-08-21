// Internal Platform Kernel SDK — the single import for every platform service.
// Future modules import from here instead of reaching into individual internals:
//   import { ModuleRegistry, CapabilityRegistry, createModuleEngine,
//     runAIStage, resolveFlag, isModuleEnabled, bus, resolveWorkspace } from '../../shared/sdk/index.ts'
export * from '../registry/index.ts';          // ModuleRegistry, CapabilityRegistry, manifests (auto-registered)
export * from '../version-engine/index.ts';    // Version Engine (draft/approved/published/superseded/archived/rollback/history)
export * from '../ai/stages.ts';               // Telemetry / AI Execution Engine (runAIStage)
export * from '../feature-flags/index.ts';      // Feature Flags (platform/workspace/module resolution)
export * from '../events/bus.ts';               // Event helpers (pub/sub)
export * from '../knowledge-graph/index.ts';    // Business Knowledge Graph — single read-only Business Context API (the one thing every module depends on)
export * from '../orchestration/index.ts';      // AI Orchestration Engine — the single entry point for ALL AI generation (prompt registry, context, validation, telemetry, cache)

// Workspace API (backend). Frontend uses useActiveBusiness (React context).
export async function resolveWorkspace(svc: any, businessId?: string): Promise<any | null> {
  if (!businessId) return null;
  try { return await svc.entities.Business.get(businessId); } catch { return null; }
}