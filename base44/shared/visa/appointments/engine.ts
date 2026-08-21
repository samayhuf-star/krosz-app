// Worldz Visa (Phase 9) — Appointment engine.
//
// Owns appointment state (requirements, locations, slots, booking, reschedule,
// cancel, attendance, passport custody) and the audit trail. Mirrors the Phase 8
// submission boundary: the orchestrator owns lifecycle/recovery, the provider
// owns external interaction, this engine is the visa-domain service the visaApi
// thin layer calls.
//
// Invariants: deterministic requirement derivation (no LLM), deterministic
// provider resolution, idempotent booking, slot revalidation before booking,
// timezone-aware storage, history-preserving reschedule, confirmation docs in
// the existing Document Vault, notifications via the existing dispatch service,
// audit via the existing AuditLog. Payment is OUT OF SCOPE (§43).

import { resolveAppointmentProvider, type ResolvedAppointmentProvider } from "./resolver.ts";
import { appointmentIdempotencyKey, rescheduleIdempotencyKey, categorizeError, type AppointmentType, type RequirementStatus, type AppointmentStatus, type BookResult } from "./types.ts";
import { documentAudit, createDocument } from "../documents.ts";
import { getApplication } from "../application.ts";
import { resolveRequirements } from "../requirements.ts";
import { dispatch } from "../../notifications/dispatch.ts";

async function auditAppt(svc: any, user: any, action: string, appointmentId: string, app: any, detail: any): Promise<void> {
  await documentAudit(svc, user, { action, entity_type: "Appointment", entity_id: appointmentId, application_id: app.id, detail }).catch(() => {});
}

async function notify(svc: any, app: any, title: string, body: string, relatedId?: string): Promise<void> {
  try {
    await dispatch(svc, { userId: app.created_by_id, title, body, channels: ["in_app"], relatedType: "Appointment", relatedId: relatedId || null });
  } catch (e) { console.error("appointment notify failed", e?.message || e); }
}

function setAppStatus(svc: any, app: any, status: string, current_step: string) {
  return svc.entities.VisaApplication.update(app.id, { status, current_step }).catch(() => {});
}

async function appendEvent(svc: any, user: any, appointment: any, eventType: string, oldStatus: string, newStatus: string, extra: any = {}): Promise<void> {
  await svc.entities.AppointmentEvent.create({
    appointment_id: appointment.id, application_id: appointment.application_id, traveler_id: appointment.traveler_id,
    event_type: eventType, old_status: oldStatus, new_status: newStatus,
    actor: (user && (user.full_name || user.email)) || (user && user.id) || "system",
    provider_reference: appointment.provider_reference, external_reference: appointment.external_reference,
    metadata: extra,
  }).catch(() => {});
}

async function buildProviderContext(svc: any, provider: any): Promise<any> {
  const creds: any[] = await svc.entities.ProviderCredential.filter({ provider_id: provider.id }).catch(() => []);
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) for (const name of [c.api_key_secret_name, c.api_secret_secret_name]) if (name) credentials[name] = (c.key_configured || c.secret_configured) ? "(configured)" : undefined;
  return { providerId: provider.id, providerKey: provider.key, category: provider.category, environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials, requestId: crypto.randomUUID() };
}

