import { base44 } from '@/api/base44Client';

// Client for the seoFactory backend function — the AI SEO Factory.
export async function callSeoFactory(action, payload = {}) {
  const res = await base44.functions.invoke('seoFactory', { action, ...payload });
  return res.data;
}