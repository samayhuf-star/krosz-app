import { base44 } from '@/api/base44Client';

// Shared client for the providerManagement backend function.
// The browser only ever sends action names + ids + scope references; it never
// transmits or receives raw provider credentials (those live in platform secrets).
export async function callProviderManagement(action, payload = {}) {
  const res = await base44.functions.invoke('providerManagement', { action, ...payload });
  return res.data;
}