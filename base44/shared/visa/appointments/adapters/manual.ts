// Worldz Visa (Phase 9) — ManualAppointmentProvider.
//
// Operator-driven appointment workflow for routes/providers with no automated
// booking portal (embassy/consulate phone-booking, walk-in VAC). The appointment
// engine still owns state + history; this provider surfaces operator actions:
//   book() → AVAILABLE (operator must confirm the slot externally + enter the
//   external reference + upload the confirmation). No external portal is called.

import type { ProviderContext } from "../../../providers/types.ts";
import type { AppointmentProviderAdapter, BookRequest, BookResult, ProviderLocation, ProviderSlot } from "../types.ts";

export const ManualAppointmentProvider: AppointmentProviderAdapter = {
  key: "visa_appointment_manual",
  displayName: "Manual Operator Appointment",
  providerType: "MANUAL_OPERATOR",
  capabilities: ["APPOINTMENT_STATUS", "LOCATION_LIST"],

  getCapabilities(_ctx: ProviderContext) {
    return ["APPOINTMENT_STATUS", "LOCATION_LIST"];
  },

  async getLocations(_ctx: ProviderContext, opts: { appointment_type?: any }) {
    // A single generic "operator-scheduled" location; the operator selects the
    // real venue externally and records it.
    const loc: ProviderLocation = {
      external_location_id: "manual-operator",
      name: "Operator-scheduled (embassy / consulate / VAC)",
      country: "IN", timezone: "Asia/Kolkata",
      appointment_types: ["BIOMETRICS", "INTERVIEW", "DOCUMENT_SUBMISSION", "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION", "OTHER"],
    };
    return { success: true, locations: [loc], response_metadata: { manual: true } };
  },

  async getSlots(_ctx: ProviderContext, _opts: any): Promise<{ success: boolean; slots: ProviderSlot[]; response_metadata?: any }> {
    // No automated slot search: the operator proposes a time. The UI lets the
    // operator enter a free slot; the engine treats it as a held manual slot.
    return { success: true, slots: [], response_metadata: { manual: true, operator_action: "propose_slot" } };
  },

  async book(_ctx: ProviderContext, req: BookRequest): Promise<BookResult> {
    return {
      success: true,
      status: undefined as any,
      provider_reference: `MANUAL-APT-${req.idempotency_key.slice(-8).toUpperCase()}`,
      scheduled_at_utc: req.scheduled_at_utc,
      duration_minutes: req.duration_minutes,
      response_metadata: { manual: true, operator_action: "confirm_externally_and_enter_reference" },
    };
  },

  async getStatus(_ctx: ProviderContext, _opts: { external_reference: string }) {
    return { success: true, status: "BOOKED" as const, response_metadata: { manual: true } };
  },
};