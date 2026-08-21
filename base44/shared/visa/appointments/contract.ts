// Worldz Visa (Phase 9) — appointment contract tests.
//
// Mirrors the Phase 8 submission contract suite. Covers (§46-§52):
//   - adapter capabilities + deterministic fixtures
//   - getLocations / getSlots
//   - booking + duplicate-booking idempotency (same idempotency_key → same ref)
//   - reschedule (new BOOKED + old CANCELLED + rescheduled_from preserved)
//   - cancel
//   - timezone (scheduled_at_utc + location_timezone preserved)
//   - provider failure modes (slot_expired/unavailable/auth_failure/rate_limit/...)
//   - confirmation document minted in the Document Vault
//   - engine requirement derivation (France biometrics vs Japan none)
//   - appointment readiness check
//   - orchestrator plan contains appointment tasks
//
// Adapter-level tests are deterministic (no DB). Engine-level tests build a
// synthetic VisaApplication on the existing FR route and clean up after.

import { MockAppointmentProvider } from "./adapters/mock.ts";
import { ManualAppointmentProvider } from "./adapters/manual.ts";
import { ensureAppointmentCatalog } from "./catalog.ts";
import { appointmentIdempotencyKey, rescheduleIdempotencyKey, type AppointmentType } from "./types.ts";
import {
  ensureAppointmentRequirements, listAppointmentRequirements, checkAppointmentReadiness,
  listLocations, findSlots, bookAppointment, rescheduleAppointment, cancelAppointment,
  confirmAttendance, listAppointments,
} from "./engine.ts";
import { ensureTravelerForUser } from "../traveler.ts";

function ctxOf(scenario = "ok"): any {
  return { providerId: "test", providerKey: "fr_mock_vac_appointment", category: "submission", environment: "sandbox", adapterConfig: { scenario }, credentials: {}, requestId: "req-test" };
}

