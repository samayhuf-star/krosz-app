// Worldz Visa (Phase 9) — appointment provider + location catalog seed.
//
// Idempotent. Seeds appointment Provider rows (category "submission" reused —
// appointment capabilities are additive on the same provider entity) and
// AppointmentLocation fixtures so Phase 9 is operational out of the box.
//   - France Schengen tourism → MockAppointmentProvider (VAC, biometrics).
//   - Japan eVisa tourism → appointment not required (no appointment provider).
//   - Manual fallback provider for operator-scheduled embassy/consulate routes.
// Credential binding is left to operators (ProviderCredential admin UI); the
// manual + mock providers need no external credentials.

import { registerProviderAdapter, hasProviderAdapter } from "../../providers/registry.ts";
import { MockAppointmentProvider } from "./adapters/mock.ts";
import { ManualAppointmentProvider } from "./adapters/manual.ts";

if (!hasProviderAdapter("visa_appointment_mock_vac")) registerProviderAdapter(MockAppointmentProvider as any);
if (!hasProviderAdapter("visa_appointment_manual")) registerProviderAdapter(ManualAppointmentProvider as any);

export interface AppointmentProviderFixture {
  provider: any;
  locations?: any[];
  route_patch?: { destination: string; visa_type_key: string; purpose: string; channel: string; appointment_required: boolean; appointment_provider?: string; appointment_location?: string };
}

export const APPOINTMENT_PROVIDER_FIXTURES: AppointmentProviderFixture[] = [
  {
    provider: {
      name: "France VAC Appointment (Mock)",
      key: "fr_mock_vac_appointment",
      category: "submission",
      adapter_key: "visa_appointment_mock_vac",
      adapter_config: { provider_type: "VISA_CENTER_API", scenario: "ok" },
      environment: "sandbox", status: "connected", enabled: true, is_default: false, health_status: "healthy",
      capabilities: ["APPOINTMENT_SEARCH", "APPOINTMENT_HOLD", "APPOINTMENT_BOOK", "APPOINTMENT_CANCEL", "APPOINTMENT_RESCHEDULE", "APPOINTMENT_STATUS", "LOCATION_LIST", "SLOT_LIST"],
    },
    locations: [
      { provider_id: "__PENDING__", external_location_id: "vac-new-delhi", name: "VFS Global — New Delhi", address: "Shantipath, Chanakyapuri", city: "New Delhi", state: "Delhi", country: "IN", postal_code: "110021", latitude: 28.6024, longitude: 77.1655, timezone: "Asia/Kolkata", appointment_types: ["BIOMETRICS", "INTERVIEW", "DOCUMENT_SUBMISSION", "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION"], active: true },
      { provider_id: "__PENDING__", external_location_id: "vac-mumbai", name: "VFS Global — Mumbai", address: "Bandra Kurla Complex, Bandra East", city: "Mumbai", state: "Maharashtra", country: "IN", postal_code: "400051", latitude: 19.0664, longitude: 72.8682, timezone: "Asia/Kolkata", appointment_types: ["BIOMETRICS", "DOCUMENT_SUBMISSION", "PASSPORT_SUBMISSION", "PASSPORT_COLLECTION"], active: true },
      { provider_id: "__PENDING__", external_location_id: "vac-bengaluru", name: "VFS Global — Bengaluru", address: "1st Floor, Prestige Atrium, Richmond Road", city: "Bengaluru", state: "Karnataka", country: "IN", postal_code: "560025", latitude: 12.9651, longitude: 77.5968, timezone: "Asia/Kolkata", appointment_types: ["BIOMETRICS", "DOCUMENT_SUBMISSION", "PASSPORT_COLLECTION"], active: true },
    ],
  },
  {
    provider: {
      name: "Manual Embassy Appointment (Operator)",
      key: "manual_embassy_appointment",
      category: "submission",
      adapter_key: "visa_appointment_manual",
      adapter_config: { provider_type: "MANUAL_OPERATOR" },
      environment: "sandbox", status: "connected", enabled: true, is_default: false, health_status: "healthy",
      capabilities: ["APPOINTMENT_STATUS", "LOCATION_LIST"],
    },
  },
];

export async function ensureAppointmentCatalog(svc: any): Promise<{ providers: number; locations: number }> {
  let providers = 0, locations = 0;
  for (const fx of APPOINTMENT_PROVIDER_FIXTURES) {
    const p = fx.provider;
    let row: any = (await svc.entities.Provider.filter({ key: p.key, category: "submission" }).catch(() => []))[0];
    if (!row) row = await svc.entities.Provider.create(p).catch(() => null);
    else row = await svc.entities.Provider.update(row.id, p).catch(() => row);
    if (!row) continue;
    providers++;

    if (fx.locations) {
      for (const loc of fx.locations) {
        const data = { ...loc, provider_id: row.id };
        let lr: any = (await svc.entities.AppointmentLocation.filter({ provider_id: row.id, external_location_id: data.external_location_id }).catch(() => []))[0];
        if (!lr) lr = await svc.entities.AppointmentLocation.create(data).catch(() => null);
        else lr = await svc.entities.AppointmentLocation.update(lr.id, data).catch(() => lr);
        if (lr) locations++;
      }
    }
  }
  return { providers, locations };
}