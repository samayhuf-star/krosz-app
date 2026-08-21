// Worldz Visa (Phase 9) — MockAppointmentProvider.
//
// A deterministic FAKE appointment provider (VFS-style VAC) for automated tests
// and the sandbox product. Supports the full capability stack. Determinism:
//   - external_slot_id = djb2(location_id|type|start_at) → calling book()
//     twice with the same idempotency key returns the SAME external_reference.
//   - Locations are a fixed fixture (New Delhi / Mumbai / Bengaluru VAC).
//   - Slots are generated deterministically from the requested date range.
//   - Confirmation is a synthetic in-memory "PDF" minted as a mock storage_uri.
//
// Failure modes (ctx.adapterConfig.scenario): ok | slot_expired |
// slot_unavailable | booking_timeout | duplicate | unavailable | auth_failure |
// rate_limit. The engine dedups by idempotency_key BEFORE calling book(), so
// "duplicate" is exercised via direct adapter calls in the contract suite.

import type { ProviderContext } from "../../../providers/types.ts";
import type { AppointmentProviderAdapter, BookRequest, BookResult, AppointmentType, ProviderLocation, ProviderSlot } from "../types.ts";
import { djb2 } from "../../../operations/idempotency.ts";

const TZ = "Asia/Kolkata";

const LOCATIONS: ProviderLocation[] = [
  { external_location_id: "vac-new-delhi", name: "VFS Global — New Delhi", address: "Shantipath, Chanakyapuri", city: "New Delhi", state: "Delhi", country: "IN", postal_code: "110021", latitude: 28.6024, longitude: 77.1655, timezone: TZ, appointment_types: ["BIOMETRICS", "INTERVIEW", "DOCUMENT_SUBMISSION", "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION"] },
  { external_location_id: "vac-mumbai", name: "VFS Global — Mumbai", address: "Bandra Kurla Complex, Bandra East", city: "Mumbai", state: "Maharashtra", country: "IN", postal_code: "400051", latitude: 19.0664, longitude: 72.8682, timezone: TZ, appointment_types: ["BIOMETRICS", "DOCUMENT_SUBMISSION", "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION"] },
  { external_location_id: "vac-bengaluru", name: "VFS Global — Bengaluru", address: "1st Floor, Prestige Atrium, Richmond Road", city: "Bengaluru", state: "Karnataka", country: "IN", postal_code: "560025", latitude: 12.9651, longitude: 77.5968, timezone: TZ, appointment_types: ["BIOMETRICS", "DOCUMENT_SUBMISSION", "PASSPORT_COLLECTION"] },
];

function scenarioOf(ctx: ProviderContext): string {
  return String((ctx.adapterConfig as any)?.scenario || "ok");
}

function slotIdFor(locationId: string, type: string, startUtc: string): string {
  return djb2(`${locationId}|${type}|${startUtc}`).slice(0, 14).toUpperCase();
}

// Deterministic slot grid: for each day in [date_from, date_to] (or the next 14
// days), emit 30-min slots 09:00–16:00 local, skipping a deterministic subset so
// some slots are unavailable (availability realism for tests + UI).
function generateSlots(opts: { location_id: string; appointment_type: AppointmentType; date_from?: string; date_to?: string }): ProviderSlot[] {
  const out: ProviderSlot[] = [];
  const loc = LOCATIONS.find((l) => l.external_location_id === opts.location_id) || LOCATIONS[0];
  const from = opts.date_from ? new Date(opts.date_from) : new Date();
  const to = opts.date_to ? new Date(opts.date_to) : new Date(Date.now() + 14 * 86400000);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 0, 0);
  // Bound to a sane window to keep fixture volume small.
  const maxTo = new Date(Math.min(to.getTime(), from.getTime() + 14 * 86400000));
  for (let d = new Date(from); d <= maxTo; d.setDate(d.getDate() + 1)) {
    const dow = d.getUTCDay(); // 0 Sun..6 Sat
    if (dow === 0 || dow === 6) continue; // VAC closed weekends
    for (let h = 9; h < 16; h++) {
      const startUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 5, 30, 0)); // IST = UTC+5:30 → UTC 03:30..10:30
      const endUtc = new Date(startUtc.getTime() + 30 * 60000);
      const id = slotIdFor(opts.location_id, opts.appointment_type, startUtc.toISOString());
      // Deterministic unavailability: skip ~1 in 3 slots via djb2 parity.
      if (parseInt(djb2(id).slice(-1), 16) % 3 === 0) continue;
      out.push({
        external_slot_id: id,
        location_id: loc.external_location_id,
        appointment_type: opts.appointment_type,
        start_at_utc: startUtc.toISOString(),
        end_at_utc: endUtc.toISOString(),
        duration_minutes: 30,
        location_timezone: loc.timezone,
        availability_status: "AVAILABLE",
        expires_at: new Date(startUtc.getTime() + 15 * 60000).toISOString(),
        provider_reference: `MOCK-SLOT-${id}`,
      });
    }
  }
  return out;
}

function confirmPayloadFor(ref: string): BookResult["confirmation_payload"] {
  const content = `%PDF-1.4\nMock VFS appointment confirmation. Reference: ${ref}. (sandbox)`;
  return {
    storage_uri: `mock://appointment-confirmation/${ref}`,
    mime_type: "application/pdf",
    file_size: content.length,
    display_name: `Appointment confirmation ${ref}`,
  };
}

