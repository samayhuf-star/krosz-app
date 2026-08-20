import { base44 } from '@/api/base44Client';

export async function callAI(action, payload = {}) {
  const res = await base44.functions.invoke('aiRuntime', { action, ...payload });
  return res.data;
}