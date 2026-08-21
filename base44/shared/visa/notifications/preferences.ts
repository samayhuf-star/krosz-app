// Worldz Visa — Phase 12: Notification preferences (§19/§69).
// Per-traveler upsert; marketing independent from operational. Defaults: all
// operational channels ON, marketing OFF. Quiet hours optional (§59); CRITICAL
// and security/OTP always bypass quiet hours.

const DEFAULT_CHANNELS = { in_app: true, email: true, sms: false, whatsapp: false, push: false };

function defaultPrefs() {
  return {
    application_updates: { ...DEFAULT_CHANNELS },
    appointment_reminders: { ...DEFAULT_CHANNELS },
    payment_updates: { ...DEFAULT_CHANNELS },
    document_updates: { ...DEFAULT_CHANNELS },
    support_messages: { in_app: true, email: true, sms: false, whatsapp: false, push: false },
    marketing: { in_app: false, email: false, sms: false, whatsapp: false, push: false },
    quiet_hours: null,
    language: "en",
    email_invalid: false,
    metadata: {},
  };
}

export async function getPreferences(svc: any, app: any): Promise<any> {
  const rows: any[] = await svc.entities.VisaNotificationPreference.filter({ traveler_id: app.traveler_id }).catch(() => []);
  if (rows && rows.length) return { id: rows[0].id, ...rows[0] };
  return await ensurePreferences(svc, app);
}

// Also used by profile page (no app context) — pass traveler_id + user.
export async function ensurePreferencesForTraveler(svc: any, travelerId: string): Promise<any> {
  const rows: any[] = await svc.entities.VisaNotificationPreference.filter({ traveler_id: travelerId }).catch(() => []);
  if (rows && rows.length) return { id: rows[0].id, ...rows[0] };
  const created = await svc.entities.VisaNotificationPreference.create({ traveler_id: travelerId, ...defaultPrefs() }).catch(() => null);
  return created ? { id: created.id, ...created } : defaultPrefs();
}

async function ensurePreferences(svc: any, app: any): Promise<any> {
  const created = await svc.entities.VisaNotificationPreference.create({ traveler_id: app.traveler_id, ...defaultPrefs() }).catch(() => null);
  return created ? { id: created.id, ...created } : defaultPrefs();
}

export async function updatePreferences(svc: any, app: any, patch: any): Promise<any> {
  const cur = await getPreferences(svc, app);
  if (cur.id) {
    const merged = { ...stripEnvelope(cur), ...sanitisePatch(patch) };
    await svc.entities.VisaNotificationPreference.update(cur.id, merged).catch(() => {});
    return { id: cur.id, ...merged };
  }
  const created = await svc.entities.VisaNotificationPreference.create({ traveler_id: app.traveler_id, ...sanitisePatch(patch), ...defaultPrefs() }).catch(() => null);
  return created ? { id: created.id, ...created } : defaultPrefs();
}

function stripEnvelope(row: any): any {
  const { id, created_date, updated_date, created_by_id, ...rest } = row;
  void id; void created_date; void updated_date; void created_by_id;
  return rest;
}

function sanitisePatch(patch: any): any {
  const out: any = {};
  for (const cat of ["application_updates", "appointment_reminders", "payment_updates", "document_updates", "support_messages", "marketing"]) {
    if (patch[cat] && typeof patch[cat] === "object") {
      out[cat] = { in_app: !!patch[cat].in_app, email: !!patch[cat].email, sms: !!patch[cat].sms, whatsapp: !!patch[cat].whatsapp, push: !!patch[cat].push };
    }
  }
  if (patch.quiet_hours !== undefined) out.quiet_hours = patch.quiet_hours;
  if (patch.language) out.language = String(patch.language);
  return out;
}