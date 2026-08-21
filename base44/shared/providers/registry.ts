import type { ProviderAdapter, ProviderCategory } from "./types.ts";

const adapters = new Map<string, ProviderAdapter>();

export function registerProviderAdapter(adapter: ProviderAdapter) {
  if (adapters.has(adapter.key)) throw new Error(`Provider adapter already registered: ${adapter.key}`);
  adapters.set(adapter.key, adapter);
}

export function getProviderAdapter(key: string): ProviderAdapter {
  const adapter = adapters.get(key);
  if (!adapter) throw new Error(`Provider adapter not installed: ${key}`);
  return adapter;
}

export function hasProviderAdapter(key: string): boolean {
  return adapters.has(key);
}

export function listProviderAdapters(category?: ProviderCategory): ProviderAdapter[] {
  return [...adapters.values()].filter((a) => !category || a.category === category);
}