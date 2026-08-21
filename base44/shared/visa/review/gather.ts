// Worldz Visa (Phase 13) — assemble the ReviewInput from live application state.
// Reuses every Phase 1–12 service; no second source of truth.
import { resolveRequirements } from "../requirements.ts";
import { computeRequirementProgress, expiryStatus } from "../documents.ts";
import { checkApplicationReadiness } from "../questions.ts";
import { resolveFormForApplication, getLatestSnapshot, checkSnapshotStaleness } from "../forms.ts";
import { getLatestReadyPackage, resolveProviderForApplication, verifyPackageIntegrity, checkPackageStale } from "../submission/engine.ts";
import { listOrders, listInvoices, canExecutePaidService } from "../payments/engine.ts";
import { listAppointments } from "../appointments/engine.ts";
import type { ReviewInput } from "./rules.ts";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Gathered { input: ReviewInput; inputHash: string; formId: string | null; }

export async function gatherReviewInput(svc: any, user: any, app: any): Promise<Gathered> {
  const now = new Date().toISOString();
  const graph = await resolveRequirements(svc, app.destination, app.purpose).catch(() => null);
  const requirementsVersion = graph?.version?.requirements_version || null;
  const requirements = graph?.requirements || [];

  const progress = await computeRequirementProgress(svc, app);

  // Answers
  const answersRows: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
  const answers: Record<string, string> = {};
  for (const a of answersRows) answers[a.question_code] = a.normalized_value || a.value || "";
  const readiness = await checkApplicationReadiness(svc, app).catch(() => ({ ready: true }));
  const answersReady = !!readiness.ready;

  // Passport intelligence fields
  let passportFields: Record<string, string> | null = null;
  let passportVersionId: string | null = null;
  const passportItem = (progress.items || []).find((it: any) => it.document_type === "PASSPORT" && it.application_document);
  if (passportItem?.application_document?.document_version_id) {
    passportVersionId = passportItem.application_document.document_version_id;
    const exts: any[] = await svc.entities.DocumentExtraction.filter({ document_version_id: passportVersionId }).catch(() => []);
    const map: Record<string, string> = {};
    for (const e of exts) map[e.field_name] = e.normalized_value || e.field_value || "";
    passportFields = Object.keys(map).length ? map : null;
  }

  // Traveler
  const traveler: any = await svc.entities.Traveler.get(app.traveler_id).catch(() => ({}));

  // Form snapshot + staleness
  let formSnapshot: any | null = null;
  let formStale = false;
  let formId: string | null = null;
  const form = await resolveFormForApplication(svc, app).catch(() => null);
  if (form) {
    formId = form.id;
    formSnapshot = await getLatestSnapshot(svc, app, form.id);
    if (formSnapshot) {
      const st = await checkSnapshotStaleness(svc, app, formSnapshot).catch(() => ({ stale: false, changed_fields: [] }));
      formStale = !!st.stale || formSnapshot.status === "stale";
    }
  }

  // Package
  let pkg: any | null = null;
  let packageStale = false;
  let packageIntegrityValid = true;
  let resolvedProvider: any | null = null;
  try { pkg = await getLatestReadyPackage(svc, app).catch(() => null); } catch { pkg = null; }
  if (pkg) {
    const integrity = await verifyPackageIntegrity(svc, pkg).catch(() => ({ valid: false }));
    packageIntegrityValid = !!integrity?.valid;
    const stale = await checkPackageStale(svc, app, pkg).catch(() => ({ stale: false }));
    packageStale = !!stale?.stale;
    if (!packageStale) {
      try { const r = await resolveProviderForApplication(svc, app, pkg); resolvedProvider = r?.resolved || null; } catch { resolvedProvider = null; }
    }
  }

  // Payments
  let orders: any[] = [];
  let paymentRequired = false;
  let paymentPaid = false;
  try {
    const r = await listOrders(svc, user, { application_id: app.id }).catch(() => ({ orders: [] }));
    orders = r.orders || [];
    const can = await canExecutePaidService(svc, app, "submission").catch(() => ({ allowed: true, gate: "" }));
    paymentRequired = !!can && !can.allowed && String(can.gate || "").toUpperCase().includes("PAYMENT");
    paymentPaid = orders.some((o: any) => ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(o.status));
  } catch { /* non-fatal */ }

  // Appointments
  let appointments: any[] = [];
  let appointmentBooked = false;
  try {
    const r = await listAppointments(svc, user, app.id).catch(() => ({ appointments: [] }));
    appointments = r.appointments || [];
    appointmentBooked = appointments.some((a: any) => ["BOOKED", "SCHEDULED", "CONFIRMED", "ATTENDED"].includes(a.status));
  } catch { /* non-fatal */ }

  // Blocking document findings (reuse Phase 5/6 route + cross-document findings, unresolved)
  const df: any[] = await svc.entities.DocumentFinding.filter({ application_id: app.id, resolved: false, blocking: true }).catch(() => []);
  // Also include CRITICAL non-blocking (e.g. refusal inconsistency handled elsewhere, but intelligence may flag)
  const crit: any[] = (await svc.entities.DocumentFinding.filter({ application_id: app.id, resolved: false, severity: "CRITICAL" }).catch(() => [])).filter((f: any) => !df.some((x: any) => x.id === f.id));
  const blockingDocumentFindings = [...df, ...crit];

  const input: ReviewInput = {
    now, application: app, traveler, requirementsVersion, requirements,
    progress, passportFields, passportVersionId, answers, answersReady,
    formSnapshot, formStale, pkg, packageStale, packageIntegrityValid,
    orders, paymentRequired, paymentPaid, appointments, appointmentBooked,
    resolvedProvider, blockingDocumentFindings,
  };

  const inputHash = await sha256(JSON.stringify({
    app: app.id, upd: app.updated_date, rv: requirementsVersion,
    items: (progress.items || []).map((it: any) => `${it.document_type}:${it.state}:${it.application_document?.document_version_id || ""}`),
    answers: JSON.stringify(answers),
    fs: formSnapshot?.id + ":" + formSnapshot?.status + ":" + formSnapshot?.data_hash + ":" + formStale,
    pk: pkg?.id + ":" + pkg?.package_hash + ":" + pkg?.status + ":" + packageStale + ":" + packageIntegrityValid,
    pay: orders.map((o: any) => `${o.id}:${o.status}`).join(",") + ":" + paymentRequired + ":" + paymentPaid,
    appt: appointments.map((a: any) => `${a.id}:${a.status}:${a.scheduled_at || ""}`).join(","),
    prov: resolvedProvider?.provider_id || "",
    df: blockingDocumentFindings.map((f: any) => f.id).join(","),
  }));
  void listInvoices; void expiryStatus;
  return { input, inputHash, formId };
}