// ---------- Requirement derivation (§12/§13) ----------
// Deterministic from: pinned visa requirements (biometrics/interview titles) +
// the bound SubmissionRoute.appointment_required flag + provider capability
// availability. No hard-coded country logic; the UI never decides this.
export async function ensureAppointmentRequirements(svc: any, app: any): Promise<any[]> {
  // Bound route tells us whether an appointment channel is even required.
  const routes: any[] = await svc.entities.SubmissionRoute.filter({ destination: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose, status: "active" }).catch(() => []);
  const route = routes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
  const routeRequires = !!route?.appointment_required;

  // Pinned visa requirements: scan the graph for biometrics/interview titles.
  const reqData = await resolveRequirements(svc, app.destination, app.purpose).catch(() => null);
  const reqs: any[] = reqData?.requirements || [];
  const desired: { type: AppointmentType; source: string; source_reference: string }[] = [];
  for (const r of reqs) {
    const t = String(r.title || "").toLowerCase();
    if (/biometric/.test(t)) desired.push({ type: "BIOMETRICS", source: "VISA_REQUIREMENT", source_reference: r.id || "" });
    if (/interview/.test(t)) desired.push({ type: "INTERVIEW", source: "VISA_REQUIREMENT", source_reference: r.id || "" });
  }
  // Route override: if the route requires an appointment but no specific type was
  // found in the requirements graph, default to biometrics (the common VAC case).
  if (routeRequires && !desired.length) desired.push({ type: "BIOMETRICS", source: "SUBMISSION_ROUTE", source_reference: route?.id || "" });
  // Route can also declare additional appointment types via metadata.
  const metaTypes: string[] = (route?.metadata?.appointment_types || []) as string[];
  for (const mt of metaTypes) if (!desired.find((d) => d.type === mt)) desired.push({ type: mt as AppointmentType, source: "SUBMISSION_ROUTE", source_reference: route?.id || "" });

  const existing: any[] = await svc.entities.AppointmentRequirement.filter({ application_id: app.id }).catch(() => []);
  const out: any[] = [];
  for (const d of desired) {
    const e = existing.find((x) => x.type === d.type);
    const status: RequirementStatus = "REQUIRED";
    if (e) {
      const upd: any = { required: true, status: e.status === "COMPLETED" ? "COMPLETED" : status, source: d.source, source_reference: d.source_reference, version: app.requirements_version || null };
      const row = await svc.entities.AppointmentRequirement.update(e.id, upd).catch(() => e);
      out.push(await svc.entities.AppointmentRequirement.get(e.id).catch(() => row));
    } else {
      const row = await svc.entities.AppointmentRequirement.create({ application_id: app.id, traveler_id: app.traveler_id, type: d.type, required: true, status, source: d.source, source_reference: d.source_reference, version: app.requirements_version || null, appointment_id: null, metadata: {} }).catch(() => null);
      if (row) out.push(row);
    }
  }
  // Anything required-but-no-longer-desired becomes NOT_REQUIRED (preserve booked/completed).
  for (const e of existing) {
    if (desired.find((d) => d.type === e.type)) continue;
    if (e.status === "COMPLETED" || e.appointment_id) continue;
    await svc.entities.AppointmentRequirement.update(e.id, { required: false, status: "NOT_REQUIRED" }).catch(() => {});
  }
  return out;
}

export async function listAppointmentRequirements(svc: any, app: any): Promise<any[]> {
  const rows: any[] = await svc.entities.AppointmentRequirement.filter({ application_id: app.id }).catch(() => []);
  return rows.sort((a, b) => a.type.localeCompare(b.type));
}

export async function checkAppointmentReadiness(svc: any, app: any): Promise<{ required: boolean; ready: boolean; blocking_items: { type: string; code: string }[] }> {
  await ensureAppointmentRequirements(svc, app);
  const reqs = await listAppointmentRequirements(svc, app);
  const required = reqs.filter((r) => r.required && r.status === "REQUIRED");
  const blocking: { type: string; code: string }[] = [];
  for (const r of required) {
    const appts: any[] = await svc.entities.Appointment.filter({ appointment_requirement_id: r.id }).catch(() => []);
    const booked = appts.some((a) => ["BOOKED", "COMPLETED"].includes(a.status));
    if (!booked) blocking.push({ type: "APPOINTMENT", code: r.type });
  }
  return { required: required.length > 0, ready: blocking.length === 0, blocking_items: blocking };
}

// ---------- Locations ----------
export async function listLocations(svc: any, user: any, applicationId: string, requirementId: string): Promise<any> {
  const app = await getApplication(svc, user, applicationId);
  const req: any = await svc.entities.AppointmentRequirement.get(requirementId).catch(() => null);
  if (!req || req.application_id !== app.id) throw Object.assign(new Error("Requirement not found"), { code: "NOT_FOUND" });
  const { adapter, provider, provider_id } = await resolveAppointmentProviderForReq(svc, app, req);
  const ctx = await buildProviderContext(svc, provider);
  const res = await adapter.getLocations(ctx, { appointment_type: req.type }).catch((e: any) => ({ success: false, locations: [], error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e) }));
  // Upsert cached locations.
  for (const loc of res.locations || []) {
    const data = { provider_id, external_location_id: loc.external_location_id, name: loc.name, address: loc.address || null, city: loc.city || null, state: loc.state || null, country: loc.country, postal_code: loc.postal_code || null, latitude: loc.latitude || null, longitude: loc.longitude || null, timezone: loc.timezone, appointment_types: loc.appointment_types || [], active: true, metadata: loc.metadata || {} };
    let lr: any = (await svc.entities.AppointmentLocation.filter({ provider_id, external_location_id: loc.external_location_id }).catch(() => []))[0];
    if (!lr) lr = await svc.entities.AppointmentLocation.create(data).catch(() => null);
    else lr = await svc.entities.AppointmentLocation.update(lr.id, data).catch(() => lr);
  }
  return { provider_id, locations: res.locations || [], error: res.error_code ? { code: res.error_code, message: res.error_message } : null };
}

