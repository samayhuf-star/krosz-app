// Phase 15A — Interface layer barrel.
//
// The single seam between the AI Orchestration Engine (platform core) and
// a product module (e.g. the Business OS). Pure types only — no runtime, no
// entity imports, no behavior. Implementations live in the product module and
// consume these contracts.
//
// Steps 2–5 of the Phase 15 refactor will point the existing functions at the
// resolved Ports; for now this file only declares the contracts so the codebase
// has a stable compile target.

export type { ContextSnapshot, PromptDescriptor, ContextPort } from './context.ts';
export type { MemoryRecord, MemoryQuery, MemoryPort } from './memory.ts';
export type { Capability, CapabilityKind, CapabilityRegistry, CapabilityResolution } from './capabilities.ts';

import type { ContextPort } from './context.ts';
import type { MemoryPort } from './memory.ts';
import type { CapabilityRegistry } from './capabilities.ts';

/** The full port bundle resolved once per function entry and handed to all logic. */
export interface PlatformPorts {
  context: ContextPort;
  memory: MemoryPort;
  capabilities: CapabilityRegistry;
}