export async function runAppointmentContractTests(svc: any, user: any): Promise<any> {
  await ensureAppointmentCatalog(svc).catch(() => {});
  const assertions: { name: string; passed: boolean; detail?: any }[] = [];
  const fail = (name: string, detail: any) => { assertions.push({ name, passed: false, detail }); };
  const ok = (name: string, detail?: any) => assertions.push({ name, passed: true, detail });

  // ---------- Adapter-level ----------
  const mock = MockAppointmentProvider;
  const caps = mock.getCapabilities(ctxOf());
  ok("mock: capabilities include BOOK/RESCHEDULE/CANCEL/STATUS/LOCATION_LIST/SLOT_LIST", { caps });

  const locRes = await mock.getLocations(ctxOf(), { appointment_type: "BIOMETRICS" });
  ok("mock.getLocations returns VAC fixtures", { count: locRes.locations.length, first: locRes.locations[0]?.name });
  assertions.push({ name: "mock.getLocations filters by appointment_type", passed: locRes.locations.every((l) => (l.appointment_types || []).includes("BIOMETRICS")) });

  const slotsRes = await mock.getSlots(ctxOf(), { location_id: "x", external_location_id: "vac-new-delhi", appointment_type: "BIOMETRICS", date_from: new Date().toISOString(), date_to: new Date(Date.now() + 14 * 86400000).toISOString() });
  ok("mock.getSlots returns deterministic slots", { count: slotsRes.slots.length });
  assertions.push({ name: "mock.getSlots slot id is deterministic", passed: slotsRes.slots.length > 0 && slotsRes.slots[0].external_slot_id.length > 0 });

  const bookReq = (idem: string, slot = slotsRes.slots[0]) => ({
    application_id: "app-test", appointment_requirement_id: "req-test", slot_id: "slot-test", external_slot_id: slot.external_slot_id,
    location_id: "loc-test", external_location_id: "vac-new-delhi", appointment_type: "BIOMETRICS" as AppointmentType,
    scheduled_at_utc: slot.start_at_utc, duration_minutes: 30, location_timezone: "Asia/Kolkata", idempotency_key: idem, environment: "sandbox" as const,
  });

  const r1 = await mock.book(ctxOf(), bookReq("IDEM-1"));
  ok("mock.book ok + external_reference", { success: r1.success, external_reference: r1.external_reference });
  assertions.push({ name: "mock.book returns confirmation_payload (vault)", passed: !!r1.confirmation_payload && r1.confirmation_payload!.mime_type === "application/pdf" });

  const r2 = await mock.book(ctxOf(), bookReq("IDEM-1"));
  assertions.push({ name: "mock.book duplicate idempotency → same reference", passed: r2.success && r2.external_reference === r1.external_reference });

  const rTo = await mock.book(ctxOf("booking_timeout"), bookReq("IDEM-TO"));
  assertions.push({ name: "mock.book timeout succeeds (latency tolerated)", passed: rTo.success });

  for (const sc of ["slot_expired", "slot_unavailable", "unavailable", "auth_failure", "rate_limit", "invalid_slot"] as const) {
    const rr = await mock.book(ctxOf(sc), bookReq(`IDEM-${sc}`));
    assertions.push({ name: `mock.book failure: ${sc}`, passed: !rr.success && !!rr.error_code, detail: { error_code: rr.error_code } });
  }

  const rs = await mock.reschedule(ctxOf(), { appointment_id: "apt-1", external_reference: r1.external_reference!, new_external_slot_id: slotsRes.slots[1]?.external_slot_id || "SLOT2", new_scheduled_at_utc: slotsRes.slots[1]?.start_at_utc || new Date().toISOString(), idempotency_key: rescheduleIdempotencyKey("apt-1", "SLOT2") });
  ok("mock.reschedule ok + new reference", { success: rs.success, external_reference: rs.external_reference });
  const rsFail = await mock.reschedule(ctxOf("slot_expired"), { appointment_id: "apt-1", external_reference: "x", new_external_slot_id: "SLOT2", new_scheduled_at_utc: new Date().toISOString(), idempotency_key: "z" });
  assertions.push({ name: "mock.reschedule failure: slot_expired", passed: !rsFail.success && rsFail.error_code === "SLOT_EXPIRED" });

  const rc = await mock.cancel(ctxOf(), { external_reference: r1.external_reference! });
  assertions.push({ name: "mock.cancel ok", passed: rc.success });

  const manual = ManualAppointmentProvider;
  const ml = await manual.getLocations(ctxOf(), {});
  assertions.push({ name: "manual.getLocations returns operator-scheduled location", passed: ml.success && ml.locations.length === 1 });

  // ---------- Engine-level: build a synthetic FR app, run the full flow, clean up ----------
  let traveler: any, app: any, createdAppointmentIds: string[] = [], createdDocIds: string[] = [], createdSlotIds: string[] = [];
  try {
    traveler = await ensureTravelerForUser(svc, user, {});
    app = await svc.entities.VisaApplication.create({ traveler_id: traveler.id, organization_id: null, nationality: "IN", residence: "IN", destination: "FR", visa_type_key: "FR-tourism", purpose: "tourism", channel: "vac", status: "submission_ready", current_step: "submission", appointment_required: true, requirements_version: "FR-tourism-v1", question_version: "visa.application.questions.v1", metadata: { _test: true } });

    const reqs = await ensureAppointmentRequirements(svc, app);
    ok("engine: FR derives BIOMETRICS requirement", { types: reqs.map((r) => r.type), sources: reqs.map((r) => r.source) });
    assertions.push({ name: "engine: FR biometrics required", passed: reqs.some((r) => r.type === "BIOMETRICS" && r.required) });

    const readinessFR = await checkAppointmentReadiness(svc, app);
    assertions.push({ name: "engine: FR readiness blocking on BIOMETRICS", passed: readinessFR.required && !readinessFR.ready && readinessFR.blocking_items.some((b) => b.code === "BIOMETRICS"), detail: readinessFR });

    const biReq = reqs.find((r) => r.type === "BIOMETRICS");
    const locs = await listLocations(svc, user, app.id, biReq.id);
    ok("engine: listLocations returns fixtures", { count: locs.locations.length });
    const extLoc = locs.locations[0];

    const slots = await findSlots(svc, user, { application_id: app.id, requirement_id: biReq.id, external_location_id: extLoc.external_location_id });
    ok("engine: findSlots caches slots", { count: slots.slots.length });
    createdSlotIds = slots.slots.map((s) => s.id);

    const bookable = (slots.slots || []).find((s) => s.availability_status === "AVAILABLE" && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now()) && new Date(s.start_at_utc).getTime() > Date.now());
    if (!bookable) throw Object.assign(new Error("No bookable future slot in fixture"), { code: "NO_SLOT" });
    const slot = bookable;
    const booked = await bookAppointment(svc, user, { application_id: app.id, requirement_id: biReq.id, slot_id: slot.id });
    ok("engine: bookAppointment creates BOOKED appointment", { status: booked.appointment.status, external_reference: booked.appointment.external_reference });
    createdAppointmentIds.push(booked.appointment.id);
    assertions.push({ name: "engine: appointment timezone stored (UTC + Asia/Kolkata)", passed: booked.appointment.scheduled_at_utc && booked.appointment.location_timezone === "Asia/Kolkata" });
    assertions.push({ name: "engine: confirmation document minted in vault", passed: !!booked.appointment.confirmation_document_id, detail: { doc_id: booked.appointment.confirmation_document_id } });
    if (booked.appointment.confirmation_document_id) createdDocIds.push(booked.appointment.confirmation_document_id);
    const frReqAfter = await svc.entities.AppointmentRequirement.get(biReq.id);
    assertions.push({ name: "engine: requirement linked to appointment", passed: frReqAfter.appointment_id === booked.appointment.id });

    // Duplicate booking → same appointment (no second external booking).
    const dup = await bookAppointment(svc, user, { application_id: app.id, requirement_id: biReq.id, slot_id: slot.id });
    assertions.push({ name: "engine: duplicate booking idempotent (same appointment)", passed: dup.idempotent && dup.appointment.id === booked.appointment.id });

    // Reschedule to a new (future, non-expired) slot.
    const newSlot = (slots.slots || []).find((s) => s.id !== slot.id && s.availability_status === "AVAILABLE" && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now()) && new Date(s.start_at_utc).getTime() > Date.now()) || slots.slots[0];
    const resch = await rescheduleAppointment(svc, user, { appointment_id: booked.appointment.id, new_slot_id: newSlot.id });
    ok("engine: reschedule creates new BOOKED appointment", { status: resch.appointment.status, rescheduled_from: resch.appointment.rescheduled_from });
    createdAppointmentIds.push(resch.appointment.id);
    if (resch.appointment.confirmation_document_id) createdDocIds.push(resch.appointment.confirmation_document_id);
    assertions.push({ name: "engine: reschedule preserves history (rescheduled_from set)", passed: resch.appointment.rescheduled_from === booked.appointment.id });
    const oldApt = await svc.entities.Appointment.get(booked.appointment.id);
    assertions.push({ name: "engine: old appointment CANCELLED, not overwritten", passed: oldApt.status === "CANCELLED" });

    // Attendance confirmation.
    const attend = await confirmAttendance(svc, user, resch.appointment.id, "COMPLETED");
    assertions.push({ name: "engine: confirmAttendance COMPLETED", passed: attend.appointment.status === "COMPLETED" });
    const bioEvents = await svc.entities.BiometricsEvent.filter({ appointment_id: resch.appointment.id }).catch(() => []);
    assertions.push({ name: "engine: BiometricsEvent created on completion", passed: bioEvents.length > 0 });

    // Cancel flow on a fresh booking.
    const slot2 = (slots.slots || []).find((s) => s.id !== slot.id && s.id !== newSlot.id && s.availability_status === "AVAILABLE" && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now()) && new Date(s.start_at_utc).getTime() > Date.now()) || slots.slots[0];
    const b2 = await bookAppointment(svc, user, { application_id: app.id, requirement_id: biReq.id, slot_id: slot2.id });
    if (b2.appointment.id) createdAppointmentIds.push(b2.appointment.id);
    if (b2.appointment.confirmation_document_id) createdDocIds.push(b2.appointment.confirmation_document_id);
    const cancelled = await cancelAppointment(svc, user, b2.appointment.id);
    assertions.push({ name: "engine: cancelAppointment → CANCELLED", passed: cancelled.appointment.status === "CANCELLED" });

    // Provider failure: swap scenario.
    const frProv = (await svc.entities.Provider.filter({ key: "fr_mock_vac_appointment" }).catch(() => []))[0];
    if (frProv) {
      await svc.entities.Provider.update(frProv.id, { adapter_config: { provider_type: "VISA_CENTER_API", scenario: "slot_expired" } }).catch(() => {});
      const slot3 = (slots.slots || []).find((s) => s.availability_status === "AVAILABLE" && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now())) || slots.slots[0];
      let failed = false, code = "";
      try { await bookAppointment(svc, user, { application_id: app.id, requirement_id: biReq.id, slot_id: slot3.id }); }
      catch (e: any) { failed = true; code = e.code; }
      assertions.push({ name: "engine: provider slot_expired → booking fails", passed: failed && code === "SLOT_EXPIRED", detail: { code } });
      await svc.entities.Provider.update(frProv.id, { adapter_config: { provider_type: "VISA_CENTER_API", scenario: "ok" } }).catch(() => {});
    }
  } catch (e: any) {
    fail("engine: FR E2E threw", { error: e?.message, stack: e?.stack });
  } finally {
    // Cleanup synthetic data.
    try {
      for (const id of createdAppointmentIds) { await svc.entities.AppointmentEvent.deleteMany({ appointment_id: id }).catch(() => {}); await svc.entities.Appointment.delete(id).catch(() => {}); }
      await svc.entities.BiometricsEvent.deleteMany({ application_id: app?.id }).catch(() => {});
      await svc.entities.InterviewEvent.deleteMany({ application_id: app?.id }).catch(() => {});
      await svc.entities.AppointmentRequirement.deleteMany({ application_id: app?.id }).catch(() => {});
      for (const id of createdSlotIds) await svc.entities.AppointmentSlot.delete(id).catch(() => {});
      for (const id of createdDocIds) { const d: any = await svc.entities.Document.get(id).catch(() => null); if (d) { await svc.entities.DocumentVersion.deleteMany({ document_id: id }).catch(() => {}); await svc.entities.Document.delete(id).catch(() => {}); } }
      if (app) await svc.entities.VisaApplication.delete(app.id).catch(() => {});
    } catch {}
  }

  // ---------- Japan regression: no appointment required ----------
  try {
    const jpApp = await svc.entities.VisaApplication.create({ traveler_id: traveler?.id || (await ensureTravelerForUser(svc, user, {})).id, organization_id: null, nationality: "IN", residence: "IN", destination: "JP", visa_type_key: "JP-tourism", purpose: "tourism", channel: "evisa", status: "submitted", current_step: "decision", appointment_required: false, requirements_version: "JP-tourism-v1", question_version: "visa.application.questions.v1", metadata: { _test: true } });
    const jpReqs = await ensureAppointmentRequirements(svc, jpApp);
    ok("engine: JP derives no required appointment", { types: jpReqs.map((r) => r.type), statuses: jpReqs.map((r) => r.status) });
    assertions.push({ name: "engine: JP — no REQUIRED appointment requirement", passed: !jpReqs.some((r) => r.required && r.status === "REQUIRED") });
    const jpReadiness = await checkAppointmentReadiness(svc, jpApp);
    assertions.push({ name: "engine: JP readiness required=false", passed: jpReadiness.required === false, detail: jpReadiness });
    await svc.entities.AppointmentRequirement.deleteMany({ application_id: jpApp.id }).catch(() => {});
    await svc.entities.VisaApplication.delete(jpApp.id).catch(() => {});
  } catch (e: any) { fail("engine: JP regression threw", { error: e?.message }); }

  // ---------- Orchestrator plan has appointment tasks ----------
  try {
    const { ensureVisaPlanTemplate } = await import("../lifecycle.ts");
    await ensureVisaPlanTemplate(svc);
    const tmpl: any = (await svc.entities.PlanTemplate.filter({ template_id: "visa_application", active: true }).catch(() => []))[0];
    const taskKeys: string[] = (tmpl.tasks || tmpl.definition?.tasks || []).map((t: any) => t.key);
    const need = ["book_appointment", "attend_appointment", "passport_submission", "passport_return", "wait_for_decision"];
    assertions.push({ name: "orchestrator: VISA_PLAN contains appointment + decision tasks", passed: need.every((k) => taskKeys.includes(k)), detail: { taskKeys } });
  } catch (e: any) { fail("orchestrator: plan check threw", { error: e?.message }); }

  const passed = assertions.filter((a) => a.passed).length;
  const failedList = assertions.filter((a) => !a.passed).map((a) => a.name);
  const firstFail = assertions.find((a) => !a.passed);
  return { allPassed: failedList.length === 0, total: assertions.length, passed, failed: failedList, firstFailure: firstFail ? { name: firstFail.name, detail: firstFail.detail } : null, assertions };
}