// ---------- Slots (§15/§16) ----------
export async function findSlots(svc: any, user: any, opts: { application_id: string; requirement_id: string; external_location_id: string; date_from?: string; date_to?: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id);
  const req: any = await svc.entities.AppointmentRequirement.get(opts.requirement_id).catch(() => null);
  if (!req || req.application_id !== app.id) throw Object.assign(new Error("Requirement not found"), { code: "NOT_FOUND" });
  const { adapter, provider, provider_id } = await resolveAppointmentProviderForReq(svc, app, req);
  const loc: any = (await svc.entities.AppointmentLocation.filter({ provider_id, external_location_id: opts.external_location_id }).catch(() => []))[0];
  if (!loc) throw Object.assign(new Error("Location not found for this provider"), { code: "INVALID_LOCATION" });
  if (loc.appointment_types && loc.appointment_types.length && !loc.appointment_types.includes(req.type)) throw Object.assign(new Error("Location does not support this appointment type"), { code: "INVALID_LOCATION" });
  const ctx = await buildProviderContext(svc, provider);
  const res = await adapter.getSlots(ctx, { location_id: loc.id, external_location_id: loc.external_location_id, appointment_type: req.type, date_from: opts.date_from, date_to: opts.date_to }).catch((e: any) => ({ success: false, slots: [], error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e) }));
  const slots: any[] = [];
  for (const s of res.slots || []) {
    const data = { provider_id, location_id: loc.id, external_slot_id: s.external_slot_id, appointment_type: req.type, start_at_utc: s.start_at_utc, end_at_utc: s.end_at_utc, duration_minutes: s.duration_minutes || 30, location_timezone: s.location_timezone || loc.timezone, availability_status: s.availability_status || "AVAILABLE", expires_at: s.expires_at || null, provider_reference: s.provider_reference || null, metadata: {} };
    let sr: any = (await svc.entities.AppointmentSlot.filter({ provider_id, external_slot_id: s.external_slot_id }).catch(() => []))[0];
    if (!sr) sr = await svc.entities.AppointmentSlot.create(data).catch(() => null);
    else sr = await svc.entities.AppointmentSlot.update(sr.id, data).catch(() => sr);
    if (sr) slots.push(sr);
  }
  return { slots, expires_at: res.expires_at || null, error: res.error_code ? { code: res.error_code, message: res.error_message } : null };
}

// ---------- Slot hold (§17) ----------
export async function holdSlot(svc: any, user: any, opts: { application_id: string; slot_id: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id);
  const slot: any = await svc.entities.AppointmentSlot.get(opts.slot_id).catch(() => null);
  if (!slot) throw Object.assign(new Error("Slot not found"), { code: "NOT_FOUND" });
  const provider: any = await svc.entities.Provider.get(slot.provider_id).catch(() => null);
  const req: any = await svc.entities.AppointmentRequirement.filter({ application_id: app.id, type: slot.appointment_type }).catch(() => []);
  const requirement = req[0];
  const { adapter } = await resolveAppointmentProviderForReq(svc, app, requirement);
  if (!adapter.holdSlot) return { held: false, reason: "HOLD_NOT_SUPPORTED", slot };
  const ctx = await buildProviderContext(svc, provider);
  const res = await adapter.holdSlot(ctx, { external_slot_id: slot.external_slot_id }).catch((e: any) => ({ success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e) }));
  if (res.success) await svc.entities.AppointmentSlot.update(slot.id, { availability_status: "HELD", provider_reference: res.provider_reference || null, expires_at: res.expires_at || slot.expires_at }).catch(() => {});
  return { held: res.success, provider_reference: res.provider_reference, expires_at: res.expires_at, error: res.success ? null : { code: res.error_code, message: res.error_message } };
}

