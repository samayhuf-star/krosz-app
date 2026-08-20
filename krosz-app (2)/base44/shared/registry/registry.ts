import type { ModuleManifest, Capability } from './types.ts';

// Self-populating stores. Manifests register on import (see manifests/index.ts),
// so the platform discovers modules automatically — no hardcoded lists.

class ModuleRegistryStore {
  private manifests = new Map<string, ModuleManifest>();

  register(m: ModuleManifest) { this.manifests.set(m.id, m); }
  list(): ModuleManifest[] { return Array.from(this.manifests.values()); }
  available(): ModuleManifest[] { return this.list().filter((m) => m.available); }
  get(id: string): ModuleManifest | undefined { return this.manifests.get(id); }
  has(id: string): boolean { return this.manifests.has(id); }

  /** Capability keys actually offered by available modules. */
  activeCapabilityKeys(): Set<string> {
    const set = new Set<string>();
    for (const m of this.available()) for (const c of m.capabilities) set.add(c);
    return set;
  }

  /** A module can be enabled only if every capability it depends on is offered. */
  canEnable(m: ModuleManifest): boolean {
    const offered = this.activeCapabilityKeys();
    return m.dependencies.every((d) => offered.has(d));
  }
}

class CapabilityRegistryStore {
  private caps = new Map<string, Capability[]>();

  register(c: Capability) {
    const arr = this.caps.get(c.key) || [];
    arr.push(c);
    this.caps.set(c.key, arr);
  }
  get(key: string): Capability[] { return this.caps.get(key) || []; }
  providers(key: string): string[] { return this.get(key).map((c) => c.moduleId); }
  has(key: string): boolean { return (this.caps.get(key)?.length || 0) > 0; }
  list(): Capability[] { return Array.from(this.caps.values()).flat(); }
}

export const ModuleRegistry = new ModuleRegistryStore();
export const CapabilityRegistry = new CapabilityRegistryStore();

/** Register a module and the capabilities it provides, in one call. */
export function registerModule(manifest: ModuleManifest, capabilities: Capability[] = []) {
  ModuleRegistry.register(manifest);
  for (const c of capabilities) CapabilityRegistry.register(c);
}