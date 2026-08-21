import { base44 } from '@/api/base44Client';

export const callObservability = async (action, body = {}) => {
  const res = await base44.functions.invoke('observability', { action, ...body });
  return res.data;
};