import { base44 } from '@/api/base44Client';

// Frontend client for the Business Knowledge Graph backend function.
// Pages use this; future modules use the shared SDK's getBusinessContext directly.
export const knowledgeGraphApi = {
  status: (business_id) => base44.functions.invoke('knowledgeGraph', { action: 'status', business_id }).then((r) => r.data),
  getContext: (business_id) => base44.functions.invoke('knowledgeGraph', { action: 'getContext', business_id }).then((r) => r.data),
  getGraph: (business_id) => base44.functions.invoke('knowledgeGraph', { action: 'getGraph', business_id }).then((r) => r.data),
  rebuild: (business_id) => base44.functions.invoke('knowledgeGraph', { action: 'rebuild', business_id }).then((r) => r.data),
};