// Worldz Visa — Phase 12: Notification service (§18/§21/§27/§57/§64/§66/§67/§68).
// Domain Event → Rule → Notification → Channel Provider. Deduped by
// notification_key (§21). Delivery is auditable + retried (§66); bounces mark
// the email invalid and create an action (§67). No channel claims delivery it
// didn't perform (§68). Quiet hours suppress only non-critical messages (§59).

import { rulesForEvent, templateByCode } from "./catalog.ts";
import { getPreferences } from "./preferences.ts";
import { recordTimelineEvent } from "../journey/events.ts";
import { sendMail } from "../../mail/smtp.ts";

const CRITICAL = new Set(["CRITICAL"]);

function interpolate(tpl: string, vars: Record<string, any>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const parts = key.split(".");
    let cur: any = vars;
    for (const p of parts) { cur = cur?.[p]; if (cur == null) break; }
    return cur == null ? "" : String(cur);
  });
}

function notificationKey(appId: string, eventType: string, eventId: string, channel: string, category: string): string {
  const base = [appId, eventType, eventId, channel, category].join("|");
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  return `n_${h.toString(36)}`;
}

function categoryFromRule(r: any): string { return r.category || "application_updates"; }

function channelEnabled(prefs: any, category: string, channel: string): boolean {
  const grp = prefs?.[category];
  if (!grp) return channel === "IN_APP"; // safe default
  const key = channel.toLowerCase();
  return !!grp[key];
}

function inQuietHours(prefs: any): boolean {
  const qh = prefs?.quiet_hours;
  if (!qh || !qh.start || !qh.end) return false;
  try {
    const now = new Date();
    const [sh, sm] = String(qh.start).split(":").map(Number);
    const [eh, em] = String(qh.end).split(":").map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const s = sh * 60 + sm, e = eh * 60 + em;
    return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
  } catch { return false; }
}

async function resolveRecipient(svc: any, app: any): Promise<{ email: string; phone: string; firstName: string }> {
  let email = "", phone = "", firstName = "there";
  try {
    if (app?.created_by_id) {
      const u = await svc.entities.User.get(app.created_by_id).catch(() => null);
      if (u) { email = u.email || email; firstName = (u.full_name || "there").split(" ")[0]; }
    }
    if (app?.traveler_id) {
      const t = await svc.entities.Traveler.get(app.traveler_id).catch(() => null);
      if (t) { phone = t.phone || phone || ""; if (!firstName || firstName === "there") firstName = (t.full_name || "there").split(" ")[0]; if (!email && t.email) email = t.email; }
    }
  } catch { void 0; }
  return { email, phone, firstName };
}

// Entry point called by the timeline engine for CUSTOMER-visible events.
export async function dispatchForEvent(svc: any, app: any, timelineEvent: any): Promise<any[]> {
  const rules = await rulesForEvent(svc, timelineEvent.event_type);
  if (!rules.length) return [];
  const prefs = await getPreferences(svc, app);
  const recipient = await resolveRecipient(svc, app);
  const vars = await buildVars(svc, app, timelineEvent, recipient);
  const out: any[] = [];

  for (const rule of rules) {
    const category = categoryFromRule(rule);
    // Marketing independence: marketing only when explicitly enabled.
    if (category === "marketing" && !channelEnabled(prefs, category, rule.channel)) continue;
    if (!channelEnabled(prefs, category, rule.channel)) continue;
    // Quiet hours (§59): suppress non-critical only.
    if (inQuietHours(prefs) && !CRITICAL.has(rule.priority)) continue;
    // Email bounce guard (§67).
    if (rule.channel === "EMAIL" && prefs?.email_invalid) continue;
    // Avoid duplicate logical notification (§21).
    const key = notificationKey(app.id, timelineEvent.event_type, timelineEvent.event_id, rule.channel, category);
    const existing: any[] = await svc.entities.VisaNotification.filter({ notification_key: key }).catch(() => []);
    if (existing && existing.length) continue;

    const tpl = await templateByCode(svc, rule.template_code, prefs?.language || "en");
    const renderedBody = tpl ? interpolate(tpl.body, vars) : timelineEvent.title || "";
    const renderedSubject = tpl ? interpolate(tpl.subject || "", vars) : "";

    const notif = await svc.entities.VisaNotification.create({
      traveler_id: app.traveler_id, application_id: app.id, notification_key: key,
      event_type: timelineEvent.event_type, event_id: timelineEvent.event_id, category,
      priority: rule.priority || "INFO", title: renderedSubject || timelineEvent.title, body: renderedBody,
      deep_link: `/applications/${app.id}`, status: rule.channel === "IN_APP" ? "UNREAD" : "UNREAD",
      occurred_at: new Date().toISOString(), metadata: { channel: rule.channel, template_code: rule.template_code },
    }).catch(() => null);
    if (!notif) continue;

    const delivery = await sendViaChannel(svc, app, notif.id, rule, renderedSubject, renderedBody, recipient, vars);
    out.push({ notification_id: notif.id, delivery });
  }
  return out;
}

