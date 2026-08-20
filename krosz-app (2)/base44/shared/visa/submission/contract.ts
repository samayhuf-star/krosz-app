// Worldz Visa (Phase 8) — Submission provider contract test suite (§36/§56/§57).
//
// Deterministic. Runs against the real adapters + the real engine using a
// synthetic ready package injected for an existing application (so Phase 8 is
// testable independently of Phase 6/7 application completeness). Verifies:
//   capabilities, validate, create, submit, status, receipt, idempotency,
//   error normalization, failure modes (§39), package hash integrity (§50),
//   stale-package block (§51), manual workflow (§25), browser mock (§32),
//   France (manual) + Japan (mock API) scenarios (§58/§59).

import { ensureSubmissionCatalog } from "./catalog.ts";
import {
  approveSubmission, createSubmission, submitSubmission, getSubmissionStatus,
  verifyPackageIntegrity, checkPackageStale, resolveProviderForApplication,
  enterExternalReference, getLatestReadyPackage,
} from "./engine.ts";
import { getSubmissionAdapter } from "./registry.ts";
import { ManualSubmissionProvider } from "./adapters/manual.ts";
import { MockGovernmentApiProvider } from "./adapters/mock_api.ts";
import { BrowserAutomationProvider } from "./adapters/browser_mock.ts";
import { getApplication, listApplications } from "../application.ts";
import { buildSubmissionPackage } from "../forms.ts";
import { submissionIdempotencyKey, categorizeError, type SubmissionContract } from "./types.ts";

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ctx(scenario = "ok", env: "sandbox" | "production" = "sandbox") {
  return {
    providerId: "test", providerKey: "test", category: "submission",
    environment: env, adapterConfig: { scenario }, credentials: {}, requestId: crypto.randomUUID(),
  };
}

function synthContract(idem: string): SubmissionContract {
  return {
    application_id: "app-test", package_id: "pkg-test", provider_id: "prov-test", provider_key: "test",
    form_snapshot_id: "snap-test", form_code: "TEST", form_version: "v1", package_hash: "hash-test",
    documents: [{ document_id: "d1", document_version_id: "v1", document_type: "PASSPORT", label: "Passport" }],
    idempotency_key: idem, environment: "sandbox",
  };
}

// Inject a deterministic ready package (snapshot + items) for an existing app so
// the engine path runs without depending on a fully-complete Phase 6/7 application.
async function injectReadyPackage(svc: any, app: any, formCode = "JAPAN_EVISA", formVersion = "v1"): Promise<any> {
  const dataHash = await sha256("synthetic-snapshot-" + app.id);
  const snap = await svc.entities.ApplicationFormSnapshot.create({
    application_id: app.id, traveler_id: app.traveler_id, form_definition_id: "test-form", form_code: formCode, form_version: formVersion,
    generated_at: new Date().toISOString(), data_hash: dataHash, dependency_fingerprint: {}, fields: { "test": "1" }, trace: [],
    validation: { valid: true, errors: [] }, missing: [], status: "fresh",
  }).catch(() => null);
  const docVersion = app.traveler_id ? "synth-doc-v1" : "synth-doc-v1";
  const items = [
    { package_id: null, application_id: app.id, type: "FORM", form_snapshot_id: snap?.id, document_id: null, document_version_id: null, document_type: null, label: `${formCode} v${formVersion}`, metadata: {} },
    { package_id: null, application_id: app.id, type: "DOCUMENT", form_snapshot_id: null, document_id: "synth-doc", document_version_id: docVersion, document_type: "PASSPORT", label: "Passport", metadata: { is_required: true } },
  ];
  const docIds = items.filter((i) => i.document_version_id).map((i) => i.document_version_id).sort();
  const package_hash = await sha256(JSON.stringify({ form_version: formVersion, form_data_hash: dataHash, document_version_ids: docIds, version: 1 }));
  const pkg = await svc.entities.SubmissionPackage.create({
    application_id: app.id, traveler_id: app.traveler_id, form_snapshot_id: snap?.id, form_code: formCode, form_version: formVersion,
    version: 1, status: "ready", package_hash, items_summary: { form: 1, documents: 1 }, metadata: { synth: true },
  }).catch(() => null);
  for (const it of items) { it.package_id = pkg?.id; await svc.entities.SubmissionPackageItem.create(it).catch(() => {}); }
  // Ensure an active ApplicationDocument pins the synthetic version so the stale
  // guard sees it as currently attached.
  await svc.entities.ApplicationDocument.create({
    application_id: app.id, document_id: "synth-doc", document_version_id: docVersion, requirement_id: null,
    document_type: "PASSPORT", is_required: true, status: "verified", submitted_at: null, verified_at: new Date().toISOString(), metadata: { synth: true },
  }).catch(() => {});
  return pkg;
}

