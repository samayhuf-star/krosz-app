// Worldz Visa (Phase 11) — execution catalog.
// Registers the mock execution adapters into the existing provider registry and
// seeds PortalDefinition + PortalWorkflow rows. Phase 11 only ships MOCK /
// manual providers — no real production portal automation (§49/§50/§51).

import { registerProviderAdapter } from "../../providers/registry.ts";
import { mockApiExecutionAdapter } from "./adapters/mock_api.ts";
import { browserMockExecutionAdapter } from "./adapters/browser_mock.ts";
import { manualExecutionAdapter } from "./adapters/manual_exec.ts";

// Register the execution adapters into the existing provider registry at
// module load (idempotent). This guarantees startExecution can resolve the
// adapter by adapter_key without a DB seed having run first.
registerProviderAdapter(mockApiExecutionAdapter);
registerProviderAdapter(browserMockExecutionAdapter);
registerProviderAdapter(manualExecutionAdapter);

const JAPAN_BROWSER_STEPS = [{ key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" }];
const FR_BROWSER_STEPS = [
  { key: "OPEN_PORTAL" }, { key: "AUTHENTICATE" },
  { key: "FILL_IDENTITY" }, { key: "FILL_PASSPORT" }, { key: "FILL_TRAVEL" }, { key: "FILL_CONTACT" },
  { key: "UPLOAD_PASSPORT" }, { key: "UPLOAD_PHOTO" }, { key: "UPLOAD_DOCS" },
  { key: "REVIEW" }, { key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" },
];

const FR_FIELD_MAPPINGS = [
  { field_code: "applicant.surname", primary: { type: "label", value: "Surname" }, fallbacks: [{ type: "name", value: "surname" }, { type: "id", value: "surname" }] },
  { field_code: "applicant.given_names", primary: { type: "label", value: "Given names" }, fallbacks: [{ type: "name", value: "given_names" }] },
  { field_code: "applicant.dob", primary: { type: "label", value: "Date of birth" } },
  { field_code: "passport.number", primary: { type: "label", value: "Passport number" } },
  { field_code: "passport.expiry", primary: { type: "label", value: "Passport expiry" } },
  { field_code: "travel.arrival_date", primary: { type: "label", value: "Arrival date" } },
  { field_code: "travel.departure_date", primary: { type: "label", value: "Departure date" } },
  { field_code: "travel.purpose", primary: { type: "label", value: "Purpose of visit" } },
  { field_code: "contact.email", primary: { type: "label", value: "Email" } },
];

const FR_DOC_MAPPINGS = [
  { document_type: "PASSPORT", selector: "file_passport", constraints: { max_size: 5242880, allowed_types: ["application/pdf", "image/jpeg"] } },
  { document_type: "PHOTO", selector: "file_photo", constraints: { max_size: 1048576, allowed_types: ["image/jpeg", "image/png"] } },
  { document_type: "INVITATION_LETTER", selector: "file_invitation" },
  { document_type: "FLIGHT_ITINERARY", selector: "file_flight" },
  { document_type: "HOTEL_BOOKING", selector: "file_hotel" },
];

const SEED_PROVIDERS = [
  { name: "Japan eVisa API", key: "visa.exec.mock_api", adapter_key: "visa.exec.mock_api", category: "submission", providerType: "GOVERNMENT_API", capabilities: ["EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE", "STATUS_CHECK"], strategy: "API" },
  { name: "France Schengen Browser Automation", key: "visa.exec.fr_browser", adapter_key: "visa.exec.browser_mock", category: "submission", providerType: "BROWSER_AUTOMATION", capabilities: ["BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE"], strategy: "BROWSER_AUTOMATION" },
  { name: "Mock Visa Portal", key: "visa.exec.mock_portal", adapter_key: "visa.exec.browser_mock", category: "submission", providerType: "BROWSER_AUTOMATION", capabilities: ["BROWSER_NAVIGATION", "FORM_FILLING", "DOCUMENT_UPLOAD", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE"], strategy: "BROWSER_AUTOMATION" },
  { name: "Manual Embassy Submission", key: "visa.exec.manual", adapter_key: "visa.exec.manual", category: "submission", providerType: "MANUAL_OPERATOR", capabilities: ["HUMAN_HANDOFF", "EXTERNAL_SUBMISSION", "RECEIPT_CAPTURE"], strategy: "MANUAL" },
];

export async function ensureExecutionCatalog(svc: any): Promise<any> {
  // Adapters are registered at module load (above); this function persists the
  // PortalDefinition / PortalWorkflow / Provider seed rows.
  const seeded = { providers: [] as string[], portals: [] as string[], workflows: [] as string[] };

  for (const def of SEED_PROVIDERS) {
    let p: any[] = await svc.entities.Provider.filter({ key: def.key, category: "submission" }).catch(() => []);
    let provider = p[0];
    if (!provider) {
      provider = await svc.entities.Provider.create({
        name: def.name, key: def.key, category: "submission", adapter_key: def.adapter_key,
        capabilities: def.capabilities, environment: "sandbox", status: "connected",
        enabled: true, is_default: false, health_status: "healthy", adapter_config: { provider_type: def.providerType, strategy: def.strategy },
      });
    } else {
      provider = await svc.entities.Provider.update(provider.id, { adapter_key: def.adapter_key, capabilities: def.capabilities, status: "connected", enabled: true, health_status: "healthy", adapter_config: { provider_type: def.providerType, strategy: def.strategy } }).catch(() => provider);
    }
    seeded.providers.push(provider.id);
  }

  // Portal definitions.
  const portals = [
    { providerKey: "visa.exec.mock_api", name: "Japan eVisa Portal", country: "JP", visa_type_key: "evisa", base_url: "https://api.mock-gov.example", strategy: "API", auth: "API_KEY", domains: ["api.mock-gov.example"], automation: true, autoApproveWorkflow: false },
    { providerKey: "visa.exec.fr_browser", name: "France Schengen Portal", country: "FR", visa_type_key: "schengen_short_stay", base_url: "https://portal.mock-gov.example", strategy: "BROWSER_AUTOMATION", auth: "CREDENTIAL", domains: ["portal.mock-gov.example"], automation: true, autoApproveWorkflow: true, steps: FR_BROWSER_STEPS },
    { providerKey: "visa.exec.mock_portal", name: "Mock Visa Portal", country: "MOCK", visa_type_key: "mock_visa", base_url: "https://portal.mock-gov.example", strategy: "BROWSER_AUTOMATION", auth: "CREDENTIAL", domains: ["portal.mock-gov.example"], automation: true, autoApproveWorkflow: true, steps: FR_BROWSER_STEPS },
    { providerKey: "visa.exec.manual", name: "Embassy Manual Desk", country: "EMB", visa_type_key: "visa", base_url: "https://embassy.manual.example", strategy: "MANUAL", auth: "MANUAL_LOGIN", domains: ["embassy.manual.example"], automation: false, autoApproveWorkflow: true, steps: [{ key: "OPEN_PORTAL" }, { key: "SUBMIT" }, { key: "CAPTURE_RECEIPT" }] },
  ];

  const opt = {}; // build options
  for (const pl of portals) {
    const ps: any[] = await svc.entities.Provider.filter({ key: pl.providerKey }).catch(() => []);
    if (!ps[0]) continue;
    let rows: any[] = await svc.entities.PortalDefinition.filter({ provider_id: ps[0].id, country: pl.country, visa_type_key: pl.visa_type_key }).catch(() => []);
    let pd = rows[0];
    const payload: any = {
      provider_id: ps[0].id, portal_name: pl.name, country: pl.country, visa_type_key: pl.visa_type_key,
      base_url: pl.base_url, execution_strategy: pl.strategy, auth_strategy: pl.auth,
      automation_allowed: pl.automation, allowed_domains: pl.domains, version: "v1", status: "ACTIVE",
      max_concurrent_sessions: 4,
    };
    if (!pd) pd = await svc.entities.PortalDefinition.create(payload);
    else pd = await svc.entities.PortalDefinition.update(pd.id, payload).catch(() => pd);
    seeded.portals.push(pd.id);

    if (pl.autoApproveWorkflow && pl.steps) {
      let wfs: any[] = await svc.entities.PortalWorkflow.filter({ portal_definition_id: pd.id, version: "v1" }).catch(() => []);
      let wf = wfs[0];
      const wfPayload: any = {
        portal_definition_id: pd.id, version: "v1", status: "ACTIVE",
        steps: pl.steps, field_mappings: FR_FIELD_MAPPINGS, document_mappings: FR_DOC_MAPPINGS,
        navigation_rules: [], published_at: new Date().toISOString(),
      };
      if (!wf) wf = await svc.entities.PortalWorkflow.create(wfPayload);
      else wf = await svc.entities.PortalWorkflow.update(wf.id, wfPayload).catch(() => wf);
      // JAPAN API portal gets an empty mapping set; workflow also seeded for parity.
      void opt;
      seeded.workflows.push(wf.id);
    }
  }
  return seeded;
}

export { FR_FIELD_MAPPINGS, FR_DOC_MAPPINGS };