export const MockAppointmentProvider: AppointmentProviderAdapter = {
  key: "visa_appointment_mock_vac",
  displayName: "Mock VAC Appointment (sandbox)",
  providerType: "VISA_CENTER_API",
  capabilities: ["APPOINTMENT_SEARCH", "APPOINTMENT_HOLD", "APPOINTMENT_BOOK", "APPOINTMENT_CANCEL", "APPOINTMENT_RESCHEDULE", "APPOINTMENT_STATUS", "LOCATION_LIST", "SLOT_LIST"],

  getCapabilities(_ctx: ProviderContext) {
    return ["APPOINTMENT_SEARCH", "APPOINTMENT_HOLD", "APPOINTMENT_BOOK", "APPOINTMENT_CANCEL", "APPOINTMENT_RESCHEDULE", "APPOINTMENT_STATUS", "LOCATION_LIST", "SLOT_LIST"];
  },

  async getLocations(_ctx: ProviderContext, opts: { appointment_type?: AppointmentType }) {
    const locs = opts.appointment_type ? LOCATIONS.filter((l) => (l.appointment_types || []).includes(opts.appointment_type!)) : LOCATIONS;
    return { success: true, locations: locs.filter((l) => l), response_metadata: { mock: true } };
  },

  async getSlots(_ctx: ProviderContext, opts: { location_id: string; external_location_id: string; appointment_type: AppointmentType; date_from?: string; date_to?: string }) {
    const loc = LOCATIONS.find((l) => l.external_location_id === opts.external_location_id) || LOCATIONS[0];
    if (!(loc.appointment_types || []).includes(opts.appointment_type)) return { success: false, slots: [], error_code: "INVALID_LOCATION", error_message: "Location does not support this appointment type" };
    return { success: true, slots: generateSlots({ location_id: loc.external_location_id, appointment_type: opts.appointment_type, date_from: opts.date_from, date_to: opts.date_to }), response_metadata: { mock: true, location: loc.name } };
  },

  async holdSlot(ctx: ProviderContext, opts: { external_slot_id: string }) {
    if (scenarioOf(ctx) === "slot_unavailable") return { success: false, error_code: "SLOT_UNAVAILABLE", error_message: "Slot taken" };
    return { success: true, provider_reference: `MOCK-HOLD-${opts.external_slot_id}`, expires_at: new Date(Date.now() + 10 * 60000).toISOString() };
  },

  async book(ctx: ProviderContext, req: BookRequest): Promise<BookResult> {
    const sc = scenarioOf(ctx);
    if (sc === "booking_timeout") await new Promise((r) => setTimeout(r, 50));
    if (sc === "slot_expired") return { success: false, error_code: "SLOT_EXPIRED", error_message: "Slot expired", error_category: "REQUIRES_USER", retryable: true };
    if (sc === "slot_unavailable") return { success: false, error_code: "SLOT_UNAVAILABLE", error_message: "Slot no longer available", error_category: "REQUIRES_USER", retryable: true };
    if (sc === "unavailable") return { success: false, error_code: "PROVIDER_UNAVAILABLE", error_message: "Provider unavailable", error_category: "TRANSIENT", retryable: true };
    if (sc === "auth_failure") return { success: false, error_code: "AUTH_FAILURE", error_message: "Simulated auth failure", error_category: "REQUIRES_OPERATOR", retryable: false };
    if (sc === "rate_limit") return { success: false, error_code: "RATE_LIMIT", error_message: "Simulated rate limit", error_category: "TRANSIENT", retryable: true };
    if (sc === "invalid_slot") return { success: false, error_code: "INVALID_SLOT", error_message: "Slot not found for this location/type", error_category: "PERMANENT", retryable: false };
    // duplicate: idempotent at adapter level (engine dedups in production)
    const ref = `MOCK-APT-${djb2(req.idempotency_key).slice(0, 12).toUpperCase()}`;
    return { success: true, external_reference: ref, provider_reference: `MOCK-BOOKING-${ref}`, scheduled_at_utc: req.scheduled_at_utc, duration_minutes: req.duration_minutes, response_metadata: { mock: true, location_id: req.external_location_id }, confirmation_payload: confirmPayloadFor(ref) };
  },

  async cancel(_ctx: ProviderContext, opts: { external_reference: string }) {
    if (!opts.external_reference) return { success: false, error_code: "NOT_BOOKED", error_message: "No external reference" };
    return { success: true };
  },

  async reschedule(ctx: ProviderContext, opts: { appointment_id: string; external_reference: string; new_external_slot_id: string; new_scheduled_at_utc: string; idempotency_key: string }): Promise<BookResult> {
    if (scenarioOf(ctx) === "slot_expired") return { success: false, error_code: "SLOT_EXPIRED", error_message: "New slot expired", error_category: "REQUIRES_USER", retryable: true };
    const ref = `MOCK-APT-${djb2(opts.idempotency_key).slice(0, 12).toUpperCase()}`;
    return { success: true, external_reference: ref, provider_reference: `MOCK-BOOKING-${ref}`, scheduled_at_utc: opts.new_scheduled_at_utc, duration_minutes: 30, response_metadata: { mock: true, rescheduled_from: opts.external_reference }, confirmation_payload: confirmPayloadFor(ref) };
  },

  async getStatus(_ctx: ProviderContext, opts: { external_reference: string }) {
    if (!opts.external_reference) return { success: true, status: "BOOKING" as const, response_metadata: { mock: true } };
    return { success: true, status: "BOOKED" as const, response_metadata: { mock: true } };
  },
};