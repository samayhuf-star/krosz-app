import { base44 } from '@/api/base44Client';

// Account-level Business Memory. Lives on the Tenant record (the account) so
// confirmed preferences are reused across every business the owner launches —
// the second business only asks for what is different.
// Only confirmed values are persisted here; inferred-but-unconfirmed values
// stay on the business profile with confidence/source/reason.

export async function getAccountMemory() {
  try {
    const user = await base44.auth.me();
    const tid = user?.tenant_id;
    if (!tid) return {};
    const t = await base44.entities.Tenant.get(tid);
    return t?.account_memory || {};
  } catch {
    return {};
  }
}

export async function saveAccountMemory(patch) {
  try {
    const user = await base44.auth.me();
    const tid = user?.tenant_id;
    if (!tid) return null;
    const existing = await getAccountMemory();
    const merged = { ...existing, ...patch };
    await base44.entities.Tenant.update(tid, { account_memory: merged });
    return merged;
  } catch {
    return null;
  }
}

// Build the account-memory patch from a confirmed discovery profile + the
// previously-remembered values (so we never wipe fields this business didn't set).
export function profileToAccountMemory(profile, remembered = {}) {
  const patch = {
    preferred_language: profile?.preferred_language || remembered.preferred_language,
    country: profile?.country || remembered.country,
    currency: profile?.currency || remembered.currency,
    timezone: profile?.timezone || remembered.timezone,
    branding_preferences: profile?.suggested_brand_tone || remembered.branding_preferences,
    contact_name: remembered.contact_name,
    contact_email: profile?.existing_info?.email || remembered.contact_email,
    contact_phone: profile?.existing_info?.phone || remembered.contact_phone,
    billing_info: remembered.billing_info,
  };
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  return patch;
}

export const MEMORY_LABELS = {
  preferred_language: 'Language',
  country: 'Country',
  currency: 'Currency',
  timezone: 'Timezone',
  branding_preferences: 'Branding',
  contact_email: 'Contact email',
  contact_phone: 'Contact phone',
};