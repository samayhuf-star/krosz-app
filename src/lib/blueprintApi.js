import { base44 } from '@/api/base44Client';

// Client for the blueprintEngine backend function. Future engines call
// `load` to read the approved Business Blueprint (the single source of truth).
export async function callBlueprintEngine(action, payload = {}) {
  const res = await base44.functions.invoke('blueprintEngine', { action, ...payload });
  return res.data;
}