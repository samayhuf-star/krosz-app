import { base44 } from '@/api/base44Client';

// Client for the domainEngine backend function. The browser sends only names, ids
// and the planner profile; no registrar credentials ever leave the server.
export async function callDomainEngine(action, payload = {}) {
  const res = await base44.functions.invoke('domainEngine', { action, ...payload });
  return res.data;
}