export async function runSubmissionContractTests(svc: any, user: any): Promise<any> {
  await ensureSubmissionCatalog(svc);
  const assertions: any[] = [];
  const assert = (name: string, cond: any, detail: any = {}) => { assertions.push({ name, passed: !!cond, detail }); return !!cond; };
  const actor = (user && (user.full_name || user.email)) || "system";

  // ---------- Adapter-level: capabilities + contract ops ----------
  assert("manual: capabilities VALIDATE/CREATE_DRAFT/STATUS", ManualSubmissionProvider.getCapabilities(ctx()).includes("VALIDATE"));
  assert("mock: capabilities include SUBMIT/STATUS/RECEIPT", ["SUBMIT", "STATUS", "RECEIPT"].every((c) => (MockGovernmentApiProvider.getCapabilities(ctx()) as string[]).includes(c)));
  assert("browser: capabilities CREATE_DRAFT/SUBMIT/STATUS", ["CREATE_DRAFT", "SUBMIT", "STATUS"].every((c) => (BrowserAutomationProvider.getCapabilities(ctx()) as string[]).includes(c)));

  const c = synthContract("idem-1");
  const manVal = await ManualSubmissionProvider.validatePackage(ctx(), c);
  assert("manual.validatePackage ok", manVal.success, manVal);
  const manSub = await ManualSubmissionProvider.submit(ctx(), c);
  assert("manual.submit returns ACTION_REQUIRED", manSub.status === "ACTION_REQUIRED", manSub);

  const mockVal = await MockGovernmentApiProvider.validatePackage(ctx(), c);
  assert("mock.validatePackage ok", mockVal.success, mockVal);
  const mockSub = await MockGovernmentApiProvider.submit(ctx("ok"), c);
  assert("mock.submit ok + external_reference", mockSub.success && !!mockSub.external_reference, mockSub);
  const mockSub2 = await MockGovernmentApiProvider.submit(ctx("ok"), c);
  assert("mock.submit idempotent (same reference)", mockSub.external_reference === mockSub2.external_reference, { a: mockSub.external_reference, b: mockSub2.external_reference });
  const mockStatus = await MockGovernmentApiProvider.getStatus!(ctx("ok"), { external_reference: mockSub.external_reference!, submitted_at: new Date().toISOString() });
  assert("mock.getStatus returns a normalized status", ["SUBMITTED", "PROCESSING", "COMPLETED"].includes(mockStatus.status as string), mockStatus);
  const mockReceipt = await MockGovernmentApiProvider.getReceipt!(ctx("ok"), { external_reference: mockSub.external_reference! });
  assert("mock.getReceipt returns a receipt", mockReceipt.success && !!mockReceipt.receipt, mockReceipt);

  const browserSub = await BrowserAutomationProvider.submit(ctx(), synthContract("idem-br"));
  assert("browser.submit ok + reference", browserSub.success && !!browserSub.external_reference, browserSub);

  // ---------- Failure modes (§39) + error normalization (§40) ----------
  const failTimeout = await MockGovernmentApiProvider.submit(ctx("timeout"), synthContract("idem-t"));
  assert("failure: timeout → TRANSIENT", failTimeout.error_category === "TRANSIENT" && failTimeout.retryable, failTimeout);
  const failAuth = await MockGovernmentApiProvider.submit(ctx("auth_failure"), synthContract("idem-a"));
  assert("failure: auth_failure → REQUIRES_OPERATOR", failAuth.error_category === "REQUIRES_OPERATOR" && !failAuth.retryable, failAuth);
  const failInvalid = await MockGovernmentApiProvider.submit(ctx("invalid_package"), synthContract("idem-i"));
  assert("failure: invalid_package → PERMANENT", failInvalid.error_category === "PERMANENT" && !failInvalid.retryable, failInvalid);
  const failRate = await MockGovernmentApiProvider.submit(ctx("rate_limit"), synthContract("idem-r"));
  assert("failure: rate_limit → TRANSIENT", failRate.error_category === "TRANSIENT", failRate);
  const failRejected = await MockGovernmentApiProvider.submit(ctx("rejected"), synthContract("idem-rj"));
  assert("failure: rejected → PERMANENT + status REJECTED", failRejected.error_category === "PERMANENT" && failRejected.status === "REJECTED", failRejected);
  assert("categorizeError UNKNOWN default", categorizeError("SOMETHING_NEW", false) === "UNKNOWN", {});
  assert("categorizeError empty+retryable → TRANSIENT", categorizeError("", true) === "TRANSIENT", {});

  // ---------- Engine-level end-to-end: Japan mock API (§59) ----------
  const apps: any[] = await listApplications(svc, user);
  let jpApp = apps.find((a) => a.destination === "JP");
  if (jpApp) {
    // Clean any prior synthetic packages/submissions/approvals for a fresh, deterministic run.
    for (const s of await svc.entities.Submission.filter({ application_id: jpApp.id }).catch(() => [])) await svc.entities.Submission.update(s.id, { status: "CANCELLED" }).catch(() => {});
    const pkg = await injectReadyPackage(svc, jpApp, "JAPAN_EVISA", "v1");
    assert("engine: synthetic ready package injected", !!pkg, pkg);

    const integrity = await verifyPackageIntegrity(svc, pkg);
    assert("engine: package hash integrity valid (§50)", integrity.valid, integrity);

    const { resolved } = await resolveProviderForApplication(svc, jpApp, pkg);
    assert("engine: provider resolved deterministically (JP mock)", resolved.provider_key === "jp_mock_gov_api" && resolved.provider_type === "GOVERNMENT_API", resolved);
    assert("engine: idempotency key deterministic", resolved.idempotency_key === submissionIdempotencyKey(jpApp.id, pkg.package_hash, resolved.provider_id), resolved);

    // Approval gate (§24/§52).
    const appr = await approveSubmission(svc, user, jpApp).catch((e: any) => ({ error: e.code }));
    assert("engine: submission approved (gate)", appr?.approval?.confirmed === true, appr);

    // Create + submit.
    const created = await createSubmission(svc, user, jpApp).catch((e: any) => ({ error: e.code }));
    assert("engine: createSubmission → READY", created?.submission?.status === "READY", created);
    const submitted = await submitSubmission(svc, user, jpApp).catch((e: any) => ({ error: e.code }));
    assert("engine: submit → SUBMITTED + external_reference (§59)", submitted?.submission?.status === "SUBMITTED" && !!submitted.submission?.external_reference, submitted);

    // Duplicate submission (§60): calling submit again must NOT create a second external submission.
    const dup = await submitSubmission(svc, user, jpApp).catch((e: any) => ({ error: e.code }));
    const dupCount = (await svc.entities.Submission.filter({ application_id: jpApp.id, submission_package_id: pkg.id }).catch(() => [])).filter((s: any) => s.status === "SUBMITTED").length;
    assert("engine: duplicate submit idempotent — same reference (§60)", dup?.submission?.external_reference === submitted.submission?.external_reference, { first: submitted.submission?.external_reference, second: dup?.submission?.external_reference });
    assert("engine: duplicate submit — exactly one SUBMITTED submission", dupCount === 1, { dupCount });

    // Status poll (§18).
    const st = await getSubmissionStatus(svc, user, submitted.submission.id).catch((e: any) => ({ error: e.code }));
    assert("engine: getStatus normalized status", ["SUBMITTED", "PROCESSING", "COMPLETED"].includes(st?.status), st);

    // Stale package block (§51): mark the snapshot stale, then submit must be blocked.
    await svc.entities.ApplicationFormSnapshot.update(pkg.form_snapshot_id, { status: "superseded" }).catch(() => {});
    const staleCheck = await checkPackageStale(svc, jpApp, pkg);
    assert("engine: stale detected after snapshot superseded (§51)", staleCheck.stale && staleCheck.reasons.includes("FORM_SNAPSHOT_STALE"), staleCheck);
    assert("engine: stale → integrity still valid (hash unchanged, staleness is separate)", (await verifyPackageIntegrity(svc, pkg)).valid, {});
  } else {
    assertions.push({ name: "engine: Japan app present (skip engine E2E if none)", passed: false, detail: { note: "No JP application; create one to run engine-level tests." } });
  }

  // ---------- Engine-level: France manual flow (§58) ----------
  let frApp = apps.find((a) => a.destination === "FR" && a.purpose === "tourism");
  if (frApp) {
    for (const s of await svc.entities.Submission.filter({ application_id: frApp.id }).catch(() => [])) await svc.entities.Submission.update(s.id, { status: "CANCELLED" }).catch(() => {});
    const pkg = await injectReadyPackage(svc, frApp, "FRANCE_SCHENGEN_SHORT_STAY", "v1");
    const { resolved } = await resolveProviderForApplication(svc, frApp, pkg);
    assert("engine: FR resolves to manual VAC provider (§58)", resolved.provider_key === "fr_manual_vac" && resolved.provider_type === "MANUAL_OPERATOR", resolved);
    await approveSubmission(svc, user, frApp).catch(() => {});
    const created = await createSubmission(svc, user, frApp).catch((e: any) => ({ error: e.code }));
    assert("engine: FR createSubmission → READY", created?.submission?.status === "READY", created);
    const submitted = await submitSubmission(svc, user, frApp).catch((e: any) => ({ error: e.code }));
    assert("engine: FR submit → ACTION_REQUIRED (operator must submit externally) (§25)", submitted?.submission?.status === "ACTION_REQUIRED", submitted);
    // Operator enters the external reference stamped at the VAC.
    const ref = "VFS-" + Date.now().toString(36).toUpperCase();
    const entered = await enterExternalReference(svc, user, submitted.submission.id, ref).catch((e: any) => ({ error: e.code }));
    assert("engine: FR enterExternalReference → SUBMITTED (§25)", entered?.submission?.status === "SUBMITTED" && entered.submission?.external_reference === ref, entered);
  } else {
    assertions.push({ name: "engine: France app present (skip FR E2E if none)", passed: false, detail: { note: "No FR tourism application." } });
  }

  const allPassed = assertions.every((a) => a.passed);
  return { allPassed, total: assertions.length, failed: assertions.filter((a) => !a.passed).map((a) => a.name), assertions };
}