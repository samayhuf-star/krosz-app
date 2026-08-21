// Worldz Visa — public-ish API surface (Phase 1, extended through Phase 27/28).
// Phase 28 adds the traveler-wizard presentation contract tests (run-entry-contract-tests).
// Actions: list-destinations | check-eligibility | create-application |
//          get-application | list-applications | create-traveler | list-travelers |
//          seed-catalog (admin)
// Reuses base44/shared/visa/* — no second orchestrator. Catalog seed is dev-labeled.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { ensureVisaCatalog, listDestinationsFromCatalog } from "../../shared/visa/catalog.ts";
import { resolveVisaRoute } from "../../shared/visa/resolver.ts";
import { listTravelers, ensureTravelerForUser } from "../../shared/visa/traveler.ts";
import { createApplication, getApplication, listApplications } from "../../shared/visa/application.ts";
import { ensureVisaRequirements, resolveRequirements } from "../../shared/visa/requirements.ts";
import { getVisaRunProgress, approveVisaApplication, advanceVisaApplication } from "../../shared/visa/lifecycle.ts";
import {
  getDocumentConfig, createDocument, replaceDocument, listTravelerDocuments, getDocument, deleteDocument,
  findReusableDocuments, attachDocumentToApplication, detachDocument, listApplicationDocuments,
  validateDocumentForApplication,
} from "../../shared/visa/documents.ts";
import {
  processDocumentVersion, getDocumentIntelligence, validateVersionForApplication, analyzeApplicationDocuments,
  confirmExtraction, retryProcessing, detectDuplicates, proposePrefill, applyPrefill, getResolutionCenter,
} from "../../shared/visa/intelligence.ts";
import { runIntelligenceContractTests } from "../../shared/visa/intelligence/contract.ts";
import {
  resolveQuestionSet, listAnswers, upsertAnswer, bulkUpsertAnswers,
  checkApplicationReadiness, completeApplicationInformationSignal, ensureQuestionCatalog,
} from "../../shared/visa/questions.ts";
import {
  generateGovernmentForm, checkSnapshotStaleness, getLatestSnapshot,
  buildSubmissionPackage, listSubmissionPackages, ensureFormCatalog,
  resolveFormForApplication, listFormDefinitions, getFormFields, getFormMappings,
  validateFormForPublish, exportSnapshot, FORM_FIXTURES,
} from "../../shared/visa/forms.ts";
// Phase 8: importing the catalog registers the submission adapters (manual,
// mock government API, browser mock) into the shared provider registry as a
// side effect, so resolveSubmissionProvider can look them up by adapter_key.
import { ensureSubmissionCatalog } from "../../shared/visa/submission/catalog.ts";
import {
  resolveProviderForApplication, approveSubmission, createSubmission, submitSubmission,
  getSubmissionStatus, enterExternalReference, uploadReceipt, cancelSubmission,
  listSubmissions, getSubmission, verifyPackageIntegrity, checkPackageStale, getLatestReadyPackage,
} from "../../shared/visa/submission/engine.ts";
import { runSubmissionContractTests } from "../../shared/visa/submission/contract.ts";
// Phase 9: importing the catalog registers the appointment adapters (mock VAC,
// manual operator) into the shared provider registry as a side effect.
import { ensureAppointmentCatalog } from "../../shared/visa/appointments/catalog.ts";
import {
  ensureAppointmentRequirements, listAppointmentRequirements, checkAppointmentReadiness,
  listLocations, findSlots, holdSlot, bookAppointment, rescheduleAppointment,
  cancelAppointment, getAppointmentStatus, confirmAttendance,
  submitPassport, returnPassport, listPassportCustody, attachConfirmation, listAppointments, listAllAppointments,
} from "../../shared/visa/appointments/engine.ts";
import { runAppointmentContractTests } from "../../shared/visa/appointments/contract.ts";
// Phase 10: importing the catalog registers the payment adapters (mock + manual)
// into the payment registry as a side effect, so the resolver can look them up.
import { ensurePaymentCatalog } from "../../shared/visa/payments/catalog.ts";
import {
  getQuote, createOrder, getOrder, listOrders, createCheckout, reconcilePayment, retryPayment,
  cancelOrder, requestRefund, approveRefund, executeRefund, rejectRefund, startReviewRefund,
  listPayments, listRefunds, listInvoices, listAllOrders, listAllPayments, listAllRefunds,
  canExecutePaidService,
} from "../../shared/visa/payments/engine.ts";
import { runPaymentContractTests } from "../../shared/visa/payments/contract.ts";
// Phase 11: importing the catalog registers the execution adapters (mock API,
// mock browser, manual) into the provider registry as a side effect.
import { ensureExecutionCatalog } from "../../shared/visa/execution/catalog.ts";
import {
  startExecution, resumeExecution, pauseExecution, cancelExecution, recoverExecution,
  getExecutionStatus, resolveActionRequest, switchToManual, listExecutions, listAllExecutions, ensureExecutionPlan,
} from "../../shared/visa/execution/engine.ts";
import { runExecutionContractTests } from "../../shared/visa/execution/contract.ts";
// Phase 12: Application Tracking + Notifications + Customer Communication + Support.
import { getApplicationJourney } from "../../shared/visa/journey/projection.ts";
import { recordTimelineEvent, dispatchExistingNotifications, reconcileTimeline } from "../../shared/visa/journey/events.ts";
import { ensureTemplateCatalog, ensureRuleCatalog } from "../../shared/visa/notifications/catalog.ts";
import { ensurePreferencesForTraveler, getPreferences, updatePreferences } from "../../shared/visa/notifications/preferences.ts";
import { listForUser, markRead } from "../../shared/visa/notifications/service.ts";
import {
  createSupportTicket, listTickets, listAllTickets, getConversation, listMessages, sendMessage,
  addInternalNote, listInternalNotes, assignTicket, resolveTicket,
} from "../../shared/visa/support/engine.ts";
// Phase 13: Application Review, Consistency & Pre-Submission QA Engine.
import { runReview, listReviews, getReview, listFindings, listAllReviews, waiveFinding, dismissFinding, canSubmitApplication } from "../../shared/visa/review/engine.ts";
import { getDigitalPaymentGate, initializePostPaymentReview, startVerifierReview, verifierDecision, ceoDecisionAndRefund, listPostPaymentReviews, getPostPaymentReview } from "../../shared/visa/krosz/lockedFlow.ts";
import { ensureReviewCatalog } from "../../shared/visa/review/catalog.ts";
import { runReviewContractTests } from "../../shared/visa/review/contract.ts";
// Phase 15: Visa Discovery & Country Intelligence Engine.
import { checkEligibility, getDestinationDetail, getVisaOptionById } from "../../shared/visa/discovery/engine.ts";
import { ensureDiscoveryCatalog, listNationalities, listTravelPurposes } from "../../shared/visa/discovery/catalog.ts";
import { runDiscoveryContractTests } from "../../shared/visa/discovery/contract.ts";
// Phase 16: Intelligent Visa Application Workspace.
import { getWorkspace, startWorkspace, getReadiness, getChecklist, getProgress, getValidation, updateApplication, cancelApplication } from "../../shared/visa/workspace/engine.ts";
import { runWorkspaceContractTests } from "../../shared/visa/workspace/contract.ts";
import { finalReviewGate, enterFinalReview, startUserReview, confirmApplication, paidMutationImpact, invalidatePrice, computeMaterialHash } from "../../shared/visa/finalreview/engine.ts";
import { runFinalReviewContractTests } from "../../shared/visa/finalreview/contract.ts";
import { recordFinancialEvent, commercialTimeline } from "../../shared/visa/finalreview/ledger.ts";
// Phase 19: operations case + tracking. Importing the tracking catalog registers
// the manual + mock tracking adapters into the shared provider registry as a
// side effect (mirrors the submission catalog).
import "../../shared/visa/tracking/catalog.ts";
import {
  prepareForSubmission, listQueue, getCaseDetail, assignCase, startReview, requestInformation,
  requestDocument, flagIssue, rejectPackage, returnToApplicant, escalate, approveForSubmission,
  startSubmission, confirmManualSubmission, enterTracking, handleDecision, getOpsDashboard,
  getSupportContext, getTravelerStatus,
} from "../../shared/visa/operations/engine.ts";
import { runOperationsContractTests } from "../../shared/visa/operations/contract.ts";
// Phase 20: Traveler account, multi-traveler, trip/group, audit, settings, deletion.
import {
  listTravelers as accountListTravelers, createTraveler, updateTraveler, archiveTraveler, setPrimaryTraveler,
  getTraveler as accountGetTraveler, listPassports, addPassport, listTravelerApplications,
  listAuditEvents, getAccountDashboard, listTrips, createTrip, updateTrip, getTripProgress,
  getAccountSettings, requestAccountDeletion, cancelAccountDeletion, getDeletionStatus,
  buildSupportContext, computeCompleteness,
} from "../../shared/visa/account/engine.ts";
import { runAccountContractTests } from "../../shared/visa/account/contract.ts";
// Phase 21: Destination Discovery, Search, SEO & Conversion presentation layer.
import {
  searchDestinations, getDestinationPage, listPopularDestinations, listRelatedDestinations,
  saveDestination, unsaveDestination, listSavedDestinations, isDestinationSaved,
  getSeoFeed, listExperiments, upsertExperiment, ensurePublishCatalog,
} from "../../shared/visa/publish/engine.ts";
import { runPublishContractTests } from "../../shared/visa/publish/contract.ts";
// Phase 22: Visa Intelligence provider (Pipeworx) behind the existing discovery layer.
import {
  getVisaRequirement as intelGetRequirement, getVisaFreeDestinations, comparePassportMobility,
  getProviderHealth, resetProviderHealth, invalidateCache as intelInvalidateCache,
  listCache as intelListCache, ensureProviderSource, activeVisaIntelligenceProviderKey,
} from "../../shared/visa/intelligence/service.ts";
import { runProviderContractTests } from "../../shared/visa/intelligence/provider-contract.ts";
import { getProvider } from "../../shared/visa/intelligence/registry.ts";
// Phase 22: India-first Travel Entry Engine + Country Capability Matrix.
import { resolveTravelEntry, getValidationReport, resolveCapability, resolveCapabilityDetail } from "../../shared/visa/entry/engine.ts";
import { runEntryContractTests } from "../../shared/visa/entry/contract.ts";
import { ensureEntryCatalog } from "../../shared/visa/entry/catalog.ts";
import { runMvpEngineContractTests } from "../../shared/visa/mvp/contract.ts";
import { evaluatePassport, evaluatePhoto, evaluateEligibility as evaluateMvpEligibility, evaluateTravel, evaluateSupportingVisa, evaluateArrivalCard, aggregatePreflight, evaluateExecutionCapability } from "../../shared/visa/mvp/engine.ts";
import { evaluateVisaReadiness, rulePackCoverage } from "../../shared/visa/readiness/orchestrator.ts";
import { runReadinessContractTests } from "../../shared/visa/readiness/contract.ts";
import { runReadinessOrchestratorContractTests } from "../../shared/visa/readiness/orchestrator.contract.ts";
import {
  meetsTwoSourceRule, computeExecutionCapability, computeVerificationScore, verificationClassFromScore,
  buildVerificationSummary, listEvidenceFor, listResearchTasksFor,
  canTransitionResearch, canTransitionProvider, canCompleteResearchTaskVerified,
  staleDownstate, nextReviewDate, deriveChangeRisk,
} from "../../shared/visa/verification/engine.ts";
import {
  normalizeSourcePayload, fingerprintPayload, detectChange, shouldInvalidateVerification,
  priorityFromChangeRisk, nextReviewFromRisk, summarizeDiff, downstateOnMaterialChange,
} from "../../shared/visa/verification/change.ts";

