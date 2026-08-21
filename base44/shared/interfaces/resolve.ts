// Phase 15C — Platform Port Resolution.
//
// resolvePlatformPorts(svc, context) → PlatformPorts.
//
// The single entry the orchestration code will (eventually) call to obtain the
// three neutral ports (context, memory, capabilities). For Phase 15C the returned
// ports are thin adapters over the EXISTING Business OS implementations — nothing
// is moved, nothing is duplicated, behavior is unchanged.
//
// Dependency direction (this phase establishes it):
//     Existing Business OS impl  →  implements  →  Interface contract
//     Orchestration code (later) →  consumes     →  PlatformPorts
//
// This file imports Business OS adapters (the implementation side of the seam).
// It is the ONLY place that knows which concrete adapters back the ports, so the
// rest of the platform can stay neutral.

import type { PlatformPorts } from "./index.ts";
import { BusinessContextPort } from "./adapters/businessContext.ts";
import { BusinessMemoryPort } from "./adapters/businessMemory.ts";
import { businessCapabilityRegistry } from "./adapters/businessCapabilities.ts";

export function resolvePlatformPorts(svc: any, _context?: any): PlatformPorts {
  return {
    context: new BusinessContextPort(svc),
    memory: new BusinessMemoryPort(svc),
    capabilities: businessCapabilityRegistry(),
  };
}

export { BusinessContextPort, BusinessMemoryPort, businessCapabilityRegistry };