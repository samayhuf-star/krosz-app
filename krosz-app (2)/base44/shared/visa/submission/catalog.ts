// Worldz Visa (Phase 8) — submission provider + route catalog seed.
//
// Idempotent. Seeds two Provider rows (category "submission") and two
// SubmissionRoute rows so Phase 8 is operational out of the box:
//   - France Schengen tourism → MANUAL_OPERATOR at a VAC (operator workflow).
//   - Japan eVisa tourism → MockGovernmentApiProvider (automated sandbox).
// Credential binding is left to operators (ProviderCredential admin UI); the
// manual provider needs no external credentials.

import { registerProviderAdapter } from "../../providers/registry.ts";
import { ManualSubmissionProvider } from "./adapters/manual.ts";
import { MockGovernmentApiProvider } from "./adapters/mock_api.ts";
import { BrowserAutomationProvider } from "./adapters/browser_mock.ts";

// Register submission adapters into the shared provider registry (idempotent at
// import time; registry throws on duplicate, so guard with hasProviderAdapter).
import { hasProviderAdapter } from "../../providers/registry.ts";
if (!hasProviderAdapter("visa_submission_manual")) registerProviderAdapter(ManualSubmissionProvider as any);
if (!hasProviderAdapter("visa_submission_mock_api")) registerProviderAdapter(MockGovernmentApiProvider as any);
if (!hasProviderAdapter("visa_submission_browser_mock")) registerProviderAdapter(BrowserAutomationProvider as any);

export interface SubmissionProviderFixture { provider: any; routes: any[]; }

export const SUBMISSION_PROVIDER_FIXTURES: SubmissionProviderFixture[] = [
  {
    provider: {
      name: "France VAC Manual Submission",
      key: "fr_manual_vac",
      category: "submission",
      adapter_key: "visa_submission_manual",
      adapter_config: { provider_type: "MANUAL_OPERATOR" },
      environment: "sandbox",
      status: "connected",
      enabled: true,
      is_default: false,
      health_status: "healthy",
      capabilities: ["VALIDATE", "CREATE_DRAFT", "STATUS"],
    },
    routes: [
      {
        destination: "FR", visa_type_key: "FR-tourism", purpose: "tourism", channel: "vac",
        provider_type: "MANUAL_OPERATOR", capabilities: ["VALIDATE", "CREATE_DRAFT", "STATUS"],
        priority: 10, environment: "sandbox", status: "active",
        appointment_required: true, appointment_location: "VFS Global — Paris",
        metadata: { unverified: true },
      },
    ],
  },
  {
    provider: {
      name: "Japan eVisa Mock Government API",
      key: "jp_mock_gov_api",
      category: "submission",
      adapter_key: "visa_submission_mock_api",
      adapter_config: { provider_type: "GOVERNMENT_API", scenario: "ok" },
      environment: "sandbox",
      status: "connected",
      enabled: true,
      is_default: false,
      health_status: "healthy",
      capabilities: ["VALIDATE", "CREATE_DRAFT", "SUBMIT", "STATUS", "RECEIPT", "CANCEL", "DOCUMENT_UPLOAD"],
    },
    routes: [
      {
        destination: "JP", visa_type_key: "JP-tourism", purpose: "tourism", channel: "evisa",
        provider_type: "GOVERNMENT_API", capabilities: ["VALIDATE", "CREATE_DRAFT", "SUBMIT", "STATUS", "RECEIPT", "CANCEL"],
        priority: 10, environment: "sandbox", status: "active",
        appointment_required: false,
        metadata: { unverified: true, mock: true },
      },
    ],
  },
];

// Idempotent upsert: Provider by `key` (stable machine key); SubmissionRoute by
// {destination, visa_type_key, purpose, channel, provider_id}.
export async function ensureSubmissionCatalog(svc: any): Promise<{ providers: number; routes: number }> {
  let providers = 0, routes = 0;
  for (const fx of SUBMISSION_PROVIDER_FIXTURES) {
    const p = fx.provider;
    let row: any = (await svc.entities.Provider.filter({ key: p.key, category: "submission" }).catch(() => []))[0];
    if (!row) row = await svc.entities.Provider.create(p).catch(() => null);
    else row = await svc.entities.Provider.update(row.id, p).catch(() => row);
    if (!row) continue;
    providers++;

    for (const r of fx.routes) {
      const key = { destination: r.destination, visa_type_key: r.visa_type_key, purpose: r.purpose, channel: r.channel, provider_id: row.id, status: "active" };
      let rr: any = (await svc.entities.SubmissionRoute.filter(key).catch(() => []))[0];
      const data = { ...r, provider_id: row.id };
      if (!rr) rr = await svc.entities.SubmissionRoute.create(data).catch(() => null);
      else rr = await svc.entities.SubmissionRoute.update(rr.id, data).catch(() => rr);
      if (rr) routes++;
    }
  }
  return { providers, routes };
}