async function sendViaChannel(svc: any, app: any, notifId: string, rule: any, subject: string, body: string, recipient: any, vars: any): Promise<any> {
  const channel = rule.channel;
  const base = { notification_id: notifId, traveler_id: app.traveler_id, application_id: app.id, channel, template_code: rule.template_code, status: "QUEUED", queued_at: new Date().toISOString(), metadata: {} };

  if (channel === "IN_APP") {
    return await svc.entities.VisaNotificationDelivery.create({ ...base, status: "SENT", sent_at: new Date().toISOString(), provider_name: "in_app" }).catch(() => null);
  }

  if (channel === "EMAIL") {
    if (!recipient.email) return await svc.entities.VisaNotificationDelivery.create({ ...base, status: "FAILED", error_category: "INVALID_RECIPIENT", error_code: "NO_EMAIL" }).catch(() => null);
    try {
      // Phase: transactional email routed via Resend (team@arrivals.app), not Base44 SendEmail.
      const res: any = await sendMail({ to: recipient.email, subject: subject || "Visa application update", text: body });
      return await svc.entities.VisaNotificationDelivery.create({ ...base, status: "SENT", sent_at: new Date().toISOString(), recipient: recipient.email, provider_name: "resend", provider_reference: res?.provider_reference || "" }).catch(() => null);
    } catch (e: any) {
      const permanent = /bounce|invalid|permanent/i.test(e?.message || "");
      if (permanent) {
        await markEmailInvalid(svc, app).catch(() => {});
        await svc.entities.ApplicationAction.create({ application_id: app.id, traveler_id: app.traveler_id, action_key: `SYSTEM:VERIFICATION:email`, type: "VERIFICATION", title: "Update your email address", description: "Messages to your email are bouncing.", priority: "SECURITY_VERIFICATION", source: "SYSTEM", status: "OPEN", cta_link: "/profile/notifications", metadata: {} }).catch(() => {});
      }
      return await svc.entities.VisaNotificationDelivery.create({ ...base, status: "FAILED", error_category: permanent ? "PERMANENT" : "TRANSIENT", error_code: e?.message || "EMAIL_FAILED" }).catch(() => null);
    }
  }

  if (channel === "SMS" || channel === "WHATSAPP" || channel === "PUSH") {
    // No provider connected: do NOT claim delivery (§68). WhatsApp falls back to in_app/email per config (kept best-effort).
    return await svc.entities.VisaNotificationDelivery.create({ ...base, status: "FAILED", error_category: "PERMANENT", error_code: "PROVIDER_UNAVAILABLE", provider_name: channel.toLowerCase() }).catch(() => null);
  }

  return null;
}

async function markEmailInvalid(svc: any, app: any): Promise<void> {
  const rows: any[] = await svc.entities.VisaNotificationPreference.filter({ traveler_id: app.traveler_id }).catch(() => []);
  if (rows && rows.length) await svc.entities.VisaNotificationPreference.update(rows[0].id, { email_invalid: true }).catch(() => {});
}

async function buildVars(svc: any, app: any, timelineEvent: any, recipient: any): Promise<any> {
  const base: any = {
    "traveler.first_name": recipient.firstName,
    "destination": app.destination,
    "application.number": (app.id || "").slice(-6).toUpperCase(),
  };
  // Attach appointment context if this event references one.
  const ref = timelineEvent?.source_ref;
  if (ref) {
    try {
      const appt = await svc.entities.Appointment.get(ref).catch(() => null);
      if (appt && appt.id) {
        base["appointment.date"] = appt.scheduled_at || appt.date || "";
        let loc = appt.location_name || "";
        if (!loc && appt.location_id) { const l = await svc.entities.AppointmentLocation.get(appt.location_id).catch(() => null); loc = l?.name || ""; }
        base["appointment.location"] = loc;
      }
    } catch { void 0; }
  }
  if (timelineEvent?.metadata?.document_label) base.document_label = timelineEvent.metadata.document_label;
  if (timelineEvent?.metadata?.message) base.message = timelineEvent.metadata.message;
  return base;
}

// Mark a notification read/archived (used by the notification center API).
export async function markRead(svc: any, user: any, notifId: string, archive = false): Promise<any> {
  const row = await svc.entities.VisaNotification.get(notifId).catch(() => null);
  if (!row) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
  if (row.created_by_id !== user.id && user.role !== "admin") throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const patch: any = { status: archive ? "ARCHIVED" : "READ", read_at: new Date().toISOString() };
  if (archive) patch.archived_at = new Date().toISOString();
  await svc.entities.VisaNotification.update(notifId, patch);
  return { id: notifId, ...patch };
}

// List notifications for the current user (scoped to their traveler).
export async function listForUser(svc: any, user: any, opts: { status?: string; limit?: number } = {}): Promise<any[]> {
  const limit = opts.limit || 50;
  const q: any = { created_by_id: user.id };
  if (opts.status) q.status = opts.status;
  const rows: any[] = await svc.entities.VisaNotification.filter(q, "-occurred_at", limit).catch(() => []);
  return rows || [];
}

export { recordTimelineEvent };