// Best-effort intelligence pipeline trigger: runs classify→extract→validate but
// never fails the enclosing operation. The version is always returned even if AI
// extraction errors — the DocumentVersion is intact and reprocessing is idempotent.
async function processBestEffort(base44: any, svc: any, user: any, versionId: string): Promise<any> {
  try { return await processDocumentVersion(base44, svc, user, versionId); }
  catch (e: any) { console.error("visa: processDocumentVersion failed", e?.message || e); return null; }
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    // Public read actions (discovery / SEO / provider intelligence) work for
    // anonymous visitors — Phase 21/22 top-of-funnel. Everything else requires
    // an authenticated user.
    const PUBLIC_READ_ACTIONS = new Set([
      "list-destinations", "check-eligibility", "get-requirements",
      "list-nationalities", "list-travel-purposes", "discover", "get-destination-detail", "get-visa-option",
      "publish-search", "publish-destination-page", "publish-popular", "publish-related", "publish-seo-feed", "publish-list-experiments",
      "pipeworx-requirement", "pipeworx-free-destinations", "pipeworx-compare",
      "entry-get", "entry-list-capabilities", "entry-family-readiness",
    ]);
    const isPublicRead = PUBLIC_READ_ACTIONS.has(action);
    const user = await base44.auth.me().catch(() => null);
    if (!isPublicRead && !user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const svc = base44.asServiceRole;

    if (action === "list-destinations") {
      // visa catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      const destinations = await listDestinationsFromCatalog(svc);
      return Response.json({ destinations, _provenance: { source: "visa_catalog", verified: destinations.every((d: any) => Boolean(d.verified_at || d.status === "PUBLISHED")) } });
    }

    if (action === "check-eligibility") {
      // visa catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      const { nationality, residence, destination, purpose } = body;
      const routes: any[] = await svc.entities.VisaRoute.filter({
        nationality: String(nationality || "IN").toUpperCase(),
        destination: String(destination || "").toUpperCase(),
        purpose: String(purpose || "tourism").toLowerCase(),
        status: "active",
      }).catch(() => []);
      const out = resolveVisaRoute(routes, { nationality, residence, destination, purpose, travel_dates: body.travel_dates });
      return Response.json({ result: out, _provenance: { source: "dev_seed", verified: false } });
    }

    if (action === "create-application") {
      const app = await createApplication(svc, user, body);
      await recordTimelineEvent(svc, app, { event_type: "APPLICATION_CREATED", source_ref: app.id, actor_type: "TRAVELER" }).catch(() => {});
      return Response.json({ application: app });
    }

    if (action === "get-application") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try { return Response.json({ application: await getApplication(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "list-applications") {
      return Response.json({ applications: await listApplications(svc, user) });
    }

    if (action === "list-travelers") {
      return Response.json({ travelers: await listTravelers(svc, user) });
    }

    if (action === "create-traveler") {
      return Response.json({ traveler: await ensureTravelerForUser(svc, user, body) });
    }

    if (action === "get-application-progress") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const status = await getVisaRunProgress(svc, app);
        return Response.json({ application: app, status });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "approve-application") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const res = await approveVisaApplication(svc, user, app);
        await recordTimelineEvent(svc, app, { event_type: "SUBMISSION_APPROVED", actor_type: "TRAVELER" }).catch(() => {});
        return Response.json({ application: await svc.entities.VisaApplication.get(body.id), run: res.run, status: res.status });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "advance-application") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const res = await advanceVisaApplication(svc, user, app);
        return Response.json({ application: await svc.entities.VisaApplication.get(body.id), status: res.status });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "get-requirements") {
      await ensureVisaRequirements(svc).catch(() => {});
      const { destination, purpose } = body;
      if (!destination) return Response.json({ error: "destination is required" }, { status: 400 });
      return Response.json(await resolveRequirements(svc, destination, purpose || "tourism"));
    }

    if (action === "get-document-config") {
      return Response.json(getDocumentConfig());
    }

    if (action === "list-documents") {
      try { return Response.json({ documents: await listTravelerDocuments(svc, user, body.traveler_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "get-document") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try { return Response.json({ document: await getDocument(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "create-document") {
      try {
        const { document, version } = await createDocument(svc, user, body);
        const intel = await processBestEffort(base44, svc, user, version.id);
        return Response.json({ document_id: document.id, version_id: version.id, status: "AVAILABLE", document, version, intelligence: intel });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "replace-document") {
      try {
        const { document, version } = await replaceDocument(svc, user, body);
        const intel = await processBestEffort(base44, svc, user, version.id);
        return Response.json({ document_id: document.id, version_id: version.id, status: "AVAILABLE", document, version, intelligence: intel });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "delete-document") {
      try { return Response.json(await deleteDocument(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "find-reusable-documents") {
      try { return Response.json({ documents: await findReusableDocuments(svc, user, body) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "validate-document-for-application") {
      try { return Response.json(await validateDocumentForApplication(svc, user, body)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "attach-document") {
      try {
        const res = await attachDocumentToApplication(svc, user, body);
        // Phase 5: run route-specific + cross-document validation for the pinned
        // version, then refresh progress so verified state reflects findings.
        const app = res.application_document?.application_id ? await svc.entities.VisaApplication.get(res.application_document.application_id).catch(() => null) : null;
        if (app && res.application_document?.document_version_id) {
          const { getApplication } = await import("../../shared/visa/application.ts");
          try { await validateVersionForApplication(svc, user, res.application_document.document_version_id, await getApplication(svc, user, app.id)); } catch {}
          try { await analyzeApplicationDocuments(base44, svc, user, await getApplication(svc, user, app.id)); } catch {}
        }
        const { computeRequirementProgress } = await import("../../shared/visa/documents.ts");
        const progress = app ? await computeRequirementProgress(svc, app) : res.progress;
        return Response.json({ ...res, progress });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "TYPE_MISMATCH" ? 400 : 500 }); }
    }

    if (action === "detach-document") {
      try { return Response.json(await detachDocument(svc, user, body)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "list-application-documents") {
      try { return Response.json(await listApplicationDocuments(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "process-document") {
      if (!body.version_id) return Response.json({ error: "version_id is required" }, { status: 400 });
      try { return Response.json({ intelligence: await processDocumentVersion(base44, svc, user, body.version_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "get-document-intelligence") {
      if (!body.version_id) return Response.json({ error: "version_id is required" }, { status: 400 });
      try { return Response.json(await getDocumentIntelligence(svc, user, body.version_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "mvp-record-document-engine-result") {
      if (!body.version_id || !body.engine || !body.result) return Response.json({ error: "version_id, engine and result are required" }, { status: 400 });
      try {
        // getDocumentIntelligence performs the authoritative ownership check.
        const current: any = await getDocumentIntelligence(svc, user, body.version_id);
        const intel = current?.intelligence;
        if (!intel?.id) return Response.json({ error: "Document intelligence record not found", code: "NOT_FOUND" }, { status: 404 });
        const engine = String(body.engine).slice(0, 80);
        const source = `mvp_${engine}`;
        const result = body.result || {};
        const existingMeta = intel.metadata || {};
        const engineResults = { ...(existingMeta.mvp_engine_results || {}), [engine]: { status: result.status, score: result.score, checks: result.checks || [], data: result.data || null, recorded_at: new Date().toISOString() } };
        await svc.entities.DocumentFinding.deleteMany({ document_version_id: body.version_id, source }).catch(() => {});
        for (const x of (result.checks || [])) {
          if (x.status === "PASS" || x.status === "NOT_APPLICABLE") continue;
          const isBlocking = x.status === "BLOCKING";
          await svc.entities.DocumentFinding.create({
            document_version_id: body.version_id, document_id: intel.document_id, intelligence_id: intel.id, application_id: body.application_id || null,
            type: "QUALITY_ISSUE", severity: isBlocking ? "HIGH" : "MEDIUM", blocking: isBlocking,
            field: null, message: x.customer_message || x.title || x.check_id, code: x.check_id || `${engine}_CHECK`, source, resolved: false,
            metadata: { engine, status: x.status, evidence: x.evidence || null, policy_version: x.policy_version || null },
          }).catch(() => {});
        }
        const unresolved: any[] = await svc.entities.DocumentFinding.filter({ document_version_id: body.version_id, resolved: false }).catch(() => []);
        const otherBlocking = unresolved.filter((f: any) => f.blocking);
        const hasMvpReview = unresolved.some((f: any) => String(f.source || "").startsWith("mvp_") && !f.blocking);
        const nextStatus = (otherBlocking.length || hasMvpReview) ? "needs_review" : (intel.status === "processing_failed" ? "processing_failed" : "ready");
        await svc.entities.DocumentIntelligence.update(intel.id, { metadata: { ...existingMeta, mvp_engine_results: engineResults }, status: nextStatus, needs_review: nextStatus === "needs_review", review_reason: nextStatus === "needs_review" ? "mvp_engine_findings" : null });
        return Response.json({ ok: true, engine, status: nextStatus, blocking_findings: otherBlocking.length, review_findings: unresolved.length - otherBlocking.length });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    // ---------- PHASE 17: Document Intelligence lifecycle & resolution ----------
    if (action === "confirm-extraction") {
      if (!body.version_id || !body.confirmed) return Response.json({ error: "version_id and confirmed required" }, { status: 400 });
      try { return Response.json(await confirmExtraction(svc, user, body.version_id, body.confirmed)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }
    if (action === "retry-processing") {
      if (!body.version_id) return Response.json({ error: "version_id required" }, { status: 400 });
      try { return Response.json({ intelligence: await retryProcessing(base44, svc, user, body.version_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "detect-duplicates") {
      try {
        let travelerId = body.traveler_id;
        if (!travelerId) { const t = await ensureTravelerForUser(svc, user, {}); travelerId = t.id; }
        return Response.json(await detectDuplicates(svc, user, travelerId));
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "propose-prefill") {
      if (!body.id || !body.version_id) return Response.json({ error: "id and version_id required" }, { status: 400 });
      try { return Response.json(await proposePrefill(svc, await getApplication(svc, user, body.id), body.version_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "apply-prefill") {
      if (!body.id || !body.version_id) return Response.json({ error: "id and version_id required" }, { status: 400 });
      try { return Response.json(await applyPrefill(svc, user, await getApplication(svc, user, body.id), body.version_id, { question_codes: body.question_codes, overwrite_non_user: body.overwrite_non_user })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "get-resolution-center") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getResolutionCenter(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "run-intelligence-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runIntelligenceContractTests());
    }

    if (action === "validate-application-documents") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const { getApplication } = await import("../../shared/visa/application.ts");
        const { computeRequirementProgress } = await import("../../shared/visa/documents.ts");
        const app = await getApplication(svc, user, body.id);
        const attachments: any[] = await svc.entities.ApplicationDocument.filter({ application_id: app.id }).catch(() => []);
        for (const a of attachments) {
          if (a.status !== "detached") { try { await validateVersionForApplication(svc, user, a.document_version_id, app); } catch {} }
        }
        await analyzeApplicationDocuments(base44, svc, user, app);
        return Response.json({ application: app, progress: await computeRequirementProgress(svc, app) });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "get-questions") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id }).catch(() => []);
        return Response.json(await resolveQuestionSet(svc, app, answers));
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "get-answers") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try { return Response.json(await listAnswers(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "put-answer") {
      if (!body.id || !body.question_code) return Response.json({ error: "id and question_code are required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const res = await upsertAnswer(svc, user, app, body.question_code, body.value, { confirm: !!body.confirm });
        // Best-effort orchestrator unlock after each answer change.
        await completeApplicationInformationSignal(svc, user, app).catch(() => {});
        return Response.json(res);
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "UNKNOWN_QUESTION" ? 400 : 500 }); }
    }

    if (action === "bulk-answers") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const res = await bulkUpsertAnswers(svc, user, app, body.answers || {});
        await completeApplicationInformationSignal(svc, user, app).catch(() => {});
        return Response.json(res);
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "check-readiness") {
      if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const readiness = await checkApplicationReadiness(svc, app);
        const traveler: any = app.traveler_id ? await svc.entities.Traveler.get(app.traveler_id).catch(() => null) : null;
        const ext = body.extended_context || {};
        const extendedReadiness = evaluateVisaReadiness({
          country: app.destination,
          nationality: traveler?.nationality || app.nationality || "IN",
          departure_country: ext.departure_country || "IN",
          purpose: app.purpose || "tourism",
          travel: { arrival: app.travel_start, departure: app.travel_end, ...(ext.travel || {}) },
          financial: ext.financial || {},
          eligibility: {
            nationality: traveler?.nationality || app.nationality || "IN",
            residence_country: traveler?.residence_country || ext.eligibility?.residence_country,
            date_of_birth: traveler?.date_of_birth || ext.eligibility?.date_of_birth,
            travel_date: app.travel_start,
            purpose: app.purpose || "tourism",
            ...(ext.eligibility || {}),
          },
          health: ext.health || {},
          qualifying_third_country_status: ext.qualifying_third_country_status || null,
        });
        // Existing readiness remains authoritative while Engines 9-12 are rolled in;
        // extended_readiness is now always returned and can hard-block the payment /
        // submission gate once the application has supplied the required evidence.
        if (readiness.ready) await completeApplicationInformationSignal(svc, user, app).catch(() => {});
        return Response.json({ ...readiness, extended_readiness: extendedReadiness });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "seed-questions") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(await ensureQuestionCatalog(svc));
    }

    // ---------- PHASE 7: Government Form Engine ----------
    if (action === "list-forms") {
      await ensureFormCatalog(svc).catch(() => {});
      return Response.json({ forms: await listFormDefinitions(svc, body) });
    }

    if (action === "get-form") {
      if (!body.form_definition_id) return Response.json({ error: "form_definition_id required" }, { status: 400 });
      const form = await svc.entities.GovernmentFormDefinition.get(body.form_definition_id).catch(() => null);
      if (!form) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ form, fields: await getFormFields(svc, body.form_definition_id), mappings: await getFormMappings(svc, body.form_definition_id) });
    }

    if (action === "resolve-form") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const app = await getApplication(svc, user, body.id);
      return Response.json({ form: await resolveFormForApplication(svc, app) });
    }

    if (action === "generate-form") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const formId = body.form_definition_id || (await resolveFormForApplication(svc, await getApplication(svc, user, body.id)))?.id;
      if (!formId) return Response.json({ error: "No matching form" }, { status: 404 });
      try { return Response.json(await generateGovernmentForm(svc, user, body.id, formId)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "check-form-staleness") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const formId = body.form_definition_id || (await resolveFormForApplication(svc, app))?.id;
        const snapshot = formId ? await getLatestSnapshot(svc, app, formId) : null;
        if (!snapshot) return Response.json({ stale: false, snapshot: null });
        return Response.json({ ...(await checkSnapshotStaleness(svc, app, snapshot)), snapshot });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-snapshots") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const snapshots: any[] = await svc.entities.ApplicationFormSnapshot.filter({ application_id: app.id }).catch(() => []);
        snapshots.sort((a, b) => String(b.generated_at || "").localeCompare(String(a.generated_at || "")));
        return Response.json({ snapshots });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "export-snapshot") {
      if (!body.snapshot_id) return Response.json({ error: "snapshot_id required" }, { status: 400 });
      const snap: any = await svc.entities.ApplicationFormSnapshot.get(body.snapshot_id).catch(() => null);
      if (!snap) return Response.json({ error: "Not found" }, { status: 404 });
      const app = await getApplication(svc, user, snap.application_id);
      return Response.json({ exported: exportSnapshot(snap, body.format || "json") });
    }

    if (action === "build-package") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const formId = body.form_definition_id || (await resolveFormForApplication(svc, await getApplication(svc, user, body.id)))?.id;
      if (!formId) return Response.json({ error: "No matching form" }, { status: 404 });
      try { return Response.json(await buildSubmissionPackage(svc, user, body.id, formId)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-packages") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ packages: await listSubmissionPackages(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "put-override") {
      if (!body.id || !body.form_definition_id || !body.field_code || body.value == null) return Response.json({ error: "id, form_definition_id, field_code, value required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const existing: any[] = await svc.entities.GovernmentFieldOverride.filter({ application_id: app.id, form_definition_id: body.form_definition_id, field_code: body.field_code, superseded: false }).catch(() => []);
        for (const o of existing) await svc.entities.GovernmentFieldOverride.update(o.id, { superseded: true }).catch(() => {});
        const row = await svc.entities.GovernmentFieldOverride.create({ application_id: app.id, traveler_id: app.traveler_id, form_definition_id: body.form_definition_id, field_code: body.field_code, value: String(body.value), reason: body.reason || "", created_by: user.id || user.email || "system", superseded: false, metadata: {} });
        return Response.json({ override: row });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    // ---------- PHASE 8: Submission Provider / Portal Adapter ----------
    if (action === "list-submission-providers") {
      await ensureSubmissionCatalog(svc).catch(() => {});
      const providers: any[] = await svc.entities.Provider.filter({ category: "submission" }).catch(() => []);
      const routes: any[] = await svc.entities.SubmissionRoute.filter({ status: "active" }).catch(() => []);
      return Response.json({ providers: providers.map((p) => ({ ...p, credentials: undefined })), routes });
    }

    if (action === "list-submission-routes") {
      await ensureSubmissionCatalog(svc).catch(() => {});
      return Response.json({ routes: await svc.entities.SubmissionRoute.filter({ status: "active" }).catch(() => []) });
    }

    if (action === "resolve-submission-provider") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const pkg = await getLatestReadyPackage(svc, app);
        if (!pkg) return Response.json({ error: "No submission package", code: "NO_PACKAGE" }, { status: 400 });
        const { resolved } = await resolveProviderForApplication(svc, app, pkg);
        return Response.json({
          provider_id: resolved.provider_id, provider_key: resolved.provider_key, provider_type: resolved.provider_type,
          channel: resolved.channel, capabilities: resolved.capabilities, environment: resolved.environment,
          appointment_required: resolved.appointment_required, appointment_location: resolved.appointment_location,
          idempotency_key: resolved.idempotency_key, package_hash: pkg.package_hash, package_status: pkg.status,
        });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "approve-submission") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await approveSubmission(svc, user, app)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "create-submission") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const out = await createSubmission(svc, user, app);
        await recordTimelineEvent(svc, app, { event_type: "SUBMISSION_STARTED", source_ref: out?.submission?.id || out?.id, actor_type: "SYSTEM" }).catch(() => {});
        return Response.json(out);
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_APPROVED" || e.code === "NO_PACKAGE" || e.code === "PACKAGE_STALE" || e.code === "PACKAGE_MODIFIED" || e.code === "NO_SUBMISSION_PROVIDER" ? 400 : 500 }); }
    }

    if (action === "submit-submission") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        // Phase 13 (§56): final server-side review gate immediately before submission.
        const gate = await canSubmitApplication(base44, svc, user, body.id).catch(() => null);
        if (gate && !gate.allowed) return Response.json({ error: "REVIEW_BLOCKED", code: "REVIEW_BLOCKED", reasons: gate.reasons, review: gate.review }, { status: 400 });
        const out = await submitSubmission(svc, user, app);
        const sub = out?.submission || out;
        await recordTimelineEvent(svc, app, { event_type: "SUBMISSION_COMPLETED", source_ref: sub?.id, actor_type: "SYSTEM", metadata: { external_reference: sub?.external_reference } }).catch(() => {});
        return Response.json(out);
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "get-submission-status") {
      if (!body.submission_id) return Response.json({ error: "submission_id required" }, { status: 400 });
      try { return Response.json(await getSubmissionStatus(svc, user, body.submission_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "enter-external-reference") {
      if (!body.submission_id || !body.external_reference) return Response.json({ error: "submission_id and external_reference required" }, { status: 400 });
      try { return Response.json(await enterExternalReference(svc, user, body.submission_id, body.external_reference)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "upload-receipt") {
      if (!body.submission_id || !body.storage_uri || !body.mime_type) return Response.json({ error: "submission_id, storage_uri, mime_type required" }, { status: 400 });
      try { return Response.json(await uploadReceipt(svc, user, body.submission_id, { storage_uri: body.storage_uri, mime_type: body.mime_type, file_size: Number(body.file_size || 0), display_name: body.display_name })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "cancel-submission") {
      if (!body.submission_id) return Response.json({ error: "submission_id required" }, { status: 400 });
      try { return Response.json(await cancelSubmission(svc, user, body.submission_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-submissions") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ submissions: await listSubmissions(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "get-submission") {
      if (!body.submission_id) return Response.json({ error: "submission_id required" }, { status: 400 });
      try { return Response.json(await getSubmission(svc, user, body.submission_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "check-package-integrity") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const pkg = await getLatestReadyPackage(svc, app);
        if (!pkg) return Response.json({ valid: false, reason: "NO_PACKAGE" });
        const integrity = await verifyPackageIntegrity(svc, pkg);
        const stale = await checkPackageStale(svc, app, pkg);
        return Response.json({ integrity, stale, package: { status: pkg.status, package_hash: pkg.package_hash, version: pkg.version } });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "run-submission-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runSubmissionContractTests(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, stack: e?.stack }, { status: 500 }); }
    }

    if (action === "seed-submission-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensureSubmissionCatalog(svc) });
    }

    // ---------- PHASE 9: Appointment + VAC/Embassy Operations ----------
    if (action === "get-appointment-requirements") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json({ requirements: await ensureAppointmentRequirements(svc, app) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "check-appointment-readiness") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await checkAppointmentReadiness(svc, app)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-appointment-locations") {
      if (!body.id || !body.requirement_id) return Response.json({ error: "id and requirement_id required" }, { status: 400 });
      try { return Response.json(await listLocations(svc, user, body.id, body.requirement_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "find-appointment-slots") {
      if (!body.id || !body.requirement_id || !body.external_location_id) return Response.json({ error: "id, requirement_id, external_location_id required" }, { status: 400 });
      try { return Response.json(await findSlots(svc, user, { application_id: body.id, requirement_id: body.requirement_id, external_location_id: body.external_location_id, date_from: body.date_from, date_to: body.date_to })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "INVALID_LOCATION" ? 400 : 500 }); }
    }

    if (action === "hold-appointment-slot") {
      if (!body.id || !body.slot_id) return Response.json({ error: "id and slot_id required" }, { status: 400 });
      try { return Response.json(await holdSlot(svc, user, { application_id: body.id, slot_id: body.slot_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "book-appointment") {
      if (!body.id || !body.requirement_id || !body.slot_id) return Response.json({ error: "id, requirement_id, slot_id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const out: any = await bookAppointment(svc, user, { application_id: body.id, requirement_id: body.requirement_id, slot_id: body.slot_id });
        const appt = out?.appointment || out;
        await recordTimelineEvent(svc, app, { event_type: "APPOINTMENT_BOOKED", source_ref: appt?.id, actor_type: "TRAVELER", metadata: { appointment: { date: appt?.scheduled_at || appt?.date, location: appt?.location_name } } }).catch(() => {});
        return Response.json(out);
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "SLOT_EXPIRED" || e.code === "SLOT_UNAVAILABLE" || e.code === "NO_APPOINTMENT_PROVIDER" ? 400 : 500 }); }
    }

    if (action === "reschedule-appointment") {
      if (!body.appointment_id || !body.new_slot_id) return Response.json({ error: "appointment_id and new_slot_id required" }, { status: 400 });
      try { return Response.json(await rescheduleAppointment(svc, user, { appointment_id: body.appointment_id, new_slot_id: body.new_slot_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "cancel-appointment") {
      if (!body.appointment_id) return Response.json({ error: "appointment_id required" }, { status: 400 });
      try { return Response.json(await cancelAppointment(svc, user, body.appointment_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "get-appointment-status") {
      if (!body.appointment_id) return Response.json({ error: "appointment_id required" }, { status: 400 });
      try { return Response.json(await getAppointmentStatus(svc, user, body.appointment_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "confirm-attendance") {
      if (!body.appointment_id || !body.outcome) return Response.json({ error: "appointment_id and outcome required" }, { status: 400 });
      if (!["COMPLETED", "NO_SHOW", "ISSUE"].includes(body.outcome)) return Response.json({ error: "Invalid outcome" }, { status: 400 });
      try { return Response.json(await confirmAttendance(svc, user, body.appointment_id, body.outcome)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "submit-passport") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await submitPassport(svc, user, { application_id: body.id, location: body.location, external_reference: body.external_reference, appointment_id: body.appointment_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "return-passport") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await returnPassport(svc, user, { application_id: body.id, location: body.location, external_reference: body.external_reference })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-passport-custody") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ custody: await listPassportCustody(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "attach-appointment-confirmation") {
      if (!body.appointment_id || !body.storage_uri || !body.mime_type || !body.file_size) return Response.json({ error: "appointment_id, storage_uri, mime_type, file_size required" }, { status: 400 });
      try { return Response.json(await attachConfirmation(svc, user, body.appointment_id, { storage_uri: body.storage_uri, mime_type: body.mime_type, file_size: Number(body.file_size), display_name: body.display_name })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-appointments") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await listAppointments(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "ops-list-appointments") {
      try { return Response.json({ appointments: await listAllAppointments(svc, user, { status: body.status, from: body.from, to: body.to }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    if (action === "seed-appointment-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensureAppointmentCatalog(svc) });
    }

    // ---------- PHASE 10: Payments, Pricing, Orders & Refunds ----------
    if (action === "get-quote") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await getQuote(svc, app)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "get-payment-gate") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await getDigitalPaymentGate(base44, svc, user, app)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "create-order") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const gate = await getDigitalPaymentGate(base44, svc, user, app);
        if (!gate.allowed) return Response.json({ error: "DIGITAL_PAYMENT_GATE_BLOCKED", code: "DIGITAL_PAYMENT_GATE_BLOCKED", gate }, { status: 409 });
        const quote = await getQuote(svc, app);
        const order = await createOrder(svc, user, app, { client_total_minor: body.client_total_minor, optional_services: body.optional_services });
        return Response.json({ ...order, gate, quote });
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, server_total_minor: e.server_total_minor }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "PRICE_TAMPERING" ? 400 : 500 }); }
    }

    if (action === "get-order") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json(await getOrder(svc, user, body.order_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "list-orders") {
      try { return Response.json({ orders: await listOrders(svc, user, { application_id: body.application_id, traveler_id: body.traveler_id }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "create-checkout") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json(await createCheckout(svc, user, body.order_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, failure_category: e.failure_category }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "reconcile-payment") {
      if (!body.payment_id) return Response.json({ error: "payment_id required" }, { status: 400 });
      try {
        const out: any = await reconcilePayment(svc, user, { payment_id: body.payment_id, confirmed: !!body.confirmed, external_reference: body.external_reference, provider_event: body.provider_event });
        const pay = out?.payment || out;
        if (pay && ["SUCCEEDED", "AUTHORIZED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(pay.status)) {
          // Best-effort: record a payment-complete timeline event for the application.
          const payRow: any = await svc.entities.Payment.get(body.payment_id).catch(() => pay);
          const appId = payRow?.application_id;
          if (appId) {
            const app = await getApplication(svc, user, appId).catch(() => null);
            if (app) {
              await recordTimelineEvent(svc, app, { event_type: "PAYMENT_COMPLETED", source_ref: payRow?.order_id || body.payment_id, actor_type: "SYSTEM" }).catch(() => {});
              const orderRow: any = payRow?.order_id ? await svc.entities.Order.get(payRow.order_id).catch(() => null) : null;
              if (orderRow && payRow?.status === "SUCCEEDED") await initializePostPaymentReview(svc, user, app, payRow, orderRow).catch(() => null);
            }
          }
        }
        return Response.json(out);
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "retry-payment") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json(await retryPayment(svc, user, body.order_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "cancel-order") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json(await cancelOrder(svc, user, body.order_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "request-refund") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json(await requestRefund(svc, user, body.order_id, { amount_minor: body.amount_minor, type: body.type, reason: body.reason, reason_detail: body.reason_detail, components: body.components })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "approve-refund") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.refund_id) return Response.json({ error: "refund_id required" }, { status: 400 });
      try { return Response.json(await approveRefund(svc, user, body.refund_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    if (action === "execute-refund") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.refund_id) return Response.json({ error: "refund_id required" }, { status: 400 });
      try {
        const res = await executeRefund(svc, user, body.refund_id);
        const r: any = res?.refund;
        if (r?.status === "COMPLETED" && r.application_id) {
          const app = await svc.entities.VisaApplication.get(r.application_id).catch(() => null);
          if (app) await recordFinancialEvent(svc, app, "REFUND_SUCCEEDED", { order_id: r.order_id, payment_id: r.payment_id, refund_id: r.id, amount_minor: r.amount_minor, currency: r.currency }).catch(() => {});
        }
        return Response.json(res);
      }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    // ---------- KROSZ LOCKED MVP: post-payment Visa Approver Manager + CEO exception/refund ----------
    if (action === "ops-list-post-payment-reviews") {
      try { return Response.json({ reviews: await listPostPaymentReviews(svc, user, body.filters || {}) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "ops-get-post-payment-review") {
      if (!body.review_id) return Response.json({ error: "review_id required" }, { status: 400 });
      try { return Response.json(await getPostPaymentReview(svc, user, body.review_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "ops-start-verifier-review") {
      if (!body.review_id) return Response.json({ error: "review_id required" }, { status: 400 });
      try { return Response.json({ review: await startVerifierReview(svc, user, body.review_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "ops-verifier-decision") {
      if (!body.review_id || !body.decision) return Response.json({ error: "review_id and decision required" }, { status: 400 });
      try { return Response.json({ review: await verifierDecision(svc, user, body.review_id, body.decision, body.reason_code || "", body.reason || "") }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "ops-ceo-decision") {
      if (!body.review_id || typeof body.approve_refund !== "boolean") return Response.json({ error: "review_id and approve_refund required" }, { status: 400 });
      try { return Response.json(await ceoDecisionAndRefund(svc, user, body.review_id, body.approve_refund, body.reason || "")); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-payments") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json({ payments: await listPayments(svc, user, body.order_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-refunds") {
      if (!body.order_id) return Response.json({ error: "order_id required" }, { status: 400 });
      try { return Response.json({ refunds: await listRefunds(svc, user, body.order_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-invoices") {
      try { return Response.json({ invoices: await listInvoices(svc, user, body.order_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "can-execute-paid-service") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await canExecutePaidService(svc, app, body.service || "submission")); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    // ---------- Admin financial views ----------
    if (action === "admin-list-orders") {
      try { return Response.json({ orders: await listAllOrders(svc, user, { status: body.status }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }
    if (action === "admin-list-payments") {
      try { return Response.json({ payments: await listAllPayments(svc, user, { status: body.status }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }
    if (action === "admin-list-refunds") {
      try { return Response.json({ refunds: await listAllRefunds(svc, user) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }
    if (action === "admin-list-invoices") {
      try { return Response.json({ invoices: await listInvoices(svc, user) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }

    if (action === "seed-payment-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensurePaymentCatalog(svc) });
    }
    if (action === "run-payment-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runPaymentContractTests(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, stack: e?.stack }, { status: 500 }); }
    }

    // ---------- PHASE 11: Submission Execution / Browser Agent ----------
    if (action === "execution-start") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await startExecution(svc, user, app, { behaviors: body.behaviors, workerId: body.worker_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "EXECUTION_ALREADY_ACTIVE" || e.code === "PAYMENT_REQUIRED" || e.code === "APPOINTMENT_REQUIRED" || e.code === "PACKAGE_STALE" || e.code === "PACKAGE_MODIFIED" || e.code === "NOT_APPROVED" || e.code === "POLICY_RESTRICTION" ? 400 : 500 }); }
    }

    if (action === "execution-resume") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await resumeExecution(svc, user, body.session_id, { resolution: body.resolution, workerId: body.worker_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "EXECUTION_ALREADY_ACTIVE" ? 409 : 400 }); }
    }

    if (action === "execution-pause") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await pauseExecution(svc, user, body.session_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "execution-cancel") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await cancelExecution(svc, user, body.session_id, body.reason || "operator_cancel")); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "execution-recover") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await recoverExecution(svc, user, body.session_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "execution-status") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await getExecutionStatus(svc, user, body.session_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "execution-list") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ sessions: await listExecutions(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "execution-plan") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json({ plan: await ensureExecutionPlan(svc, user, app) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "execution-resolve-action") {
      if (!body.action_request_id || !body.resolution_action) return Response.json({ error: "action_request_id and resolution_action required" }, { status: 400 });
      try { return Response.json(await resolveActionRequest(svc, user, body.action_request_id, body.resolution_action, body.detail)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "execution-switch-manual") {
      if (!body.session_id) return Response.json({ error: "session_id required" }, { status: 400 });
      try { return Response.json(await switchToManual(svc, user, body.session_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "ops-list-executions") {
      try { return Response.json({ sessions: await listAllExecutions(svc, user, { status: body.status }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }

    if (action === "seed-execution-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensureExecutionCatalog(svc) });
    }

    if (action === "run-execution-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runExecutionContractTests(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, stack: e?.stack }, { status: 500 }); }
    }

    if (action === "run-appointment-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runAppointmentContractTests(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, stack: e?.stack }, { status: 500 }); }
    }

    if (action === "validate-form-publish") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(await validateFormForPublish(svc, body.form_definition_id));
    }

    // ---------- PHASE 12: Application Tracking, Notifications & Support ----------
    if (action === "get-application-journey") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getApplicationJourney(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "refresh-journey") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        // Rebuild timeline + dispatch any pending notifications for live feel (§83).
        const { checkApplicationReadiness } = await import("../../shared/visa/questions.ts");
        const { computeRequirementProgress } = await import("../../shared/visa/documents.ts");
        const { listAppointments } = await import("../../shared/visa/appointments/engine.ts");
        const { listSubmissions, getLatestReadyPackage } = await import("../../shared/visa/submission/engine.ts");
        const { listOrders, canExecutePaidService } = await import("../../shared/visa/payments/engine.ts");
        const readiness = await checkApplicationReadiness(svc, app).catch(() => null);
        const requirementProgress = await computeRequirementProgress(svc, app).catch(() => null);
        const appointments = await listAppointments(svc, user, app.id).then((r:any) => r.appointments || []).catch(() => []);
        const submissions = await listSubmissions(svc, user, app.id).then((r:any) => r.submissions || []).catch(() => []);
        const pkgs = await getLatestReadyPackage(svc, app).catch(() => null);
        const orders = await listOrders(svc, user, { application_id: app.id }).then((r:any) => r.orders || []).catch(() => []);
        const canSubmit = await canExecutePaidService(svc, app, "submission").catch(() => null);
        const appointmentBooked = appointments.some((a:any) => ["BOOKED","SCHEDULED","CONFIRMED","ATTENDED"].includes(a.status));
        const paidOrder = orders.find((o:any) => ["PAID","PARTIALLY_PAID","COMPLETED"].includes(o.status));
        const paymentRequired = !!canSubmit && !canSubmit.allowed && (canSubmit.gate||"").includes("PAYMENT") && !paidOrder;
        const ctx = { readiness, requirementProgress, appointments, submissions, packages: pkgs?[pkgs]:[], orders, canSubmit, appointmentRequired: !!app.appointment_required, appointmentBooked, payment: { required: paymentRequired, paid: !!paidOrder, order_id: paidOrder?.id } };
        await reconcileTimeline(svc, app, ctx).catch(() => {});
        await dispatchExistingNotifications(svc, app).catch(() => {});
        return Response.json(await getApplicationJourney(svc, user, body.id));
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-actions") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        await getApplicationJourney(svc, user, body.id).catch(() => {}); // recompute actions
        const actions: any[] = await svc.entities.ApplicationAction.filter({ application_id: body.id, status: "OPEN" }).catch(() => []);
        return Response.json({ actions });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "complete-action") {
      if (!body.action_id) return Response.json({ error: "action_id required" }, { status: 400 });
      try {
        const a: any = await svc.entities.ApplicationAction.get(body.action_id).catch(() => null);
        if (!a) return Response.json({ error: "Not found" }, { status: 404 });
        if (a.created_by_id !== user.id && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
        await svc.entities.ApplicationAction.update(body.action_id, { status: "COMPLETED", completed_at: new Date().toISOString() });
        return Response.json({ id: body.action_id, status: "COMPLETED" });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-notifications") {
      try { return Response.json({ notifications: await listForUser(svc, user, { status: body.status, limit: body.limit }) }); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    if (action === "mark-notification-read") {
      if (!body.notification_id) return Response.json({ error: "notification_id required" }, { status: 400 });
      try { return Response.json(await markRead(svc, user, body.notification_id, false)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }

    if (action === "archive-notification") {
      if (!body.notification_id) return Response.json({ error: "notification_id required" }, { status: 400 });
      try { return Response.json(await markRead(svc, user, body.notification_id, true)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "get-notification-preferences") {
      try {
        let travelerId = body.traveler_id;
        if (!travelerId) { const t = await ensureTravelerForUser(svc, user, {}); travelerId = t.id; }
        return Response.json(await ensurePreferencesForTraveler(svc, travelerId));
      } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    if (action === "set-notification-preferences") {
      try {
        let travelerId = body.traveler_id;
        if (!travelerId) { const t = await ensureTravelerForUser(svc, user, {}); travelerId = t.id; }
        const rows: any[] = await svc.entities.VisaNotificationPreference.filter({ traveler_id: travelerId }).catch(() => []);
        const cur = rows[0];
        const patch = body.patch || {};
        const merged = { ...(cur || {}), ...patch };
        if (cur) await svc.entities.VisaNotificationPreference.update(cur.id, merged).catch(() => {});
        else await svc.entities.VisaNotificationPreference.create({ traveler_id: travelerId, ...merged }).catch(() => {});
        return Response.json(await ensurePreferencesForTraveler(svc, travelerId));
      } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    // ---------- Support (tickets, conversations, internal notes) ----------
    if (action === "create-support-ticket") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { const app = await getApplication(svc, user, body.id); return Response.json(await createSupportTicket(svc, user, app, { category: body.category, priority: body.priority, subject: body.subject, message: body.message, attachments: body.attachments })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-support-tickets") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ tickets: await listTickets(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "list-conversation-messages") {
      if (!body.conversation_id) return Response.json({ error: "conversation_id required" }, { status: 400 });
      try { return Response.json({ messages: await listMessages(svc, user, body.conversation_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "send-support-message") {
      if (!body.conversation_id || !body.body) return Response.json({ error: "conversation_id and body required" }, { status: 400 });
      try { return Response.json(await sendMessage(svc, user, body.conversation_id, { body: body.body, attachments: body.attachments })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "list-internal-notes") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ notes: await listInternalNotes(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "add-internal-note") {
      if (!body.id || !body.body) return Response.json({ error: "id and body required" }, { status: 400 });
      try { return Response.json(await addInternalNote(svc, user, body.id, { body: body.body, ticket_id: body.ticket_id, pinned: body.pinned })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "assign-ticket") {
      if (!body.ticket_id) return Response.json({ error: "ticket_id required" }, { status: 400 });
      try { return Response.json(await assignTicket(svc, user, body.ticket_id, body.assignee_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "resolve-ticket") {
      if (!body.ticket_id) return Response.json({ error: "ticket_id required" }, { status: 400 });
      try { return Response.json(await resolveTicket(svc, user, body.ticket_id, { resolution: body.resolution })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "admin-list-support-tickets") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json({ tickets: await listAllTickets(svc, user, { status: body.status, priority: body.priority }) }); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    // ---------- PHASE 13: Application Review & Submission QA ----------
    if (action === "run-review") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const out = await runReview(base44, svc, user, app, { trigger: body.trigger || "MANUAL_REVIEW", ai: body.ai });
        return Response.json({ review: out.review, findings: out.findings, cached: out.cached });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "list-reviews") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ reviews: await listReviews(svc, user, body.id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }

    if (action === "get-review") {
      if (!body.review_id) return Response.json({ error: "review_id required" }, { status: 400 });
      try { return Response.json(await getReview(svc, user, body.review_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "list-review-findings") {
      if (!body.review_id) return Response.json({ error: "review_id required" }, { status: 400 });
      try { return Response.json({ findings: await listFindings(svc, user, body.review_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }

    if (action === "can-submit-application") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await canSubmitApplication(base44, svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }

    if (action === "waive-review-finding") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.finding_id) return Response.json({ error: "finding_id required" }, { status: 400 });
      try { return Response.json(await waiveFinding(svc, user, body.finding_id, body.reason)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    if (action === "dismiss-review-finding") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.finding_id) return Response.json({ error: "finding_id required" }, { status: 400 });
      try { return Response.json(await dismissFinding(svc, user, body.finding_id, body.reason)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }

    if (action === "admin-list-reviews") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json({ reviews: await listAllReviews(svc, user, { status: body.status }) }); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    if (action === "seed-review-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensureReviewCatalog(svc) });
    }

    if (action === "run-review-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runReviewContractTests()); }
      catch (e: any) { return Response.json({ error: e.message, stack: e?.stack }, { status: 500 }); }
    }

    if (action === "ensure-journey-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      await ensureTemplateCatalog(svc);
      await ensureRuleCatalog(svc);
      return Response.json({ ok: true });
    }

    // ---------- PHASE 16: Intelligent Visa Application Workspace ----------
    if (action === "get-workspace") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getWorkspace(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "start-workspace") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await startWorkspace(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "get-readiness") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getReadiness(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "get-checklist") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getChecklist(svc, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "get-progress") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getProgress(svc, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "get-validation") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getValidation(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "update-application") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ application: await updateApplication(svc, user, await getApplication(svc, user, body.id), body.patch || {}) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "cancel-application") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ application: await cancelApplication(svc, user, await getApplication(svc, user, body.id)) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "BAD_STATE" ? 409 : 400 }); }
    }
    if (action === "run-workspace-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runWorkspaceContractTests());
    }

    // ---------- PHASE 18: Final Review, Confirmation, Pricing & Mutation ----------
    if (action === "get-final-review") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const gate = await finalReviewGate(svc, app);
        const quote = await getQuote(svc, app).catch(() => null);
        const version = app.application_version || 1;
        const confirmations: any[] = await svc.entities.ApplicationConfirmation.filter({ application_id: app.id, application_version: version }).catch(() => []);
        const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
        return Response.json({
          application: app,
          gate,
          quote,
          confirmation: confirmations[0] || null,
          material_hash: computeMaterialHash(app, answers),
        });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "enter-final-review") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ application: await enterFinalReview(svc, await getApplication(svc, user, body.id)) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "start-user-review") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json({ application: await startUserReview(svc, await getApplication(svc, user, body.id)) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "confirm-application") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await confirmApplication(svc, user, await getApplication(svc, user, body.id))); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code, reasons: e.reasons }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_READY" ? 400 : 500 }); }
    }
    if (action === "get-paid-mutation-impact") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const answers: any[] = await svc.entities.ApplicationAnswer.filter({ application_id: app.id, active: true }).catch(() => []);
        const newHash = computeMaterialHash(app, answers);
        const orders: any[] = await svc.entities.Order.filter({ application_id: app.id }).catch(() => []);
        const hasPaidOrder = orders.some((o) => ["PAID", "COMPLETED", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(o.status));
        const impact = paidMutationImpact(app, newHash, hasPaidOrder);
        return Response.json({ impact, has_paid_order: hasPaidOrder, current_hash: newHash, priced_hash: app.final_review?.material_hash || null });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "invalidate-priced-context") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await invalidatePrice(svc, await getApplication(svc, user, body.id), body.reason || "material_change")); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "list-financial-events") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try {
        const app = await getApplication(svc, user, body.id);
        const events: any[] = await svc.entities.FinancialEvent.filter({ application_id: app.id }, "-created_date", 200).catch(() => []);
        return Response.json({ events });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "run-finalreview-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runFinalReviewContractTests());
    }

    // ---------- PHASE 15: Visa Discovery & Country Intelligence ----------
    if (action === "list-nationalities") {
      // catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json({ nationalities: await listNationalities(svc) });
    }
    if (action === "list-travel-purposes") {
      // catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json({ purposes: await listTravelPurposes(svc) });
    }
    if (action === "discover") {
      if (!body.nationality || !body.destination || !body.purpose) return Response.json({ error: "nationality, destination, purpose required" }, { status: 400 });
      // catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json(await checkEligibility(svc, { nationality: body.nationality, destination: body.destination, purpose: body.purpose, residence: body.residence, travel_dates: body.travel_dates }));
    }
    if (action === "get-destination-detail") {
      if (!body.code) return Response.json({ error: "code required" }, { status: 400 });
      // catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json(await getDestinationDetail(svc, body.code));
    }
    if (action === "get-visa-option") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      return Response.json({ option: await getVisaOptionById(svc, body.id) });
    }
    if (action === "seed-discovery-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, seeded: await ensureDiscoveryCatalog(svc) });
    }
    if (action === "run-discovery-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runDiscoveryContractTests());
    }

    // ---------- PHASE 19: Operations Case, Review Queue, Manual Submission & Tracking ----------
    const ops403 = (e: any) => Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "BAD_STATE" || e.code === "QC_BLOCKED" || e.code === "NO_SUBMISSION" ? 400 : 500 });
    if (action === "ops-prepare") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await prepareForSubmission(base44, svc, user, await getApplication(svc, user, body.id), { ai: body.ai })); }
      catch (e: any) { return ops403(e); }
    }
    if (action === "ops-list-queue") {
      try { return Response.json({ cases: await listQueue(svc, user, body.filters || {}) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }
    if (action === "ops-get-case") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      try { return Response.json(await getCaseDetail(svc, user, body.case_id)); }
      catch (e: any) { return ops403(e); }
    }
    if (action === "ops-assign") {
      if (!body.case_id || !body.assignee_id) return Response.json({ error: "case_id, assignee_id required" }, { status: 400 });
      try { return Response.json({ case: await assignCase(svc, user, body.case_id, body.assignee_id) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-start-review") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      try { return Response.json({ case: await startReview(svc, user, body.case_id) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-request-info") {
      if (!body.case_id || !body.message) return Response.json({ error: "case_id, message required" }, { status: 400 });
      try { return Response.json(await requestInformation(svc, user, body.case_id, body.message)); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-request-document") {
      if (!body.case_id || !body.message) return Response.json({ error: "case_id, message required" }, { status: 400 });
      try { return Response.json(await requestDocument(svc, user, body.case_id, body.message)); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-flag-issue") {
      if (!body.case_id || !body.reason) return Response.json({ error: "case_id, reason required" }, { status: 400 });
      try { return Response.json({ case: await flagIssue(svc, user, body.case_id, body.reason) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-reject-package") {
      if (!body.case_id || !body.reason) return Response.json({ error: "case_id, reason required" }, { status: 400 });
      try { return Response.json({ case: await rejectPackage(svc, user, body.case_id, body.reason) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-return") {
      if (!body.case_id || !body.reason) return Response.json({ error: "case_id, reason required" }, { status: 400 });
      try { return Response.json({ case: await returnToApplicant(svc, user, body.case_id, body.reason) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-escalate") {
      if (!body.case_id || !body.reason) return Response.json({ error: "case_id, reason required" }, { status: 400 });
      try { return Response.json({ case: await escalate(svc, user, body.case_id, body.reason) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-approve") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      try { return Response.json({ case: await approveForSubmission(svc, user, body.case_id) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-start-submission") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      try { return Response.json(await startSubmission(svc, user, body.case_id)); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-confirm-submission") {
      if (!body.case_id) return Response.json({ error: "case_id required" }, { status: 400 });
      try { return Response.json({ case: await confirmManualSubmission(svc, user, body.case_id, { government_reference: body.government_reference, embassy_reference: body.embassy_reference, courier_tracking_id: body.courier_tracking_id, appointment_reference: body.appointment_reference, notes: body.notes, receipt: body.receipt }) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-enter-tracking") {
      if (!body.case_id || !body.raw_status || !body.source) return Response.json({ error: "case_id, raw_status, source required" }, { status: 400 });
      try { return Response.json(await enterTracking(svc, user, body.case_id, { raw_status: body.raw_status, source: body.source, description: body.description, provider_key: body.provider_key })); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-handle-decision") {
      if (!body.case_id || !body.decision) return Response.json({ error: "case_id, decision required" }, { status: 400 });
      try { return Response.json({ case: await handleDecision(svc, user, body.case_id, { decision: body.decision, decision_date: body.decision_date, raw_status: body.raw_status }) }); } catch (e: any) { return ops403(e); }
    }
    if (action === "ops-dashboard") {
      try { return Response.json(await getOpsDashboard(svc, user)); } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 403 }); }
    }
    if (action === "ops-support-context") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getSupportContext(svc, user, body.id)); } catch (e: any) { return ops403(e); }
    }
    if (action === "traveler-status") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      try { return Response.json(await getTravelerStatus(svc, user, body.id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "run-operations-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runOperationsContractTests());
    }

    // ---------- PHASE 20: Traveler Account, Multi-Traveler, Trip/Group, Settings ----------
    if (action === "account-dashboard") {
      try { return Response.json(await getAccountDashboard(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "list-travelers-v2") {
      try { return Response.json({ travelers: await accountListTravelers(svc, user, { include_archived: !!body.include_archived }) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "get-traveler") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try {
        const t = await accountGetTraveler(svc, user, body.traveler_id);
        const passports = await listPassports(svc, user, body.traveler_id).catch(() => []);
        return Response.json({ traveler: { ...t, profile_completeness: computeCompleteness(t).score }, passports });
      } catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 500 }); }
    }
    if (action === "create-traveler-v2") {
      try { return Response.json({ traveler: await createTraveler(svc, user, body) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "DUPLICATE_TRAVELER" ? 409 : 400 }); }
    }
    if (action === "update-traveler") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ traveler: await updateTraveler(svc, user, body.traveler_id, body.patch || {}) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "archive-traveler") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ traveler: await archiveTraveler(svc, user, body.traveler_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "BAD_STATE" ? 409 : 400 }); }
    }
    if (action === "set-primary-traveler") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ traveler: await setPrimaryTraveler(svc, user, body.traveler_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "list-passports") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ passports: await listPassports(svc, user, body.traveler_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "add-passport") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ passport: await addPassport(svc, user, body.traveler_id, body) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "list-traveler-applications") {
      if (!body.traveler_id) return Response.json({ error: "traveler_id required" }, { status: 400 });
      try { return Response.json({ applications: await listTravelerApplications(svc, user, body.traveler_id) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "account-audit") {
      try { return Response.json({ events: await listAuditEvents(svc, user) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "list-trips") {
      try { return Response.json({ trips: await listTrips(svc, user) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "create-trip") {
      try { return Response.json({ trip: await createTrip(svc, user, body) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 400 }); }
    }
    if (action === "update-trip") {
      if (!body.group_id) return Response.json({ error: "group_id required" }, { status: 400 });
      try { return Response.json({ trip: await updateTrip(svc, user, body.group_id, body.patch || {}) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 }); }
    }
    if (action === "get-trip-progress") {
      if (!body.group_id) return Response.json({ error: "group_id required" }, { status: 400 });
      try { return Response.json(await getTripProgress(svc, user, body.group_id)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 }); }
    }
    if (action === "account-settings") {
      try { return Response.json(await getAccountSettings(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "request-deletion") {
      try { return Response.json(await requestAccountDeletion(svc, user, body.reason)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "DUPLICATE" ? 409 : 400 }); }
    }
    if (action === "cancel-deletion") {
      try { return Response.json(await cancelAccountDeletion(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "deletion-status") {
      try { return Response.json(await getDeletionStatus(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "support-context") {
      try { return Response.json(await buildSupportContext(svc, user, { application_id: body.application_id, order_id: body.order_id, document_id: body.document_id })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "run-account-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runAccountContractTests());
    }

    // ---------- PHASE 21: Destination Discovery, Search, SEO & Conversion ----------
    if (action === "publish-search") {
      // publish catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json(await searchDestinations(svc, body.query || "", { nationality: body.nationality, purpose: body.purpose }));
    }
    if (action === "publish-destination-page") {
      if (!body.slug) return Response.json({ error: "slug required" }, { status: 400 });
      // publish catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json(await getDestinationPage(svc, body.slug, { nationality: body.nationality, purpose: body.purpose }));
    }
    if (action === "publish-popular") {
      // publish catalog seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json({ destinations: await listPopularDestinations(svc, Number(body.limit) || 8) });
    }
    if (action === "publish-related") {
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      return Response.json({ related: await listRelatedDestinations(svc, body.country_code) });
    }
    if (action === "publish-save-destination") {
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      return Response.json(await saveDestination(svc, user, body.country_code));
    }
    if (action === "publish-unsave-destination") {
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      return Response.json(await unsaveDestination(svc, user, body.country_code));
    }
    if (action === "publish-is-saved") {
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      return Response.json({ saved: await isDestinationSaved(svc, user, body.country_code) });
    }
    if (action === "publish-list-saved") {
      return Response.json({ saved: await listSavedDestinations(svc, user) });
    }
    if (action === "publish-seo-feed") {
      return Response.json(await getSeoFeed(svc, body.base || ""));
    }
    if (action === "publish-list-experiments") {
      return Response.json({ experiments: await listExperiments(svc, body.audience || (user ? "authenticated" : "anonymous")) });
    }
    if (action === "publish-upsert-experiment") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json({ experiment: await upsertExperiment(svc, body) }); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "BAD_REQUEST" ? 400 : 500 }); }
    }
    if (action === "publish-save-content") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      const row: any = {
        country_code: body.country_code, slug: body.slug, language: body.language || "en",
        status: body.status || "DRAFT", intro: body.intro || "", overview: body.overview || "",
        visa_summary: body.visa_summary || "", how_it_works: body.how_it_works || [],
        travel_notes: body.travel_notes || "", important_notes: body.important_notes || [],
        faq: body.faq || [], related_destinations: body.related_destinations || [],
        seo: body.seo || {}, content_quality_score: Number(body.content_quality_score) || 0, metadata: body.metadata || {},
      };
      const existing: any[] = await svc.entities.DestinationContent.filter({ country_code: body.country_code, language: row.language }).catch(() => []);
      let saved: any;
      if (existing[0]) saved = await svc.entities.DestinationContent.update(existing[0].id, { ...existing[0], ...row });
      else saved = await svc.entities.DestinationContent.create(row);
      return Response.json({ content: saved });
    }
    if (action === "publish-list-content") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const rows: any[] = await svc.entities.DestinationContent.filter({}, "-updated_date", 200).catch(() => []);
      return Response.json({ content: rows });
    }
    if (action === "run-publish-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runPublishContractTests());
    }

    // ---------- Visa Intelligence Provider ----------
    // Generic actions use whichever configured intelligence provider is active.
    // Legacy pipeworx-* actions remain for backward compatibility.
    if (action === "intelligence-requirement") {
      if (!body.passport || !body.destination) return Response.json({ error: "passport and destination required" }, { status: 400 });
      try {
        const r = await intelGetRequirement(svc, body.passport, body.destination, { bypassCache: !!body.bypass_cache });
        return Response.json({ provider: activeVisaIntelligenceProviderKey(), available: r.available, normalized: r.normalized || null, freshness: r.freshness, cached: r.cached, degraded: r.degraded, error: r.error });
      } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    if (action === "intelligence-health") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const key = activeVisaIntelligenceProviderKey();
      const p: any = getProvider(key);
      return Response.json({ active_provider: key, health: getProviderHealth(), diagnose: p?.diagnose ? p.diagnose() : null });
    }
    if (action === "intelligence-reset-health") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const key = activeVisaIntelligenceProviderKey();
      resetProviderHealth(key);
      return Response.json({ ok: true, provider: key });
    }
    if (action === "admin-travel-buddy-acceptance") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const provider: any = getProvider("TRAVEL_BUDDY");
      if (!provider) return Response.json({ ok: false, error: "travel_buddy_provider_missing" }, { status: 500 });
      const destinations = ["AE", "VN", "ID", "TH", "SG", "LK", "HK", "EG", "OM", "MY"];
      const providerRows: any[] = await svc.entities.Provider.filter({ key: "TRAVEL_BUDDY" }).catch(() => []);
      const providerRow = providerRows[0] || null;
      const previous = providerRow?.adapter_config?.acceptance_summary;
      const previousAt = providerRow?.last_tested_at ? Date.parse(providerRow.last_tested_at) : 0;
      if (!body.force && previous && previousAt && (Date.now() - previousAt) < 30 * 60 * 1000) {
        return Response.json({ ...previous, cached: true });
      }

      const results: any[] = [];
      const batchStarted = Date.now();
      for (const destination of destinations) {
        const started = Date.now();
        const r: any = await provider.getVisaRequirement("IN", destination);
        results.push({
          destination,
          ok: r?.ok === true,
          error: r?.error || null,
          latency_ms: Date.now() - started,
          visa_status: r?.result?.visa_status || null,
          stay_duration_days: r?.result?.stay_duration_days ?? null,
          confidence: r?.result?.confidence || null,
          intelligence_only: r?.result?.intelligence_only === true,
          submission_capability: r?.result?.submission_capability || null,
          source: r?.result?.source || null,
          provider_reference: r?.result?.provider_reference || null,
        });
      }
      const passed = results.filter((r) => r.ok).length;
      const testedAt = new Date().toISOString();
      const summary = {
        ok: passed === destinations.length,
        provider: "TRAVEL_BUDDY",
        mode: "SANDBOX_INTELLIGENCE_ONLY",
        passport: "IN",
        total: destinations.length,
        passed,
        failed: destinations.length - passed,
        tested_at: testedAt,
        total_latency_ms: Date.now() - batchStarted,
        results,
      };

      if (providerRow) {
        await svc.entities.Provider.update(providerRow.id, {
          last_tested_at: testedAt,
          last_test_success: summary.ok,
          last_test_message: `${passed}/${destinations.length} Travel Buddy MVP intelligence routes passed`,
          last_test_latency: summary.total_latency_ms,
          health_status: passed === destinations.length ? "healthy" : (passed > 0 ? "degraded" : "down"),
          provider_lifecycle: passed === destinations.length ? "VERIFIED" : "TESTING",
          our_api_access: passed > 0 ? "YES" : providerRow.our_api_access,
          capability_verification: {
            ...(providerRow.capability_verification || {}),
            api: passed > 0 ? "VERIFIED" : "UNVERIFIED",
            requirements: passed === destinations.length ? "VERIFIED" : "UNVERIFIED",
            eligibility: passed === destinations.length ? "VERIFIED" : "UNVERIFIED",
            submission: "REJECTED",
            application: "REJECTED",
            payment: "REJECTED",
            mcp: "REJECTED",
          },
          adapter_config: { ...(providerRow.adapter_config || {}), acceptance_summary: summary },
        }).catch(() => {});
      }

      for (const item of results) {
        const rows: any[] = await svc.entities.CountryProviderBinding.filter({ provider_key: "TRAVEL_BUDDY", country_code: item.destination, nationality: "IN" }).catch(() => []);
        for (const row of rows) {
          await svc.entities.CountryProviderBinding.update(row.id, {
            provider_supports: item.ok ? "YES" : "UNKNOWN",
            our_api_access: item.ok ? "YES" : "UNKNOWN",
            provider_can_submit: "NO",
            our_active: false,
            last_verified_at: item.ok ? testedAt : row.last_verified_at,
            notes: item.ok ? `Live Travel Buddy intelligence acceptance passed on ${testedAt}. Submission unsupported.` : `Live Travel Buddy acceptance failed on ${testedAt}: ${item.error || "unknown_error"}`,
            metadata: {
              ...(row.metadata || {}),
              intelligence_only: true,
              submission_capability: "UNSUPPORTED",
              acceptance: item,
            },
          }).catch(() => {});
        }
      }

      return Response.json(summary);
    }
    if (action === "pipeworx-requirement") {
      if (!body.passport || !body.destination) return Response.json({ error: "passport and destination required" }, { status: 400 });
      try {
        const r = await intelGetRequirement(svc, body.passport, body.destination, { bypassCache: !!body.bypass_cache });
        return Response.json({ available: r.available, normalized: r.normalized || null, freshness: r.freshness, cached: r.cached, degraded: r.degraded, error: r.error });
      } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    if (action === "pipeworx-free-destinations") {
      if (!body.passport) return Response.json({ error: "passport required" }, { status: 400 });
      try { return Response.json(await getVisaFreeDestinations(svc, body.passport)); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    if (action === "pipeworx-compare") {
      if (!Array.isArray(body.passports) || body.passports.length < 2 || body.passports.length > 5) return Response.json({ error: "passports must be 2-5 entries" }, { status: 400 });
      try { return Response.json(await comparePassportMobility(svc, body.passports)); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    if (action === "pipeworx-invalidate") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(await intelInvalidateCache(svc, { provider: "PIPEWORX", nationality: body.nationality, destination: body.destination }));
    }
    if (action === "pipeworx-health") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const px = getProvider("PIPEWORX");
      return Response.json({ health: getProviderHealth(), diagnose: px?.diagnose ? px.diagnose() : null });
    }
    if (action === "pipeworx-reset-health") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      resetProviderHealth("PIPEWORX");
      return Response.json({ ok: true });
    }
    if (action === "pipeworx-cache-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ cache: await intelListCache(svc, Number(body.limit) || 100) });
    }
    if (action === "run-provider-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      try { return Response.json(await runProviderContractTests()); }
      catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
    }

    // ---------- PHASE 22: India-first Travel Entry Engine + Country Capability Matrix ----------
    if (action === "entry-get") {
      if (!body.destination) return Response.json({ error: "destination required" }, { status: 400 });
      // CountryCapability seeded once via admin seed-catalog; not re-seeded on every read (perf)
      return Response.json({ entry: await resolveTravelEntry(svc, { destination: body.destination, purpose: body.purpose, nationality: body.nationality, departure_country: body.departure_country, travel_dates: body.travel_dates, traveler_attributes: body.traveler_attributes }) });
    }
    if (action === "entry-list-capabilities") {
      // Public published MVP capabilities for home/search ranking (no PII).
      const rows: any[] = await svc.entities.CountryCapability.filter({ status: "PUBLISHED", mvp_enabled: true }, "-priority_score", 200).catch(() => []);
      return Response.json({ capabilities: rows.map((c) => ({ country_code: c.country_code, journey_type: c.journey_type, max_stay_days: c.max_stay_days, visa_required: c.visa_required, automation_level: c.automation_level, priority_score: c.priority_score, official_portal_url: c.official_portal_url, source_name: c.source_name, verified_at: c.verified_at })) });
    }
    if (action === "entry-family-readiness") {
      if (!Array.isArray(body.travelers)) return Response.json({ error: "travelers[] required" }, { status: 400 });
      const out: any[] = [];
      for (const t of body.travelers) {
        if (!t?.destination) continue;
        const r = await resolveTravelEntry(svc, { destination: t.destination, purpose: t.purpose || body.purpose, nationality: body.nationality, departure_country: body.departure_country, travel_dates: t.travel_dates || body.travel_dates, traveler_attributes: t.traveler_attributes });
        out.push({ traveler_id: t.traveler_id || null, entry: r });
      }
      const ready = out.reduce((s, r) => s + (r.entry.checklist || []).filter((i: any) => i.applicable && (i.kind === "required" || i.kind === "informational")).length, 0);
      const total = out.reduce((s, r) => s + (r.entry.checklist || []).filter((i: any) => i.applicable).length, 0);
      return Response.json({ travelers: out, readiness: { travelers: out.length, total_requirements: total, ready_requirements: ready, readiness_pct: total ? Math.round((ready / total) * 100) : 0 } });
    }
    if (action === "admin-entry-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const rows: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 500).catch(() => []);
      return Response.json({ capabilities: rows });
    }
    if (action === "admin-entry-upsert") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.country_code) return Response.json({ error: "country_code required" }, { status: 400 });
      const nationality = String(body.nationality || "IN").toUpperCase();
      const departure = String(body.departure_country || "IN").toUpperCase();
      const purpose = String(body.purpose || "tourism").toLowerCase();
      const existing: any[] = await svc.entities.CountryCapability.filter({ country_code: body.country_code, nationality, departure_country: departure, purpose }).catch(() => []);
      const row = {
        country_code: body.country_code, nationality, departure_country: departure, purpose,
        journey_type: body.journey_type, status: body.status || "DRAFT", freshness: body.freshness || "REQUIRES_REVIEW",
        visa_required: !!body.visa_required, max_stay_days: body.max_stay_days, entries: body.entries || 1,
        passport_validity_min_months: body.passport_validity_min_months ?? 6,
        return_ticket_required: !!body.return_ticket_required, accommodation_required: !!body.accommodation_required, proof_of_funds_required: !!body.proof_of_funds_required,
        application_required: body.application_required || "REQUIRED", application_capability: body.application_capability || { prepare: "YES", prefill: "YES", pay: "NO", submit: "NO", track: "NO" },
        submission_capability: body.submission_capability || "OFFICIAL_PORTAL", tracking_capability: body.tracking_capability || "TRIP_ONLY",
        appointment_required: !!body.appointment_required, manual_operations_required: !!body.manual_operations_required,
        automation_level: body.automation_level || "GUIDED", official_portal_url: body.official_portal_url || null, api_provider: body.api_provider || null,
        fee_government_minor: body.fee_government_minor, fee_currency: body.fee_currency, fee_notes: body.fee_notes,
        extension_supported: !!body.extension_supported, extension_max_days: body.extension_max_days, extension_notes: body.extension_notes, extension_fee_minor: body.extension_fee_minor,
        overstay_notes: body.overstay_notes, overstay_penalty_notes: body.overstay_penalty_notes, overstay_authority: body.overstay_authority,
        checklist: body.checklist || [], source_name: body.source_name, source_url: body.source_url, source_type: body.source_type || "secondary_reference",
        retrieved_at: body.retrieved_at || new Date().toISOString(), verified_at: body.verified_at || (body.status === "VERIFIED" || body.status === "PUBLISHED" ? new Date().toISOString() : null),
        effective_at: body.effective_at, provider: body.provider, provider_version: body.provider_version,
        rule_version: body.rule_version || 1, priority_score: body.priority_score || 0, data_quality_score: body.data_quality_score || 0,
        mvp_enabled: !!body.mvp_enabled || body.status === "PUBLISHED", metadata: body.metadata || {},
        // Phase 23 provider/execution matrix fields (forward-compatible; all optional).
        official_portal_name: body.official_portal_name, validity_days: body.validity_days, insurance_required: body.insurance_required,
        api_available: body.api_available, api_provider: body.api_provider, api_documentation: body.api_documentation, api_capabilities: body.api_capabilities || [],
        commercial_access_required: body.commercial_access_required, credentials_required: !!body.credentials_required, sandbox_available: body.sandbox_available, production_available: body.production_available,
        mcp_available: body.mcp_available, mcp_provider: body.mcp_provider, mcp_endpoint: body.mcp_endpoint, mcp_tools: body.mcp_tools || [], mcp_read_only: body.mcp_read_only, mcp_auth: body.mcp_auth,
        provider_capabilities: body.provider_capabilities, provider_composition: body.provider_composition, fallback_strategy: body.fallback_strategy,
        passport_policy: body.passport_policy || {}, photo_policy: body.photo_policy || {}, arrival_policy: body.arrival_policy || {}, travel_policy: body.travel_policy || {}, supporting_visa_policy: body.supporting_visa_policy || {},
        document_requirements: body.document_requirements, data_confidence: body.data_confidence, automation_score: body.automation_score || 0,
        research_status: body.research_status, research_assignee: body.research_assignee, research_notes: body.research_notes, research_updated_at: body.research_updated_at || new Date().toISOString(),
        final_classification: body.final_classification, secondary_source_name: body.secondary_source_name, secondary_source_url: body.secondary_source_url,
        appointment_requirement: body.appointment_requirement,
      };
      let saved: any;
      if (existing[0]) {
        // Bump rule_version when a published rule's material fields change (admin-controlled).
        const rv = (body.bump_version ? (Number(existing[0].rule_version) || 1) + 1 : Number(body.rule_version) || Number(existing[0].rule_version) || 1);
        saved = await svc.entities.CountryCapability.update(existing[0].id, { ...row, rule_version: rv });
      } else saved = await svc.entities.CountryCapability.create(row);
      return Response.json({ capability: saved });
    }
    if (action === "admin-entry-publish") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      return Response.json({ capability: await svc.entities.CountryCapability.update(body.capability_id, { status: "PUBLISHED", verified_at: new Date().toISOString(), mvp_enabled: true, freshness: "FRESH" }).catch(() => null) });
    }
    if (action === "admin-entry-suspend") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      return Response.json({ capability: await svc.entities.CountryCapability.update(body.capability_id, { status: "SUSPENDED", freshness: "REQUIRES_REVIEW", mvp_enabled: false }).catch(() => null) });
    }
    if (action === "entry-validation-report") {
      try { return Response.json(await getValidationReport(svc, user)); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 500 }); }
    }
    if (action === "seed-entry-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ ok: true, ...(await ensureEntryCatalog(svc)) });
    }
    if (action === "run-entry-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runEntryContractTests());
    }
    if (action === "run-mvp-engine-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json(runMvpEngineContractTests());
    }
    if (action === "run-readiness-engine-contract-tests") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      return Response.json({ engine: runReadinessContractTests(), orchestrator: runReadinessOrchestratorContractTests() });
    }
    if (action === "readiness-rule-pack-coverage") {
      return Response.json(rulePackCoverage());
    }
    if (action === "mvp-evaluate-readiness") {
      return Response.json(evaluateVisaReadiness(body.input || body));
    }
    if (action === "mvp-evaluate-engine") {
      const key = String(body.engine || "");
      if (key === "passport_intelligence") return Response.json(evaluatePassport(body.input || {}));
      if (key === "photo_compliance") return Response.json(evaluatePhoto(body.input?.metrics || {}, body.input?.policy || {}));
      if (key === "eligibility") return Response.json(evaluateMvpEligibility(body.input || {}));
      if (key === "travel_consistency") return Response.json(evaluateTravel(body.input || {}));
      if (key === "supporting_visa") return Response.json(evaluateSupportingVisa(body.input?.document || null, body.input?.requirement || {}));
      if (key === "arrival_card") return Response.json(evaluateArrivalCard(body.input?.country || body.destination || "", body.input?.fields || {}, body.input?.policy || null));
      if (key === "submission_tracking") return Response.json(evaluateExecutionCapability(body.input || {}));
      if (key === "preflight") {
        const rs = Array.isArray(body.input?.results) ? body.input.results : [];
        return Response.json(aggregatePreflight(rs));
      }
      return Response.json({ error: "Unknown MVP engine", code: "UNKNOWN_ENGINE" }, { status: 400 });
    }

    // ---------- PHASE 23: Country x Provider x Execution Matrix admin actions ----------
    if (action === "admin-entry-detail") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.destination) return Response.json({ error: "destination required" }, { status: 400 });
      try { return Response.json(await resolveCapabilityDetail(svc, { destination: body.destination, nationality: body.nationality, departure_country: body.departure_country, purpose: body.purpose })); }
      catch (e: any) { return Response.json({ error: e.message, code: e.code }, { status: 500 }); }
    }
    if (action === "admin-provider-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const all: any[] = await svc.entities.Provider.filter({}, "-verified_at", 500).catch(() => []);
      const PHASE23_CATS = new Set(["visa_intelligence", "visa_application", "visa_submission", "visa_tracking", "document_validation", "notification", "government_official"]);
      const rows = all.filter((p) => p.provider_type || PHASE23_CATS.has(p.category));
      return Response.json({ providers: rows.map((p) => ({ ...p, adapter_config: undefined })) });
    }
    if (action === "admin-provider-upsert") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.key) return Response.json({ error: "key required" }, { status: 400 });
      const existing: any[] = await svc.entities.Provider.filter({ key: body.key }).catch(() => []);
      const row = {
        name: body.name || body.key, key: body.key, category: body.category || "other", provider_type: body.provider_type,
        adapter_key: body.adapter_key || "matrix_provider", display_name: body.display_name || body.name || body.key,
        description: body.description, website: body.website, documentation_url: body.documentation_url,
        countries: body.countries || [], coverage_notes: body.coverage_notes, india_coverage_score: body.india_coverage_score || 0,
        mcp_available: !!body.mcp_available, mcp_endpoint: body.mcp_endpoint, mcp_tools: body.mcp_tools || [], mcp_auth: body.mcp_auth, mcp_read_only: body.mcp_read_only !== false,
        commercial_model: body.commercial_model || "UNKNOWN", per_application_cost_minor: body.per_application_cost_minor, per_application_cost_currency: body.per_application_cost_currency,
        api_subscription_minor: body.api_subscription_minor, api_subscription_currency: body.api_subscription_currency,
        min_volume: body.min_volume, setup_fee_minor: body.setup_fee_minor, transaction_fee_minor: body.transaction_fee_minor, transaction_fee_currency: body.transaction_fee_currency,
        sandbox_available: body.sandbox_available || "UNKNOWN", production_available: body.production_available || "UNKNOWN",
        restrictions: body.restrictions || [], evaluation_score: body.evaluation_score || 0,
        status: body.status || existing[0]?.status || "researching", enabled: body.enabled !== false, verified_at: body.verified_at || (body.status === "connected" || body.status === "verified" ? new Date().toISOString() : existing[0]?.verified_at || null),
        last_evaluated_at: new Date().toISOString(), health_status: existing[0]?.health_status || "unknown", capabilities: body.capabilities || existing[0]?.capabilities || [],
      };
      let saved: any;
      if (existing[0]) { saved = await svc.entities.Provider.update(existing[0].id, row).catch(() => null); }
      else { saved = await svc.entities.Provider.create(row).catch(() => null); }
      return Response.json({ provider: saved });
    }
    if (action === "admin-binding-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const q: any = {};
      if (body.country_code) q.country_code = body.country_code;
      if (body.provider_key) q.provider_key = body.provider_key;
      const rows: any[] = await svc.entities.CountryProviderBinding.filter(q, "-country_code", 1000).catch(() => []);
      return Response.json({ bindings: rows });
    }
    if (action === "admin-binding-upsert") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.provider_key || !body.country_code || !body.journey_type) return Response.json({ error: "provider_key, country_code, journey_type required" }, { status: 400 });
      const existing: any[] = await svc.entities.CountryProviderBinding.filter({ provider_key: body.provider_key, country_code: body.country_code, journey_type: body.journey_type, role: body.role || "source" }).catch(() => []);
      const row = {
        provider_key: body.provider_key, provider_name: body.provider_name, country_code: body.country_code, nationality: body.nationality || "IN",
        journey_type: body.journey_type, program: body.program, capability: body.capability || {},
        commercial_access: body.commercial_access || "UNKNOWN", is_primary: !!body.is_primary, role: body.role || "source",
        fallback_order: body.fallback_order || 0, notes: body.notes, verified_at: body.verified_at || new Date().toISOString(),
        status: body.status || (existing[0]?.status || "RESEARCHING"), metadata: body.metadata || {},
      };
      let saved: any;
      if (existing[0]) saved = await svc.entities.CountryProviderBinding.update(existing[0].id, row).catch(() => null);
      else saved = await svc.entities.CountryProviderBinding.create(row).catch(() => null);
      return Response.json({ binding: saved });
    }
    if (action === "admin-research-set-status") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      const patch: any = { research_updated_at: new Date().toISOString() };
      if (body.research_status) patch.research_status = body.research_status;
      if (body.research_assignee !== undefined) patch.research_assignee = body.research_assignee;
      if (body.research_notes !== undefined) patch.research_notes = body.research_notes;
      if (body.data_confidence) patch.data_confidence = body.data_confidence;
      if (body.final_classification) patch.final_classification = body.final_classification;
      if (body.secondary_source_name !== undefined) patch.secondary_source_name = body.secondary_source_name;
      if (body.secondary_source_url !== undefined) patch.secondary_source_url = body.secondary_source_url;
      return Response.json({ capability: await svc.entities.CountryCapability.update(body.capability_id, patch).catch(() => null) });
    }
    if (action === "admin-entry-export") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const rows: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 1000).catch(() => []);
      const header = ["country_code","nationality","journey_type","visa_required","application_required","official_portal_url","api_available","api_provider","mcp_available","mcp_provider","application_capability_prepare","application_capability_submit","submission_capability","tracking_capability","appointment_requirement","automation_level","primary_source","secondary_source","data_confidence","research_status","final_classification","rule_version","verified_at","status"];
      const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [header.join(",")].concat(rows.map((c) => header.map((h) => esc((c as any)[h])).join(","))).join("\n");
      return Response.json({ csv, json: rows.map((c) => Object.fromEntries(header.map((h) => [h, (c as any)[h] ?? null]))), count: rows.length });
    }

    // ---------- PHASE 24: Verification, evidence, research-workflow admin actions ----------
    const adminOnly = () => { if (user?.role !== "admin") return false; return true; };
    if (action === "admin-evidence-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      return Response.json({ evidence: await listEvidenceFor(svc, body.capability_id) });
    }
    if (action === "admin-evidence-create") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id || !body.source_type) return Response.json({ error: "capability_id and source_type required" }, { status: 400 });
      const capRow: any = await svc.entities.CountryCapability.get(body.capability_id).catch(() => null);
      if (!capRow) return Response.json({ error: "Capability not found" }, { status: 404 });
      const row = {
        country_capability_id: body.capability_id, country_code: capRow.country_code, journey_type: capRow.journey_type,
        claim_type: body.claim_type || "general", source_type: body.source_type, source_name: body.source_name, source_url: body.source_url,
        source_title: body.source_title, claim_value: body.claim_value || null, verification_status: body.verification_status || "UNVERIFIED",
        confidence: body.confidence || "UNKNOWN", retrieved_at: body.retrieved_at || new Date().toISOString(), published_at: body.published_at || null,
        valid_from: body.valid_from || null, valid_until: body.valid_until || null, reviewed_at: body.reviewed_at || null, reviewed_by: body.reviewed_by || user.id || user.email,
        content_fingerprint: body.content_fingerprint || (body.source_url ? `manual:${body.source_url}` : null), content_snapshot: body.content_snapshot || null, source_version: body.source_version || null,
        override_record: body.override_record || null, notes: body.notes || null, ievidence_id: `${body.capability_id}|${body.claim_type || "general"}|${body.source_url || ""}`, metadata: body.metadata || {},
      };
      return Response.json({ evidence: await svc.entities.CapabilityEvidence.create(row).catch(() => null) });
    }
    if (action === "admin-evidence-update") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.evidence_id) return Response.json({ error: "evidence_id required" }, { status: 400 });
      const patch: any = { ...body.patch, reviewed_by: user.id || user.email, reviewed_at: new Date().toISOString() };
      return Response.json({ evidence: await svc.entities.CapabilityEvidence.update(body.evidence_id, patch).catch(() => null) });
    }
    if (action === "admin-evidence-verify") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.evidence_id) return Response.json({ error: "evidence_id required" }, { status: 400 });
      const ev: any = await svc.entities.CapabilityEvidence.get(body.evidence_id).catch(() => null);
      if (!ev) return Response.json({ error: "Not found" }, { status: 404 });
      const patch: any = { verification_status: body.verification_status || "VERIFIED", confidence: body.confidence || ev.confidence, reviewed_at: new Date().toISOString(), reviewed_by: user.id || user.email, notes: body.notes || ev.notes };
      if (body.override_record) patch.override_record = { ...body.override_record, admin_id: user.id || user.email, at: new Date().toISOString() };
      const updated: any = await svc.entities.CapabilityEvidence.update(body.evidence_id, patch).catch(() => null);
      // Re-check two-source rule across all evidence for this capability; sync capability verification_status when satisfied.
      const all: any[] = await listEvidenceFor(svc, ev.country_capability_id);
      const two = meetsTwoSourceRule(all);
      if (two.ok) {
        const capPatch: any = { verification_status: "VERIFIED", data_confidence: "CROSS_CHECKED", last_verified_at: new Date().toISOString(), source_count: all.length, primary_source: all[0]?.source_name, primary_source_type: all[0]?.source_type, source_freshness: "FRESH", next_review_at: nextReviewDate(undefined as any, "LOW") };
        await svc.entities.CountryCapability.update(ev.country_capability_id, capPatch).catch(() : any => {});
      }
      return Response.json({ evidence: updated, two_source: two });
    }
    if (action === "admin-research-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const q: any = {};
      if (body.status) q.status = body.status;
      if (body.country_code) q.country_code = body.country_code;
      const rows: any[] = await svc.entities.ResearchTask.filter(q, "-created_at", 500).catch(() : any[] => []);
      return Response.json({ tasks: rows });
    }
    if (action === "admin-research-create") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      const capRow: any = await svc.entities.CountryCapability.get(body.capability_id).catch(() => null);
      if (!capRow) return Response.json({ error: "Capability not found" }, { status: 404 });
      const row = {
        country_capability_id: body.capability_id, country_code: capRow.country_code, journey_type: capRow.journey_type,
        claim_type: body.claim_type || "general_destination", priority: body.priority || "NORMAL", status: "QUEUED",
        assigned_to: null, created_at: new Date().toISOString(), started_at: null, completed_at: null, due_at: body.due_at || null,
        source_requirements: body.source_requirements || null, verification_result: null, evidence_ids: [], task_key: `${body.capability_id}|${body.claim_type || "general_destination"}`, generated_by: "manual", notes: body.notes || null, metadata: {},
      };
      return Response.json({ task: await svc.entities.ResearchTask.create(row).catch(() => null) });
    }
    if (action === "admin-research-claim") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.task_id) return Response.json({ error: "task_id required" }, { status: 400 });
      const t: any = await svc.entities.ResearchTask.get(body.task_id).catch(() => null);
      if (!t) return Response.json({ error: "Not found" }, { status: 404 });
      if (!canTransitionResearch(t.status, "IN_PROGRESS")) return Response.json({ error: `Cannot claim from ${t.status}`, code: "BAD_STATE" }, { status: 400 });
      return Response.json({ task: await svc.entities.ResearchTask.update(body.task_id, { status: "IN_PROGRESS", assigned_to: body.assignee || user.id || user.email, started_at: new Date().toISOString() }).catch(() => null) });
    }
    if (action === "admin-research-transition") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.task_id || !body.status) return Response.json({ error: "task_id and status required" }, { status: 400 });
      const t: any = await svc.entities.ResearchTask.get(body.task_id).catch(() => null);
      if (!t) return Response.json({ error: "Not found" }, { status: 404 });
      if (!canTransitionResearch(t.status, body.status)) return Response.json({ error: `Invalid transition ${t.status} -> ${body.status}`, code: "BAD_STATE" }, { status: 400 });
      const patch: any = { status: body.status, notes: body.notes ?? t.notes, evidence_ids: body.evidence_ids ?? t.evidence_ids };
      if (body.status === "IN_PROGRESS" && !t.started_at) patch.started_at = new Date().toISOString();
      if (body.status === "BLOCKED") patch.assigned_to = t.assigned_to;
      return Response.json({ task: await svc.entities.ResearchTask.update(body.task_id, patch).catch(() => null) });
    }
    if (action === "admin-research-complete") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.task_id || !body.outcome) return Response.json({ error: "task_id and outcome required" }, { status: 400 });
      const t: any = await svc.entities.ResearchTask.get(body.task_id).catch(() => null);
      if (!t) return Response.json({ error: "Not found" }, { status: 404 });
      const target = body.outcome === "VERIFIED" ? "VERIFIED" : "REJECTED";
      if (!canTransitionResearch(t.status, target)) return Response.json({ error: `Cannot complete from ${t.status} to ${target}`, code: "BAD_STATE" }, { status: 400 });
      // VERIFIED requires attached evidence satisfying two-source rule (§6/§7).
      if (target === "VERIFIED") {
        const evidenceIds: string[] = body.evidence_ids || t.evidence_ids || [];
        if (!evidenceIds.length) return Response.json({ error: "VERIFIED requires attached evidence", code: "NO_EVIDENCE" }, { status: 400 });
        const evidenceRows: any[] = [];
        for (const id of evidenceIds) { const e: any = await svc.entities.CapabilityEvidence.get(id).catch(() => null); if (e) evidenceRows.push(e); }
        const check = canCompleteResearchTaskVerified({ ...t, evidence_ids: evidenceIds }, evidenceRows);
        if (!check.ok) return Response.json({ error: check.reason, code: "TWO_SOURCE_FAILED" }, { status: 400 });
      }
      const patch: any = { status: target, completed_at: new Date().toISOString(), verification_result: body.result || null, notes: body.notes ?? t.notes, evidence_ids: body.evidence_ids ?? t.evidence_ids };
      return Response.json({ task: await svc.entities.ResearchTask.update(body.task_id, patch).catch(() => null) });
    }
    if (action === "admin-provider-verify") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.provider_id) return Response.json({ error: "provider_id required" }, { status: 400 });
      const p: any = await svc.entities.Provider.get(body.provider_id).catch(() => null);
      if (!p) return Response.json({ error: "Not found" }, { status: 404 });
      const patch: any = { verification_notes: body.notes ?? p.verification_notes, last_verified_at: new Date().toISOString(), our_api_access: body.our_api_access ?? p.our_api_access ?? "NO", our_commercial_authorized: body.our_commercial_authorized ?? p.our_commercial_authorized ?? "NO", authentication_method: body.authentication_method ?? p.authentication_method, webhook_support: body.webhook_support ?? p.webhook_support };
      if (body.lifecycle) {
        if (!canTransitionProvider(p.provider_lifecycle || "DISCOVERED", body.lifecycle)) return Response.json({ error: `Invalid lifecycle transition ${p.provider_lifecycle} -> ${body.lifecycle}`, code: "BAD_STATE" }, { status: 400 });
        patch.provider_lifecycle = body.lifecycle;
        if (body.lifecycle === "VERIFIED" || body.lifecycle === "PRODUCTION") patch.verified_at = new Date().toISOString();
      }
      if (body.capability_verification) patch.capability_verification = { ...(p.capability_verification || {}), ...body.capability_verification };
      return Response.json({ provider: await svc.entities.Provider.update(body.provider_id, patch).catch(() => null) });
    }
    if (action === "admin-binding-execution") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.binding_id) return Response.json({ error: "binding_id required" }, { status: 400 });
      const b: any = await svc.entities.CountryProviderBinding.get(body.binding_id).catch(() => null);
      if (!b) return Response.json({ error: "Not found" }, { status: 404 });
      const patch: any = {
        our_api_access: body.our_api_access ?? b.our_api_access ?? "UNKNOWN",
        our_commercial_authorized: body.our_commercial_authorized ?? b.our_commercial_authorized ?? "UNKNOWN",
        provider_knows: body.provider_knows ?? b.provider_knows ?? "UNKNOWN",
        provider_supports: body.provider_supports ?? b.provider_supports ?? "UNKNOWN",
        provider_can_submit: body.provider_can_submit ?? b.provider_can_submit ?? "UNKNOWN",
        provider_can_track: body.provider_can_track ?? b.provider_can_track ?? "UNKNOWN",
        our_active: body.our_active ?? b.our_active ?? false,
        verification_status: body.verification_status ?? b.verification_status ?? "UNVERIFIED",
        last_verified_at: new Date().toISOString(),
        notes: body.notes ?? b.notes,
      };
      return Response.json({ binding: await svc.entities.CountryProviderBinding.update(body.binding_id, patch).catch(() => null) });
    }
    if (action === "admin-stale-generate") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const today = new Date().toISOString();
      const caps: any[] = await svc.entities.CountryCapability.filter({ verification_status: { $in: ["VERIFIED", "PARTIALLY_VERIFIED"] } }, "-priority_score", 500).catch(() : any[] => []);
      const tasks: any[] = [];
      for (const c of caps) {
        if (!staleDownstate(c, today)) continue;
        // Downstate + open a research task.
        await svc.entities.CountryCapability.update(c.id, { verification_status: "STALE", previous_verification_status: c.verification_status, source_freshness: c.freshness === "EXPIRED" ? "EXPIRED" : "STALE" }).catch(() : any => {});
        const key = `${c.id}|general`;
        const existing: any[] = await svc.entities.ResearchTask.filter({ task_key: key, generated_by: "stale_scan" }, "-created_at", 5).catch(() : any[] => []);
        if (!existing.length) {
          const row = { country_capability_id: c.id, country_code: c.country_code, journey_type: c.journey_type, claim_type: "general", priority: "HIGH", status: "QUEUED", assigned_to: null, created_at: today, started_at: null, completed_at: null, due_at: nextReviewDate(undefined as any, "HIGH"), source_requirements: "Re-verify official source — evidence is stale", verification_result: null, evidence_ids: [], task_key: key, generated_by: "stale_scan", notes: `Auto-generated: verification went stale (${c.freshness || "EXPIRED"})`, metadata: {} };
          const created: any = await svc.entities.ResearchTask.create(row).catch(() => null);
          if (created) tasks.push(created);
        }
      }
      return Response.json({ generated: tasks.length, tasks });
    }
    if (action === "admin-verification-summary") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      // Aggregate verification state across all capabilities.
      const caps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 500).catch(() : any[] => []);
      const allBindings: any[] = await svc.entities.CountryProviderBinding.filter({}, "-country_code", 2000).catch(() : any[] => []);
      const allProviders: any[] = await svc.entities.Provider.filter({}, "-verified_at", 500).catch(() : any[] => []);
      const providersByKey: Record<string, any> = {};
      for (const p of allProviders) if (p.key) providersByKey[p.key] = { ...p, adapter_config: undefined };
      const bindingMap: Record<string, any[]> = {};
      for (const b of allBindings) { const k = `${b.country_code}|${b.journey_type}`; (bindingMap[k] = bindingMap[k] || []).push(b); }
      const today = new Date().toISOString();
      const rows = caps.map((c) => {
        const bnd = bindingMap[`${c.country_code}|${c.journey_type}`] || [];
        const exec = computeExecutionCapability(c, bnd, providersByKey);
        const score = computeVerificationScore(c, [], bnd, providersByKey);
        return {
          country_code: c.country_code, journey_type: c.journey_type, status: c.status,
          verification_status: c.verification_status || (c.status === "PUBLISHED" ? "VERIFIED" : "INVENTORIED"),
          verification_score: score, verification_class: verificationClassFromScore(score),
          execution_capability: exec, change_risk: c.change_risk || deriveChangeRisk(c, []),
          stale: staleDownstate(c, today), last_verified_at: c.last_verified_at || c.verified_at || null, next_review_at: c.next_review_at || null,
        };
      });
      return Response.json({
        total: rows.length,
        verified: rows.filter((r) => r.verification_status === "VERIFIED").length,
        partially_verified: rows.filter((r) => r.verification_status === "PARTIALLY_VERIFIED").length,
        researching: rows.filter((r) => r.verification_status === "RESEARCHING" || r.verification_status === "INVENTORIED").length,
        stale: rows.filter((r) => r.stale || r.verification_status === "STALE").length,
        blocked: rows.filter((r) => r.verification_status === "BLOCKED").length,
        execution_counts: rows.reduce((acc: any, r) => { acc[r.execution_capability] = (acc[r.execution_capability] || 0) + 1; return acc; }, {}),
        rows,
      });
    }
    if (action === "admin-verification-export") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const caps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 1000).catch(() : any[] => []);
      const allBindings: any[] = await svc.entities.CountryProviderBinding.filter({}, "-country_code", 2000).catch(() : any[] => []);
      const allProviders: any[] = await svc.entities.Provider.filter({}, "-verified_at", 500).catch(() : any[] => []);
      const providersByKey: Record<string, any> = {};
      for (const p of allProviders) if (p.key) providersByKey[p.key] = { ...p, adapter_config: undefined };
      const bindingMap: Record<string, any[]> = {};
      for (const b of allBindings) { const k = `${b.country_code}|${b.journey_type}`; (bindingMap[k] = bindingMap[k] || []).push(b); }
      const today = new Date().toISOString();
      const header = ["country_code", "journey_type", "status", "verification_status", "verification_score", "verification_class", "execution_capability", "data_confidence", "change_risk", "stale", "last_verified_at", "next_review_at", "source_count", "primary_source", "primary_source_type", "evidence_completeness"];
      const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = caps.map((c) => {
        const bnd = bindingMap[`${c.country_code}|${c.journey_type}`] || [];
        const exec = computeExecutionCapability(c, bnd, providersByKey);
        const score = computeVerificationScore(c, [], bnd, providersByKey);
        const row = {
          country_code: c.country_code, journey_type: c.journey_type, status: c.status,
          verification_status: c.verification_status || (c.status === "PUBLISHED" ? "VERIFIED" : "INVENTORIED"),
          verification_score: score, verification_class: verificationClassFromScore(score), execution_capability: exec,
          data_confidence: c.data_confidence, change_risk: c.change_risk || deriveChangeRisk(c, []),
          stale: staleDownstate(c, today) ? "YES" : "NO", last_verified_at: c.last_verified_at || c.verified_at || "",
          next_review_at: c.next_review_at || "", source_count: c.source_count || 0, primary_source: c.primary_source || "",
          primary_source_type: c.primary_source_type || "", evidence_completeness: c.evidence_completeness || 0,
        };
        return header.map((h) => esc((row as any)[h])).join(",");
      });
      return Response.json({ csv: [header.join(",")].concat(lines).join("\n"), count: caps.length });
    }
    // ---------- END PHASE 24 VERIFICATION ACTIONS ----------

    // ---------- PHASE 25: Source Snapshot, Change Detection & Verification Maintenance ----------
    const OFFICIAL_ST = new Set(["GOVERNMENT", "OFFICIAL_IMMIGRATION", "EMBASSY_CONSULATE", "OFFICIAL_AIRLINE_IATA"]);
    const PAYLOAD_TO_CAPABILITY: Record<string, string> = {
      journey_type: "journey_type", visa_required: "visa_required", max_stay_days: "max_stay_days",
      fee_government_minor: "fee_government_minor", fee_currency: "fee_currency",
      official_portal_url: "official_portal_url", application_url: "official_portal_url",
      application_required: "application_required", submission_capability: "submission_capability",
      tracking_capability: "tracking_capability", passport_validity_min_months: "passport_validity_min_months",
      processing_time_days: "processing_time_days", validity_days: "validity_days",
      evisa_available: "application_required", eta_available: "application_required",
      visa_on_arrival: "visa_required", visa_free: "visa_required", required_documents: "checklist",
      photo_requirements: "checklist", biometric_requirements: "document_requirements",
      insurance_required: "insurance_required", eligibility: "metadata", transit_rules: "metadata",
    };
    if (action === "admin-snapshot-capture") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.capability_id) return Response.json({ error: "capability_id required" }, { status: 400 });
      const cap: any = await svc.entities.CountryCapability.get(body.capability_id).catch(() => null);
      if (!cap) return Response.json({ error: "Capability not found" }, { status: 404 });
      const claimType = body.claim_type || "general";
      const payload = normalizeSourcePayload(body.raw_payload || {});
      const fp = fingerprintPayload(payload);
      const prevQ: any = { capability_id: body.capability_id };
      if (body.evidence_id) prevQ.evidence_id = body.evidence_id;
      const prevRows: any[] = await svc.entities.CapabilitySourceSnapshot.filter(prevQ, "-captured_at", 10).catch(() => []);
      const prev = prevRows[0] || null;
      const change = detectChange(prev, payload, claimType);
      let evidenceId = body.evidence_id || null;
      if (!evidenceId && body.source_type) {
        const evRows: any[] = await svc.entities.CapabilityEvidence.filter({ country_capability_id: body.capability_id, claim_type: claimType, source_url: body.source_url || "" }).catch(() => []);
        if (evRows[0]) evidenceId = evRows[0].id;
      }
      const material = change.change === "MATERIAL";
      const now = new Date().toISOString();
      const row = {
        capability_id: body.capability_id, evidence_id: evidenceId, country_code: cap.country_code, journey_type: cap.journey_type,
        claim_type: claimType, source_type: body.source_type || null, source_name: body.source_name || null, source_url: body.source_url || null,
        fingerprint: fp, normalized_payload: payload, previous_snapshot_id: prev?.id || null, previous_fingerprint: prev?.fingerprint || null,
        captured_at: now, change_vs_previous: change.change, changed_fields: change.changedFields, material_fields: change.materialFields,
        diff: change.diff, diff_summary: summarizeDiff(change.diff), material, review_status: material ? "PENDING" : "ACCEPTED",
        reviewed_by: null, reviewed_at: null, research_task_id: null, applied_to_capability: !material, metadata: body.metadata || {},
      };
      const snap: any = await svc.entities.CapabilitySourceSnapshot.create(row).catch(() : any => null);
      let task: any = null;
      if (evidenceId) await svc.entities.CapabilityEvidence.update(evidenceId, { content_fingerprint: fp, content_snapshot: summarizeDiff(change.diff).slice(0, 500), source_version: body.source_version || null, retrieved_at: now }).catch(() : any => {});
      if (material) {
        const ds = downstateOnMaterialChange(cap.verification_status || (cap.status === "PUBLISHED" ? "VERIFIED" : "INVENTORIED"));
        const capPatch: any = { research_updated_at: now, change_risk: cap.change_risk || "MEDIUM" };
        if (ds.retain_previous) capPatch.previous_verification_status = cap.verification_status || null;
        if (shouldInvalidateVerification(change.change)) {
          capPatch.verification_status = ds.target;
          capPatch.research_status = "RESEARCHING";
          capPatch.next_review_at = nextReviewFromRisk(cap.change_risk || "MEDIUM", now);
        }
        await svc.entities.CountryCapability.update(body.capability_id, capPatch).catch(() : any => {});
        const taskKey = `${body.capability_id}|${claimType}|change_detector`;
        const existing: any[] = await svc.entities.ResearchTask.filter({ task_key: taskKey }, "-created_at", 5).catch(() : any[] => []);
        if (!existing.some((t) => ["QUEUED", "IN_PROGRESS"].includes(t.status))) {
          const trow = {
            country_capability_id: body.capability_id, country_code: cap.country_code, journey_type: cap.journey_type,
            claim_type: claimType, priority: priorityFromChangeRisk(cap.change_risk || "MEDIUM"), status: "QUEUED",
            assigned_to: null, created_at: now, started_at: null, completed_at: null, due_at: nextReviewFromRisk(cap.change_risk || "MEDIUM", now),
            source_requirements: `Re-verify ${claimType} — material change detected: ${change.materialFields.join(", ") || "see diff"}`,
            verification_result: null, evidence_ids: evidenceId ? [evidenceId] : [], task_key: taskKey,
            generated_by: "change_detector", notes: summarizeDiff(change.diff).slice(0, 500), metadata: { snapshot_id: snap?.id },
          };
          task = await svc.entities.ResearchTask.create(trow).catch(() : any => null);
          if (task && snap) await svc.entities.CapabilitySourceSnapshot.update(snap.id, { research_task_id: task.id }).catch(() : any => {});
        } else { task = existing[0]; }
      } else {
        await svc.entities.CountryCapability.update(body.capability_id, { research_updated_at: now, next_review_at: nextReviewFromRisk(cap.change_risk || "LOW", now) }).catch(() : any => {});
      }
      return Response.json({ snapshot: snap, change: { change: change.change, changedFields: change.changedFields, materialFields: change.materialFields, fingerprint: fp, previousFingerprint: change.previousFingerprint }, evidence_id: evidenceId, task });
    }
    if (action === "admin-snapshot-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const q: any = {};
      if (body.capability_id) q.capability_id = body.capability_id;
      if (body.evidence_id) q.evidence_id = body.evidence_id;
      const rows: any[] = await svc.entities.CapabilitySourceSnapshot.filter(q, "-captured_at", 200).catch(() : any[] => []);
      return Response.json({ snapshots: rows });
    }
    if (action === "admin-change-review-list") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const snaps: any[] = await svc.entities.CapabilitySourceSnapshot.filter({ material: true, review_status: "PENDING" }, "-captured_at", 500).catch(() : any[] => []);
      const allCaps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 1000).catch(() : any[] => []);
      const capMap: Record<string, any> = Object.fromEntries(allCaps.map((c) => [c.id, c]));
      return Response.json({ reviews: snaps.map((s) => ({ snapshot: s, capability: capMap[s.capability_id] || null })) });
    }
    if (action === "admin-change-accept") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.snapshot_id) return Response.json({ error: "snapshot_id required" }, { status: 400 });
      const snap: any = await svc.entities.CapabilitySourceSnapshot.get(body.snapshot_id).catch(() : any => null);
      if (!snap) return Response.json({ error: "Not found" }, { status: 404 });
      if (snap.review_status === "ACCEPTED") return Response.json({ error: "Already accepted" }, { status: 400 });
      const cap: any = await svc.entities.CountryCapability.get(snap.capability_id).catch(() : any => null);
      const now = new Date().toISOString();
      const payload = snap.normalized_payload || {};
      const capPatch: any = { rule_version: (Number(cap?.rule_version) || 1) + 1, verified_at: now, last_verified_at: now, research_updated_at: now, source_fingerprint: snap.fingerprint };
      for (const [pk, ck] of Object.entries(PAYLOAD_TO_CAPABILITY)) if (payload[pk] !== undefined) capPatch[ck] = payload[pk];
      await svc.entities.CountryCapability.update(snap.capability_id, capPatch).catch(() : any => {});
      let evidenceIds: string[] = [];
      if (snap.evidence_id) {
        await svc.entities.CapabilityEvidence.update(snap.evidence_id, { verification_status: "VERIFIED", confidence: "HIGH", reviewed_at: now, reviewed_by: user.id || user.email, content_fingerprint: snap.fingerprint }).catch(() : any => {});
        evidenceIds = [snap.evidence_id];
      }
      const all: any[] = await listEvidenceFor(svc, snap.capability_id);
      const two = meetsTwoSourceRule(all);
      if (two.ok) {
        await svc.entities.CountryCapability.update(snap.capability_id, { verification_status: "VERIFIED", status: "PUBLISHED", data_confidence: "CROSS_CHECKED", source_count: all.length, primary_source: all[0]?.source_name, primary_source_type: all[0]?.source_type, source_freshness: "FRESH", next_review_at: nextReviewFromRisk("LOW", now) }).catch(() : any => {});
      } else {
        await svc.entities.CountryCapability.update(snap.capability_id, { verification_status: "RESEARCHING", data_confidence: "SINGLE_SOURCE", next_review_at: nextReviewFromRisk("MEDIUM", now) }).catch(() : any => {});
      }
      let task: any = null;
      if (snap.research_task_id) {
        const t: any = await svc.entities.ResearchTask.get(snap.research_task_id).catch(() : any => null);
        if (t) {
          const target = two.ok ? "VERIFIED" : "READY_FOR_REVIEW";
          if (canTransitionResearch(t.status, target)) {
            task = await svc.entities.ResearchTask.update(snap.research_task_id, { status: target, completed_at: target === "VERIFIED" ? now : null, verification_result: two.ok ? "Two-source satisfied" : two.reason, evidence_ids: evidenceIds.length ? evidenceIds : t.evidence_ids }).catch(() : any => null);
          }
        }
      }
      const updated: any = await svc.entities.CapabilitySourceSnapshot.update(body.snapshot_id, { review_status: "ACCEPTED", reviewed_by: user.id || user.email, reviewed_at: now, applied_to_capability: true }).catch(() : any => null);
      return Response.json({ snapshot: updated, capability: await svc.entities.CountryCapability.get(snap.capability_id).catch(() : any => null), two_source: two, task });
    }
    if (action === "admin-change-reject") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      if (!body.snapshot_id) return Response.json({ error: "snapshot_id required" }, { status: 400 });
      const snap: any = await svc.entities.CapabilitySourceSnapshot.get(body.snapshot_id).catch(() : any => null);
      if (!snap) return Response.json({ error: "Not found" }, { status: 404 });
      const now = new Date().toISOString();
      const updated: any = await svc.entities.CapabilitySourceSnapshot.update(body.snapshot_id, { review_status: "REJECTED", reviewed_by: user.id || user.email, reviewed_at: now, applied_to_capability: false, metadata: { ...(snap.metadata || {}), reject_reason: body.reason || "" } }).catch(() : any => null);
      let task: any = null;
      if (snap.research_task_id) {
        const t: any = await svc.entities.ResearchTask.get(snap.research_task_id).catch(() : any => null);
        if (t && canTransitionResearch(t.status, "REJECTED")) task = await svc.entities.ResearchTask.update(snap.research_task_id, { status: "REJECTED", completed_at: now, verification_result: body.reason || "Change rejected by admin" }).catch(() : any => null);
      }
      return Response.json({ snapshot: updated, task });
    }
    if (action === "admin-second-source-batch") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      // Phase 25 §7: published (VERIFIED+PUBLISHED) destinations with only one official
      // source become the first second-source-completion batch. We DO NOT manufacture a
      // second source — we open (or ensure) a HIGH-priority research task that stays open
      // until an independent qualifying source is actually found.
      const caps: any[] = await svc.entities.CountryCapability.filter({ status: "PUBLISHED", verification_status: "VERIFIED" }, "-priority_score", 500).catch(() : any[] => []);
      const now = new Date().toISOString();
      const batch: any[] = [];
      for (const c of caps) {
        const ev: any[] = await listEvidenceFor(svc, c.id);
        if (meetsTwoSourceRule(ev).ok) continue;
        const taskKey = `${c.id}|general_destination|second_source`;
        const existing: any[] = await svc.entities.ResearchTask.filter({ task_key: taskKey }, "-created_at", 5).catch(() : any[] => []);
        if (existing.some((t) => ["QUEUED", "IN_PROGRESS"].includes(t.status))) { batch.push({ capability_id: c.id, country_code: c.country_code, task: existing[0], already_queued: true }); continue; }
        const official = ev.filter((e) => OFFICIAL_ST.has(e.source_type) && e.verification_status === "VERIFIED");
        const row = {
          country_capability_id: c.id, country_code: c.country_code, journey_type: c.journey_type,
          claim_type: "general_destination", priority: "HIGH", status: "QUEUED", assigned_to: null,
          created_at: now, started_at: null, completed_at: null, due_at: nextReviewFromRisk("MEDIUM", now),
          source_requirements: `Find an independent second source to satisfy the two-source rule (current: ${official.length} official source${official.length === 1 ? "" : "s"}, ${ev.length} total).`,
          verification_result: null, evidence_ids: official.map((e) => e.id), task_key: taskKey,
          generated_by: "manual", notes: `Second-source completion batch — official sources: ${official.map((o) => o.source_name || o.source_type).join(", ") || "none"}`, metadata: { batch: "second_source", official_count: official.length },
        };
        const t: any = await svc.entities.ResearchTask.create(row).catch(() : any => null);
        if (t) batch.push({ capability_id: c.id, country_code: c.country_code, task: t });
      }
      return Response.json({ batch_size: batch.length, batch });
    }
    if (action === "admin-freshness-recompute") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      // Phase 25 §6: drive next_review_at from change_risk across all capabilities and
      // recompute stale downstates so the research queue reflects real maintenance needs.
      const caps: any[] = await svc.entities.CountryCapability.filter({}, "-priority_score", 1000).catch(() : any[] => []);
      const today = new Date().toISOString();
      let recomputed = 0, downstated = 0;
      for (const c of caps) {
        const risk = c.change_risk || deriveChangeRisk(c, []);
        const patch: any = { next_review_at: nextReviewFromRisk(risk, today), change_risk: risk };
        if (staleDownstate(c, today) && (c.verification_status === "VERIFIED" || c.verification_status === "PARTIALLY_VERIFIED")) {
          patch.verification_status = "STALE"; patch.previous_verification_status = c.verification_status; patch.source_freshness = "STALE"; downstated++;
        }
        await svc.entities.CountryCapability.update(c.id, patch).catch(() : any => {});
        recomputed++;
      }
      return Response.json({ recomputed, downstated });
    }
    // ---------- END PHASE 25 CHANGE DETECTION ACTIONS ----------

    if (action === "seed-catalog") {
      if (user.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });
      const catalog = await ensureVisaCatalog(svc);
      const requirements = await ensureVisaRequirements(svc);
      const questions = await ensureQuestionCatalog(svc);
      const forms = await ensureFormCatalog(svc);
      const submissions = await ensureSubmissionCatalog(svc);
      const appointments = await ensureAppointmentCatalog(svc);
      const payments = await ensurePaymentCatalog(svc);
      const execution = await ensureExecutionCatalog(svc);
      const templates = await ensureTemplateCatalog(svc);
      const rules = await ensureRuleCatalog(svc);
      const reviewRules = await ensureReviewCatalog(svc);
      const discovery = await ensureDiscoveryCatalog(svc);
      const publish = await ensurePublishCatalog(svc);
      const entry = await ensureEntryCatalog(svc);
      const providerSource = await ensureProviderSource(svc).catch(() => null);
      return Response.json({ ok: true, seeded: { catalog, requirements, questions, forms, submissions, appointments, payments, execution, templates, rules, reviewRules, discovery, publish, entry, providerSource } });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e), code: e?.code }, { status: 500 });
  }
}