// ---------- Booking (§18/§19/§20) ----------
export async function bookAppointment(svc: any, user: any, opts: { application_id: string; requirement_id: string; slot_id: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id);
  const req: any = await svc.entities.AppointmentRequirement.get(opts.requirement_id).catch(() => null);
  if (!req || req.application_id !== app.id) throw Object.assign(new Error("Requirement not found"), { code: "NOT_FOUND" });

  // Revalidate the slot before booking (§16).
  const slot: any = await svc.entities.AppointmentSlot.get(opts.slot_id).catch(() => null);
  if (!slot) throw Object.assign(new Error("Slot not found"), { code: "NOT_FOUND" });
  if (slot.availability_status === "BOOKED") throw Object.assign(new Error("Slot already booked"), { code: "SLOT_UNAVAILABLE" });
  if (slot.expires_at && new Date(slot.expires_at).getTime() < Date.now()) throw Object.assign(new Error("Slot expired"), { code: "SLOT_EXPIRED" });

  const { adapter, provider, provider_id, provider_key, provider_type, channel, environment, supports } = await resolveAppointmentProviderForReq(svc, app, req);
  if (!supports("APPOINTMENT_BOOK")) throw Object.assign(new Error("Provider does not support booking"), { code: "NO_BOOK_CAPABILITY" });

  const idempotency_key = appointmentIdempotencyKey(app.id, req.id, slot.id);
  // Idempotency: existing non-terminal appointment by key → return it.
  const existing: any[] = await svc.entities.Appointment.filter({ idempotency_key }).catch(() => []);
  const live = existing.find((a) => !["CANCELLED", "FAILED"].includes(a.status)) || existing[0];
  if (live) return { appointment: live, idempotent: true };

  const loc: any = await svc.entities.AppointmentLocation.get(slot.location_id).catch(() => null);
  const bookReq = {
    application_id: app.id, appointment_requirement_id: req.id, slot_id: slot.id, external_slot_id: slot.external_slot_id,
    location_id: loc?.id, external_location_id: loc?.external_location_id, appointment_type: req.type,
    scheduled_at_utc: slot.start_at_utc, duration_minutes: slot.duration_minutes || 30, location_timezone: slot.location_timezone || loc?.timezone || "UTC",
    idempotency_key, environment, traveler: undefined,
  };
  const ctx = await buildProviderContext(svc, provider);
  let result: BookResult;
  try { result = await adapter.book(ctx, bookReq); }
  catch (e: any) { result = { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT", retryable: true }; }

  if (!result.success) {
    const status: AppointmentStatus = "FAILED";
    const row = await svc.entities.Appointment.create({
      application_id: app.id, traveler_id: app.traveler_id, appointment_requirement_id: req.id, provider_id, provider_key, provider_type,
      location_id: slot.location_id, slot_id: slot.id, external_slot_id: slot.external_slot_id, appointment_type: req.type,
      status, last_status: "BOOKING", scheduled_at_utc: slot.start_at_utc, duration_minutes: slot.duration_minutes || 30,
      location_timezone: slot.location_timezone || loc?.timezone || "UTC",
      external_reference: null, provider_reference: null, confirmation_document_id: null, confirmation_document_version_id: null,
      idempotency_key, rescheduled_from: null, error_code: result.error_code || "BOOK_FAILED",
      error_category: result.error_category || categorizeError(result.error_code, result.retryable), booked_at: null, completed_at: null, metadata: {},
    }).catch(() => null);
    if (row) await appendEvent(svc, user, row, "FAILED", "BOOKING", status, { error_code: result.error_code });
    await auditAppt(svc, user, "appointment.failed", row?.id || "(pending)", app, { requirement_id: req.id, error_code: result.error_code, error_category: result.error_category });
    throw Object.assign(new Error(result.error_message || "Booking failed"), { code: result.error_code || "BOOK_FAILED", error_category: result.error_category || categorizeError(result.error_code, result.retryable) });
  }

  const row = await svc.entities.Appointment.create({
    application_id: app.id, traveler_id: app.traveler_id, appointment_requirement_id: req.id, provider_id, provider_key, provider_type,
    location_id: slot.location_id, slot_id: slot.id, external_slot_id: slot.external_slot_id, appointment_type: req.type,
    status: "BOOKED", scheduled_at_utc: result.scheduled_at_utc || slot.start_at_utc, duration_minutes: result.duration_minutes || slot.duration_minutes || 30,
    location_timezone: slot.location_timezone || loc?.timezone || "UTC",
    external_reference: result.external_reference || null, provider_reference: result.provider_reference || null,
    confirmation_document_id: null, confirmation_document_version_id: null, idempotency_key, rescheduled_from: null,
    last_status: "BOOKED", error_code: null, error_category: null, booked_at: new Date().toISOString(), completed_at: null, metadata: result.response_metadata || {},
  });
  await appendEvent(svc, user, row, "BOOKED", "BOOKING", "BOOKED", { external_reference: result.external_reference });
  await svc.entities.AppointmentSlot.update(slot.id, { availability_status: "BOOKED" }).catch(() => {});
  await svc.entities.AppointmentRequirement.update(req.id, { appointment_id: row.id }).catch(() => {});

  // Confirmation in the Document Vault (§21/§49), never a second storage system.
  if (result.confirmation_payload) {
    try {
      const cp = result.confirmation_payload;
      const { document, version } = await createDocument(svc, user, {
        traveler_id: app.traveler_id, document_type: "APPOINTMENT_CONFIRMATION",
        display_name: cp.display_name || `Appointment confirmation ${result.external_reference || row.id.slice(-6)}`,
        storage_uri: cp.storage_uri, mime_type: cp.mime_type, file_size: cp.file_size,
      });
      await svc.entities.Appointment.update(row.id, { confirmation_document_id: document.id, confirmation_document_version_id: version.id }).catch(() => {});
    } catch (e) { console.error("appointment confirmation store failed", e?.message || e); }
  }

  await auditAppt(svc, user, "appointment.booked", row.id, app, { provider_id, requirement_type: req.type, external_reference: result.external_reference, scheduled_at_utc: row.scheduled_at_utc });
  await notify(svc, app, "Appointment booked", `Your ${req.type.toLowerCase()} appointment is booked for ${new Date(row.scheduled_at_utc).toUTCString()}.`, row.id);
  await setAppStatus(svc, app, "appointment_booked", "appointment");
  return { appointment: await svc.entities.Appointment.get(row.id), idempotent: false };
}

// ---------- Status ----------
export async function getAppointmentStatus(svc: any, user: any, appointmentId: string): Promise<any> {
  const appt: any = await svc.entities.Appointment.get(appointmentId).catch(() => null);
  if (!appt) throw Object.assign(new Error("Appointment not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, appt.application_id);
  const provider: any = await svc.entities.Provider.get(appt.provider_id).catch(() => null);
  if (!provider) return { appointment: appt };
  const { getAppointmentAdapter } = await import("./registry.ts");
  const adapter = getAppointmentAdapter(provider.adapter_key);
  if (!adapter.getStatus) return { appointment: appt };
  const ctx = await buildProviderContext(svc, provider);
  const res = await adapter.getStatus(ctx, { external_reference: appt.external_reference }).catch(() => ({ success: true }));
  if (res.status && res.status !== appt.status) {
    await appendEvent(svc, user, appt, res.status, appt.status, res.status, { provider_status: res.status });
    await svc.entities.Appointment.update(appt.id, { status: res.status, last_status: appt.status }).catch(() => {});
  }
  return { appointment: await svc.entities.Appointment.get(appt.id), provider_status: res.status };
}

// ---------- Reschedule (§24/§48) ----------
export async function rescheduleAppointment(svc: any, user: any, opts: { appointment_id: string; new_slot_id: string }): Promise<any> {
  const appt: any = await svc.entities.Appointment.get(opts.appointment_id).catch(() => null);
  if (!appt) throw Object.assign(new Error("Appointment not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, appt.application_id);
  if (["COMPLETED", "CANCELLED"].includes(appt.status)) throw Object.assign(new Error("Cannot reschedule terminal appointment"), { code: "TERMINAL" });
  const newSlot: any = await svc.entities.AppointmentSlot.get(opts.new_slot_id).catch(() => null);
  if (!newSlot) throw Object.assign(new Error("New slot not found"), { code: "NOT_FOUND" });
  if (newSlot.availability_status === "BOOKED") throw Object.assign(new Error("Slot already booked"), { code: "SLOT_UNAVAILABLE" });
  if (newSlot.expires_at && new Date(newSlot.expires_at).getTime() < Date.now()) throw Object.assign(new Error("Slot expired"), { code: "SLOT_EXPIRED" });

  const provider: any = await svc.entities.Provider.get(appt.provider_id).catch(() => null);
  const { getAppointmentAdapter } = await import("./registry.ts");
  const adapter = getAppointmentAdapter(provider.adapter_key);
  const ctx = await buildProviderContext(svc, provider);
  const idem = rescheduleIdempotencyKey(appt.id, newSlot.id);
  let result: BookResult;
  if (adapter.reschedule && adapter.capabilities.includes("APPOINTMENT_RESCHEDULE")) {
    result = await adapter.reschedule(ctx, { appointment_id: appt.id, external_reference: appt.external_reference, new_external_slot_id: newSlot.external_slot_id, new_scheduled_at_utc: newSlot.start_at_utc, idempotency_key: idem }).catch((e: any) => ({ success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT", retryable: true }));
  } else {
    // Fallback: cancel old + book new against the same provider.
    if (adapter.cancel) await adapter.cancel(ctx, { external_reference: appt.external_reference, appointment_id: appt.id }).catch(() => {});
    result = await adapter.book(ctx, {
      application_id: appt.application_id, appointment_requirement_id: appt.appointment_requirement_id, slot_id: newSlot.id, external_slot_id: newSlot.external_slot_id,
      location_id: newSlot.location_id, external_location_id: newSlot.external_slot_id, appointment_type: appt.appointment_type,
      scheduled_at_utc: newSlot.start_at_utc, duration_minutes: newSlot.duration_minutes || 30, location_timezone: newSlot.location_timezone, idempotency_key: idem, environment: appt.environment,
    }).catch((e: any) => ({ success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: String(e?.message || e), error_category: "TRANSIENT", retryable: true }));
  }
  if (!result.success) {
    await svc.entities.Appointment.update(appt.id, { status: "RESCHEDULE_REQUIRED", error_code: result.error_code, error_category: result.error_category || categorizeError(result.error_code, result.retryable) }).catch(() => {});
    await appendEvent(svc, user, appt, "FAILED", appt.status, "RESCHEDULE_REQUIRED", { error_code: result.error_code });
    throw Object.assign(new Error(result.error_message || "Reschedule failed"), { code: result.error_code || "RESCHEDULE_FAILED" });
  }
  // Create a NEW appointment row; the old one is recorded as rescheduled_from.
  const newRow = await svc.entities.Appointment.create({
    application_id: appt.application_id, traveler_id: appt.traveler_id, appointment_requirement_id: appt.appointment_requirement_id, provider_id: appt.provider_id, provider_key: appt.provider_key, provider_type: appt.provider_type,
    location_id: newSlot.location_id, slot_id: newSlot.id, external_slot_id: newSlot.external_slot_id, appointment_type: appt.appointment_type,
    status: "BOOKED", scheduled_at_utc: result.scheduled_at_utc || newSlot.start_at_utc, duration_minutes: result.duration_minutes || newSlot.duration_minutes || 30,
    location_timezone: newSlot.location_timezone, external_reference: result.external_reference || appt.external_reference, provider_reference: result.provider_reference || null,
    confirmation_document_id: null, confirmation_document_version_id: null, idempotency_key: idem, rescheduled_from: appt.id,
    last_status: "BOOKED", booked_at: new Date().toISOString(), metadata: result.response_metadata || {},
  }).catch(() => null);
  if (!newRow) throw Object.assign(new Error("Could not create rescheduled appointment"), { code: "RESCHEDULE_FAILED" });
  await svc.entities.Appointment.update(appt.id, { status: "CANCELLED", last_status: "RESCHEDULED" }).catch(() => {});
  await svc.entities.AppointmentSlot.update(newSlot.id, { availability_status: "BOOKED" }).catch(() => {});
  await svc.entities.AppointmentRequirement.update(appt.appointment_requirement_id, { appointment_id: newRow.id }).catch(() => {});
  await appendEvent(svc, user, newRow, "RESCHEDULED", "BOOKED", "BOOKED", { old_appointment_id: appt.id, old_external_reference: appt.external_reference });
  await appendEvent(svc, user, appt, "CANCELLED", appt.status, "CANCELLED", { rescheduled_to: newRow.id });
  if (result.confirmation_payload) {
    try {
      const cp = result.confirmation_payload;
      const { document, version } = await createDocument(svc, user, { traveler_id: app.traveler_id, document_type: "APPOINTMENT_CONFIRMATION", display_name: cp.display_name || `Appointment confirmation ${result.external_reference}`, storage_uri: cp.storage_uri, mime_type: cp.mime_type, file_size: cp.file_size });
      await svc.entities.Appointment.update(newRow.id, { confirmation_document_id: document.id, confirmation_document_version_id: version.id }).catch(() => {});
    } catch (e) { console.error("reschedule confirmation failed", e?.message || e); }
  }
  await auditAppt(svc, user, "appointment.rescheduled", newRow.id, app, { old_appointment_id: appt.id, new_scheduled_at_utc: newRow.scheduled_at_utc, external_reference: newRow.external_reference });
  await notify(svc, app, "Appointment rescheduled", `Your appointment was rescheduled to ${new Date(newRow.scheduled_at_utc).toUTCString()}.`, newRow.id);
  return { appointment: newRow, old_appointment: appt };
}

// ---------- Cancel ----------
export async function cancelAppointment(svc: any, user: any, appointmentId: string): Promise<any> {
  const appt: any = await svc.entities.Appointment.get(appointmentId).catch(() => null);
  if (!appt) throw Object.assign(new Error("Appointment not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, appt.application_id);
  if (["COMPLETED", "CANCELLED"].includes(appt.status)) throw Object.assign(new Error("Cannot cancel terminal appointment"), { code: "TERMINAL" });
  const provider: any = await svc.entities.Provider.get(appt.provider_id).catch(() => null);
  if (provider) {
    const { getAppointmentAdapter } = await import("./registry.ts");
    const adapter = getAppointmentAdapter(provider.adapter_key);
    if (adapter.cancel && adapter.capabilities.includes("APPOINTMENT_CANCEL")) {
      const ctx = await buildProviderContext(svc, provider);
      await adapter.cancel(ctx, { external_reference: appt.external_reference, appointment_id: appt.id }).catch(() => {});
    }
  }
  await svc.entities.Appointment.update(appt.id, { status: "CANCELLED", last_status: "CANCELLED" }).catch(() => {});
  await appendEvent(svc, user, appt, "CANCELLED", appt.status, "CANCELLED", {});
  await auditAppt(svc, user, "appointment.cancelled", appt.id, app, { external_reference: appt.external_reference });
  await notify(svc, app, "Appointment cancelled", `Your ${appt.appointment_type.toLowerCase()} appointment was cancelled.`, appt.id);
  return { appointment: await svc.entities.Appointment.get(appt.id) };
}

// ---------- Attendance confirmation (§39) ----------
export async function confirmAttendance(svc: any, user: any, appointmentId: string, outcome: "COMPLETED" | "NO_SHOW" | "ISSUE"): Promise<any> {
  const appt: any = await svc.entities.Appointment.get(appointmentId).catch(() => null);
  if (!appt) throw Object.assign(new Error("Appointment not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, appt.application_id);
  const statusMap: Record<string, AppointmentStatus> = { COMPLETED: "COMPLETED", NO_SHOW: "NO_SHOW", ISSUE: "RESCHEDULE_REQUIRED" };
  const newStatus = statusMap[outcome];
  await svc.entities.Appointment.update(appt.id, { status: newStatus, last_status: appt.status, completed_at: outcome === "COMPLETED" ? new Date().toISOString() : null }).catch(() => {});
  await appendEvent(svc, user, appt, outcome === "NO_SHOW" ? "NO_SHOW" : "COMPLETED", appt.status, newStatus, { outcome });
  if (outcome === "COMPLETED") {
    if (appt.appointment_type === "BIOMETRICS") await svc.entities.BiometricsEvent.create({ appointment_id: appt.id, application_id: appt.application_id, traveler_id: appt.traveler_id, status: "COMPLETED", completed_at: new Date().toISOString(), provider_reference: appt.external_reference, metadata: {} }).catch(() => {});
    if (appt.appointment_type === "INTERVIEW") await svc.entities.InterviewEvent.create({ appointment_id: appt.id, application_id: appt.application_id, traveler_id: appt.traveler_id, status: "COMPLETED", completed_at: new Date().toISOString(), outcome: outcome, notes_reference: null, metadata: {} }).catch(() => {});
    await svc.entities.AppointmentRequirement.update(appt.appointment_requirement_id, { status: "COMPLETED" }).catch(() => {});
    await auditAppt(svc, user, "appointment.completed", appt.id, app, { appointment_type: appt.appointment_type });
  } else if (outcome === "NO_SHOW") {
    await auditAppt(svc, user, "appointment.no_show", appt.id, app, { appointment_type: appt.appointment_type });
    // §26: do not auto-reschedule; surface an operator resolution task via audit.
  }
  await notify(svc, app, outcome === "COMPLETED" ? "Appointment completed" : "Appointment needs attention", `Your ${appt.appointment_type.toLowerCase()} appointment: ${outcome.replace("_", " ").toLowerCase()}.`, appt.id);
  await setAppStatus(svc, app, outcome === "COMPLETED" ? "government_processing" : "additional_documents", "review");
  return { appointment: await svc.entities.Appointment.get(appt.id) };
}

// ---------- Passport custody (§29) ----------
export async function submitPassport(svc: any, user: any, opts: { application_id: string; location?: string; external_reference?: string; appointment_id?: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id);
  const row = await svc.entities.PassportCustodyEvent.create({ application_id: app.id, traveler_id: app.traveler_id, appointment_id: opts.appointment_id || null, submission_id: null, status: "SUBMITTED", location: opts.location || null, timestamp: new Date().toISOString(), external_reference: opts.external_reference || null, actor: (user && (user.full_name || user.email)) || (user && user.id) || "system", metadata: {} });
  await auditAppt(svc, user, "passport.submitted", row.id, app, { location: opts.location, external_reference: opts.external_reference });
  await notify(svc, app, "Passport submitted", `Your passport was submitted at ${opts.location || "the center"}.`, row.id);
  return { custody: row };
}
export async function returnPassport(svc: any, user: any, opts: { application_id: string; location?: string; external_reference?: string }): Promise<any> {
  const app = await getApplication(svc, user, opts.application_id);
  const row = await svc.entities.PassportCustodyEvent.create({ application_id: app.id, traveler_id: app.traveler_id, appointment_id: null, submission_id: null, status: "RETURNED", location: opts.location || null, timestamp: new Date().toISOString(), external_reference: opts.external_reference || null, actor: (user && (user.full_name || user.email)) || (user && user.id) || "system", metadata: {} });
  await auditAppt(svc, user, "passport.returned", row.id, app, { location: opts.location });
  await notify(svc, app, "Passport returned", `Your passport was returned.`, row.id);
  await setAppStatus(svc, app, "completed", "decision");
  return { custody: row };
}
export async function listPassportCustody(svc: any, user: any, applicationId: string): Promise<any[]> {
  const app = await getApplication(svc, user, applicationId);
  const rows: any[] = await svc.entities.PassportCustodyEvent.filter({ application_id: app.id }).catch(() => []);
  return rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
}

// ---------- Attach confirmation (manual upload, §21) ----------
export async function attachConfirmation(svc: any, user: any, appointmentId: string, opts: { storage_uri: string; mime_type: string; file_size: number; display_name?: string }): Promise<any> {
  const appt: any = await svc.entities.Appointment.get(appointmentId).catch(() => null);
  if (!appt) throw Object.assign(new Error("Appointment not found"), { code: "NOT_FOUND" });
  const app = await getApplication(svc, user, appt.application_id);
  const { document, version } = await createDocument(svc, user, { traveler_id: app.traveler_id, document_type: "APPOINTMENT_CONFIRMATION", display_name: opts.display_name || `Appointment confirmation ${appt.external_reference || appt.id.slice(-6)}`, storage_uri: opts.storage_uri, mime_type: opts.mime_type, file_size: opts.file_size });
  await svc.entities.Appointment.update(appt.id, { confirmation_document_id: document.id, confirmation_document_version_id: version.id, status: appt.status === "AVAILABLE" ? "BOOKED" : appt.status }).catch(() => {});
  await auditAppt(svc, user, "appointment.confirmation_uploaded", appt.id, app, { document_id: document.id });
  return { appointment: await svc.entities.Appointment.get(appt.id), document_id: document.id };
}

// ---------- Listing ----------
export async function listAppointments(svc: any, user: any, applicationId: string): Promise<any> {
  const app = await getApplication(svc, user, applicationId);
  const rows: any[] = await svc.entities.Appointment.filter({ application_id: app.id }).catch(() => []);
  rows.sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  const events: any[] = await svc.entities.AppointmentEvent.filter({ application_id: app.id }).catch(() => []);
  events.sort((a, b) => String(a.created_date || "").localeCompare(String(b.created_date || "")));
  return { appointments: rows, events };
}

export async function listAllAppointments(svc: any, user: any, filter?: { status?: string; from?: string; to?: string }): Promise<any[]> {
  // Ops view: admin sees all; non-admin sees only their own.
  let rows: any[];
  if (user?.role === "admin") rows = await svc.entities.Appointment.filter(filter?.status ? { status: filter.status } : {}).catch(() => []);
  else rows = await svc.entities.Appointment.filter({ traveler_id: undefined } && {}).catch(() => []);
  // Restrict non-admin to their own applications.
  if (user?.role !== "admin") {
    const apps: any[] = await svc.entities.VisaApplication.filter({ created_by_id: user.id }).catch(() => []);
    const ids = new Set(apps.map((a) => a.id));
    rows = rows.filter((r) => ids.has(r.application_id));
  }
  if (filter?.from) rows = rows.filter((r) => r.scheduled_at_utc && r.scheduled_at_utc >= filter.from);
  if (filter?.to) rows = rows.filter((r) => r.scheduled_at_utc && r.scheduled_at_utc <= filter.to);
  return rows.sort((a, b) => String(a.scheduled_at_utc || "").localeCompare(String(b.scheduled_at_utc || "")));
}

// ---------- Internal ----------
async function resolveAppointmentProviderForReq(svc: any, app: any, req: any): Promise<ResolvedAppointmentProvider> {
  const routes: any[] = await svc.entities.SubmissionRoute.filter({ destination: app.destination, visa_type_key: app.visa_type_key, purpose: app.purpose, status: "active" }).catch(() => []);
  const route = routes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
  const preferred = route?.metadata?.appointment_provider || (route as any)?.appointment_provider_id;
  return resolveAppointmentProvider(svc, app, { type: req.type, required: req.required }, { preferred_provider_id: preferred });
}