import { createClient } from '@base44/sdk';
export const base44 = createClient({ appId: import.meta.env.VITE_BASE44_APP_ID || '6a7a236310d39c4c5cb1f566' });
