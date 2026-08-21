// Worldz Visa (Phase 9) — appointment adapter registry.
//
// REUSES the existing shared provider adapter registry (providers/registry.ts),
// exactly like the Phase 8 submission registry. Appointment adapters register
// under their adapter_key and are looked up by the Provider entity's
// adapter_key. No duplicate "VisaAppointmentRegistry".

import { getProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import type { AppointmentProviderAdapter } from "./types.ts";

export function asAppointmentAdapter(a: any): AppointmentProviderAdapter | null {
  if (a && typeof a === "object" && typeof (a as any).getLocations === "function" && typeof (a as any).getSlots === "function" && typeof (a as any).book === "function") {
    return a as AppointmentProviderAdapter;
  }
  return null;
}

export function getAppointmentAdapter(adapterKey: string): AppointmentProviderAdapter {
  const a = getProviderAdapter(adapterKey);
  const appt = asAppointmentAdapter(a);
  if (!appt) throw Object.assign(new Error(`Provider adapter "${adapterKey}" is not an appointment provider`), { code: "NOT_APPOINTMENT_PROVIDER" });
  return appt;
}

export function hasAppointmentAdapter(adapterKey: string): boolean {
  if (!hasProviderAdapter(adapterKey)) return false;
  return asAppointmentAdapter(getProviderAdapter(adapterKey)) != null;
}