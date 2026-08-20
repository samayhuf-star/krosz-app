import { base44 } from "@/api/base44Client";

async function invoke(payload) {
  try {
    const res = await base44.functions.invoke("visaApi", payload);
    return res?.data ?? res;
  } catch (error) {
    const backend = error?.response?.data || error?.data;
    const message = backend?.error || backend?.message || error?.message || "Visa API request failed";
    throw Object.assign(new Error(message), { code: backend?.code || error?.code, status: error?.status || error?.response?.status });
  }
}

export const listDestinations = () => invoke({ action: "list-destinations" });
export const checkEligibility = (p) => invoke({ action: "check-eligibility", ...p });
export const getRequirements = (destination, purpose) => invoke({ action: "get-requirements", destination, purpose });
export const getApplicationProgress = (id) => invoke({ action: "get-application-progress", id });
export const approveApplication = (id) => invoke({ action: "approve-application", id });
export const advanceApplication = (id) => invoke({ action: "advance-application", id });
export const createApplication = (p) => invoke({ action: "create-application", ...p });
export const getApplication = (id) => invoke({ action: "get-application", id });
export const listApplications = () => invoke({ action: "list-applications" });
export const listTravelers = () => invoke({ action: "list-travelers" });
export const createTraveler = (p) => invoke({ action: "create-traveler", ...p });
export const seedCatalog = () => invoke({ action: "seed-catalog" });

// ---------- Document Vault (Phase 4) ----------
export const getDocumentConfig = () => invoke({ action: "get-document-config" });
export const listDocuments = (traveler_id) => invoke({ action: "list-documents", traveler_id });
export const getDocument = (id) => invoke({ action: "get-document", id });
export const createDocument = (p) => invoke({ action: "create-document", ...p });
export const replaceDocument = (p) => invoke({ action: "replace-document", ...p });
export const deleteDocument = (id) => invoke({ action: "delete-document", id });
export const findReusableDocuments = (p) => invoke({ action: "find-reusable-documents", ...p });
export const validateDocumentForApplication = (p) => invoke({ action: "validate-document-for-application", ...p });
export const attachDocument = (p) => invoke({ action: "attach-document", ...p });
export const detachDocument = (p) => invoke({ action: "detach-document", ...p });
export const listApplicationDocuments = (id) => invoke({ action: "list-application-documents", id });
export const processDocument = (version_id) => invoke({ action: "process-document", version_id });
export const getDocumentIntelligence = (version_id) => invoke({ action: "get-document-intelligence", version_id });
export const validateApplicationDocuments = (id) => invoke({ action: "validate-application-documents", id });

// ---------- Phase 17: Document Intelligence lifecycle & resolution ----------
export const confirmDocumentExtraction = (version_id, confirmed) => invoke({ action: "confirm-extraction", version_id, confirmed });
export const retryDocumentProcessing = (version_id) => invoke({ action: "retry-processing", version_id });
export const detectDuplicateDocuments = (traveler_id) => invoke({ action: "detect-duplicates", traveler_id });
export const proposePrefill = (id, version_id) => invoke({ action: "propose-prefill", id, version_id });
export const applyPrefill = (id, version_id, opts = {}) => invoke({ action: "apply-prefill", id, version_id, ...opts });
export const getResolutionCenter = (id) => invoke({ action: "get-resolution-center", id });
export const runIntelligenceContractTests = () => invoke({ action: "run-intelligence-contract-tests" });
export const evaluateMvpEngine = (engine, input) => invoke({ action: "mvp-evaluate-engine", engine, input });
export const recordDocumentEngineResult = (version_id, engine, result, application_id) => invoke({ action: "mvp-record-document-engine-result", version_id, engine, result, application_id });
export const runMvpEngineContractTests = () => invoke({ action: "run-mvp-engine-contract-tests" });

// ---------- Question Engine (Phase 6) ----------
export const getQuestions = (id) => invoke({ action: "get-questions", id });
export const getAnswers = (id) => invoke({ action: "get-answers", id });
export const putAnswer = (p) => invoke({ action: "put-answer", ...p });
export const bulkAnswers = (id, answers) => invoke({ action: "bulk-answers", id, answers });
export const checkReadiness = (id) => invoke({ action: "check-readiness", id });
export const seedQuestions = () => invoke({ action: "seed-questions" });

// ---------- Government Form Engine (Phase 7) ----------
export const listForms = (p = {}) => invoke({ action: "list-forms", ...p });
export const getForm = (form_definition_id) => invoke({ action: "get-form", form_definition_id });
export const resolveForm = (id) => invoke({ action: "resolve-form", id });
export const generateForm = (id, form_definition_id) => invoke({ action: "generate-form", id, form_definition_id });
export const checkFormStaleness = (id, form_definition_id) => invoke({ action: "check-form-staleness", id, form_definition_id });
export const listSnapshots = (id) => invoke({ action: "list-snapshots", id });
export const exportSnapshot = (snapshot_id, format = "json") => invoke({ action: "export-snapshot", snapshot_id, format });
export const buildPackage = (id, form_definition_id) => invoke({ action: "build-package", id, form_definition_id });
export const listPackages = (id) => invoke({ action: "list-packages", id });
export const putOverride = (p) => invoke({ action: "put-override", ...p });
export const validateFormPublish = (form_definition_id) => invoke({ action: "validate-form-publish", form_definition_id });

// ---------- Submission Provider Engine (Phase 8) ----------
export const listSubmissionProviders = () => invoke({ action: "list-submission-providers" });
export const listSubmissionRoutes = () => invoke({ action: "list-submission-routes" });
export const resolveSubmissionProvider = (id) => invoke({ action: "resolve-submission-provider", id });
export const approveSubmission = (id) => invoke({ action: "approve-submission", id });
export const createSubmission = (id) => invoke({ action: "create-submission", id });
export const submitSubmission = (id) => invoke({ action: "submit-submission", id });
export const getSubmissionStatusApi = (submission_id) => invoke({ action: "get-submission-status", submission_id });
export const enterExternalReference = (submission_id, external_reference) => invoke({ action: "enter-external-reference", submission_id, external_reference });
export const uploadReceipt = (submission_id, p) => invoke({ action: "upload-receipt", submission_id, ...p });
export const cancelSubmission = (submission_id) => invoke({ action: "cancel-submission", submission_id });
export const listSubmissions = (id) => invoke({ action: "list-submissions", id });
export const getSubmission = (submission_id) => invoke({ action: "get-submission", submission_id });
export const checkPackageIntegrity = (id) => invoke({ action: "check-package-integrity", id });
export const runSubmissionContractTests = () => invoke({ action: "run-submission-contract-tests" });
export const seedSubmissionCatalog = () => invoke({ action: "seed-submission-catalog" });

// ---------- Appointment + VAC/Embassy Engine (Phase 9) ----------
export const getAppointmentRequirements = (id) => invoke({ action: "get-appointment-requirements", id });
export const checkAppointmentReadiness = (id) => invoke({ action: "check-appointment-readiness", id });
export const listAppointmentLocations = (id, requirement_id) => invoke({ action: "list-appointment-locations", id, requirement_id });
export const findAppointmentSlots = (p) => invoke({ action: "find-appointment-slots", ...p });
export const holdAppointmentSlot = (id, slot_id) => invoke({ action: "hold-appointment-slot", id, slot_id });
export const bookAppointment = (p) => invoke({ action: "book-appointment", ...p });
export const rescheduleAppointment = (p) => invoke({ action: "reschedule-appointment", ...p });
export const cancelAppointment = (appointment_id) => invoke({ action: "cancel-appointment", appointment_id });
export const getAppointmentStatusApi = (appointment_id) => invoke({ action: "get-appointment-status", appointment_id });
export const confirmAttendance = (appointment_id, outcome) => invoke({ action: "confirm-attendance", appointment_id, outcome });
export const submitPassport = (p) => invoke({ action: "submit-passport", ...p });
export const returnPassport = (p) => invoke({ action: "return-passport", ...p });
export const listPassportCustody = (id) => invoke({ action: "list-passport-custody", id });
export const attachAppointmentConfirmation = (p) => invoke({ action: "attach-appointment-confirmation", ...p });
export const listAppointments = (id) => invoke({ action: "list-appointments", id });
export const opsListAppointments = (p = {}) => invoke({ action: "ops-list-appointments", ...p });
export const seedAppointmentCatalog = () => invoke({ action: "seed-appointment-catalog" });
export const runAppointmentContractTests = () => invoke({ action: "run-appointment-contract-tests" });

// ---------- Payments, Pricing, Orders & Refunds (Phase 10) ----------
export const getQuote = (id) => invoke({ action: "get-quote", id });
export const getPaymentGate = (id) => invoke({ action: "get-payment-gate", id });
export const createOrder = (id, opts = {}) => invoke({ action: "create-order", id, ...(typeof opts === "number" ? { client_total_minor: opts } : opts) });
export const getOrderApi = (order_id) => invoke({ action: "get-order", order_id });
export const listOrdersApi = (p = {}) => invoke({ action: "list-orders", ...p });
export const createCheckout = (order_id) => invoke({ action: "create-checkout", order_id });
export const reconcilePayment = (payment_id, opts = {}) => invoke({ action: "reconcile-payment", payment_id, ...opts });
export const retryPayment = (order_id) => invoke({ action: "retry-payment", order_id });
export const cancelOrder = (order_id) => invoke({ action: "cancel-order", order_id });
export const requestRefund = (order_id, p) => invoke({ action: "request-refund", order_id, ...p });
export const approveRefund = (refund_id) => invoke({ action: "approve-refund", refund_id });
export const executeRefund = (refund_id) => invoke({ action: "execute-refund", refund_id });
export const listPayments = (order_id) => invoke({ action: "list-payments", order_id });
export const listRefunds = (order_id) => invoke({ action: "list-refunds", order_id });
export const listInvoices = (order_id) => invoke({ action: "list-invoices", order_id });
export const canExecutePaidService = (id, service) => invoke({ action: "can-execute-paid-service", id, service });
export const adminListOrders = (p = {}) => invoke({ action: "admin-list-orders", ...p });
export const adminListPayments = (p = {}) => invoke({ action: "admin-list-payments", ...p });
export const adminListRefunds = () => invoke({ action: "admin-list-refunds" });
export const adminListInvoices = () => invoke({ action: "admin-list-invoices" });
export const seedPaymentCatalog = () => invoke({ action: "seed-payment-catalog" });
export const runPaymentContractTests = () => invoke({ action: "run-payment-contract-tests" });

// ---------- Submission Execution / Browser Agent (Phase 11) ----------
export const executionStart = (id, opts = {}) => invoke({ action: "execution-start", id, ...opts });
export const executionResume = (session_id, opts = {}) => invoke({ action: "execution-resume", session_id, ...opts });
export const executionPause = (session_id) => invoke({ action: "execution-pause", session_id });
export const executionCancel = (session_id, reason) => invoke({ action: "execution-cancel", session_id, reason });
export const executionRecover = (session_id) => invoke({ action: "execution-recover", session_id });
export const executionStatus = (session_id) => invoke({ action: "execution-status", session_id });
export const executionList = (id) => invoke({ action: "execution-list", id });
export const executionPlan = (id) => invoke({ action: "execution-plan", id });
export const executionResolveAction = (action_request_id, resolution_action, detail) => invoke({ action: "execution-resolve-action", action_request_id, resolution_action, detail });
export const executionSwitchManual = (session_id) => invoke({ action: "execution-switch-manual", session_id });
export const opsListExecutions = (p = {}) => invoke({ action: "ops-list-executions", ...p });
export const seedExecutionCatalog = () => invoke({ action: "seed-execution-catalog" });
export const runExecutionContractTests = () => invoke({ action: "run-execution-contract-tests" });

// Private storage helpers (reuse existing Core integrations; short-lived signed URLs).
export const uploadPrivateDocument = async (file) => {
  const res = await base44.integrations.Core.UploadPrivateFile({ file });
  if (typeof res?.file_uri !== "string" || !res.file_uri) throw new Error("Private upload did not return file_uri");
  return res.file_uri;
};
export const getSignedDocumentUrl = async (file_uri) => {
  const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri });
  if (typeof res?.signed_url !== "string" || !res.signed_url) throw new Error("Signed URL request did not return signed_url");
  return res.signed_url;
};

// ---------- Phase 12: Journey, Notifications & Support ----------
export const getApplicationJourney = (id) => invoke({ action: "get-application-journey", id });
export const refreshJourney = (id) => invoke({ action: "refresh-journey", id });
export const listActions = (id) => invoke({ action: "list-actions", id });
export const completeAction = (action_id) => invoke({ action: "complete-action", action_id });
export const listNotifications = (p = {}) => invoke({ action: "list-notifications", ...p });
export const markNotificationRead = (notification_id) => invoke({ action: "mark-notification-read", notification_id });
export const archiveNotification = (notification_id) => invoke({ action: "archive-notification", notification_id });
export const getNotificationPreferences = () => invoke({ action: "get-notification-preferences" });
export const setNotificationPreferences = (patch) => invoke({ action: "set-notification-preferences", patch });
export const createSupportTicket = (p) => invoke({ action: "create-support-ticket", ...p });
export const listSupportTickets = (id) => invoke({ action: "list-support-tickets", id });
export const listConversationMessages = (conversation_id) => invoke({ action: "list-conversation-messages", conversation_id });
export const sendSupportMessage = (conversation_id, body, attachments) => invoke({ action: "send-support-message", conversation_id, body, attachments });
export const addInternalNote = (p) => invoke({ action: "add-internal-note", ...p });
export const listInternalNotes = (id) => invoke({ action: "list-internal-notes", id });
export const assignTicket = (ticket_id, assignee_id) => invoke({ action: "assign-ticket", ticket_id, assignee_id });
export const resolveTicket = (ticket_id, resolution) => invoke({ action: "resolve-ticket", ticket_id, resolution });
export const adminListSupportTickets = (p = {}) => invoke({ action: "admin-list-support-tickets", ...p });
export const ensureJourneyCatalog = () => invoke({ action: "ensure-journey-catalog" });

// ---------- Phase 13: Application Review & Submission QA ----------
export const runReview = (id, opts = {}) => invoke({ action: "run-review", id, ...opts });
export const listReviews = (id) => invoke({ action: "list-reviews", id });
export const getReview = (review_id) => invoke({ action: "get-review", review_id });
export const listReviewFindings = (review_id) => invoke({ action: "list-review-findings", review_id });
export const canSubmitApplication = (id) => invoke({ action: "can-submit-application", id });
export const waiveReviewFinding = (finding_id, reason) => invoke({ action: "waive-review-finding", finding_id, reason });
export const dismissReviewFinding = (finding_id, reason) => invoke({ action: "dismiss-review-finding", finding_id, reason });
export const adminListReviews = (p = {}) => invoke({ action: "admin-list-reviews", ...p });
export const seedReviewCatalog = () => invoke({ action: "seed-review-catalog" });
export const runReviewContractTests = () => invoke({ action: "run-review-contract-tests" });

// ---------- Phase 16: Application Workspace ----------
export const getWorkspace = (id) => invoke({ action: "get-workspace", id });
export const startWorkspace = (id) => invoke({ action: "start-workspace", id });
export const getWorkspaceReadiness = (id) => invoke({ action: "get-readiness", id });
export const getWorkspaceChecklist = (id) => invoke({ action: "get-checklist", id });
export const getWorkspaceProgress = (id) => invoke({ action: "get-progress", id });
export const getWorkspaceValidation = (id) => invoke({ action: "get-validation", id });
export const updateApplication = (id, patch) => invoke({ action: "update-application", id, patch });
export const cancelApplication = (id) => invoke({ action: "cancel-application", id });
export const runWorkspaceContractTests = () => invoke({ action: "run-workspace-contract-tests" });

// ---------- Phase 18: Final Review, Confirmation & Commercial ----------
export const getFinalReview = (id) => invoke({ action: "get-final-review", id });
export const enterFinalReview = (id) => invoke({ action: "enter-final-review", id });
export const startUserReview = (id) => invoke({ action: "start-user-review", id });
export const confirmApplicationApi = (id) => invoke({ action: "confirm-application", id });
export const getPaidMutationImpact = (id) => invoke({ action: "get-paid-mutation-impact", id });
export const invalidatePricedContext = (id, reason) => invoke({ action: "invalidate-priced-context", id, reason });
export const listFinancialEvents = (id) => invoke({ action: "list-financial-events", id });
export const runFinalReviewContractTests = () => invoke({ action: "run-finalreview-contract-tests" });

// ---------- Phase 15: Visa Discovery & Country Intelligence ----------
export const listNationalities = () => invoke({ action: "list-nationalities" });
export const listTravelPurposes = () => invoke({ action: "list-travel-purposes" });
export const discover = (p) => invoke({ action: "discover", ...p });
export const getDestinationDetail = (code) => invoke({ action: "get-destination-detail", code });
export const getVisaOption = (id) => invoke({ action: "get-visa-option", id });
export const seedDiscoveryCatalog = () => invoke({ action: "seed-discovery-catalog" });
export const runDiscoveryContractTests = () => invoke({ action: "run-discovery-contract-tests" });

// ---------- Phase 19: Operations Case, Review Queue, Manual Submission & Tracking ----------
export const opsPrepare = (id, opts = {}) => invoke({ action: "ops-prepare", id, ...opts });
export const opsListQueue = (filters = {}) => invoke({ action: "ops-list-queue", filters });
export const opsGetCase = (case_id) => invoke({ action: "ops-get-case", case_id });
export const opsAssign = (case_id, assignee_id) => invoke({ action: "ops-assign", case_id, assignee_id });
export const opsStartReview = (case_id) => invoke({ action: "ops-start-review", case_id });
export const opsRequestInfo = (case_id, message) => invoke({ action: "ops-request-info", case_id, message });
export const opsRequestDocument = (case_id, message) => invoke({ action: "ops-request-document", case_id, message });
export const opsFlagIssue = (case_id, reason) => invoke({ action: "ops-flag-issue", case_id, reason });
export const opsRejectPackage = (case_id, reason) => invoke({ action: "ops-reject-package", case_id, reason });
export const opsReturn = (case_id, reason) => invoke({ action: "ops-return", case_id, reason });
export const opsEscalate = (case_id, reason) => invoke({ action: "ops-escalate", case_id, reason });
export const opsApprove = (case_id) => invoke({ action: "ops-approve", case_id });
export const opsListPostPaymentReviews = (filters = {}) => invoke({ action: "ops-list-post-payment-reviews", filters });
export const opsGetPostPaymentReview = (review_id) => invoke({ action: "ops-get-post-payment-review", review_id });
export const opsStartVerifierReview = (review_id) => invoke({ action: "ops-start-verifier-review", review_id });
export const opsVerifierDecision = (review_id, decision, reason_code = '', reason = '') => invoke({ action: "ops-verifier-decision", review_id, decision, reason_code, reason });
export const opsCeoDecision = (review_id, approve_refund, reason = '') => invoke({ action: "ops-ceo-decision", review_id, approve_refund, reason });
export const opsStartSubmission = (case_id) => invoke({ action: "ops-start-submission", case_id });
export const opsConfirmSubmission = (case_id, payload) => invoke({ action: "ops-confirm-submission", case_id, ...payload });
export const opsEnterTracking = (case_id, update) => invoke({ action: "ops-enter-tracking", case_id, ...update });
export const opsHandleDecision = (case_id, payload) => invoke({ action: "ops-handle-decision", case_id, ...payload });
export const opsDashboard = () => invoke({ action: "ops-dashboard" });
export const opsSupportContext = (id) => invoke({ action: "ops-support-context", id });
export const travelerStatus = (id) => invoke({ action: "traveler-status", id });
export const runOperationsContractTests = () => invoke({ action: "run-operations-contract-tests" });

// ---------- Phase 20: Traveler Account, Multi-Traveler, Trip/Group, Settings ----------
export const accountDashboard = () => invoke({ action: "account-dashboard" });
export const accountListTravelers = (include_archived = false) => invoke({ action: "list-travelers-v2", include_archived });
export const accountGetTraveler = (traveler_id) => invoke({ action: "get-traveler", traveler_id });
export const accountCreateTraveler = (p) => invoke({ action: "create-traveler-v2", ...p });
export const accountUpdateTraveler = (traveler_id, patch) => invoke({ action: "update-traveler", traveler_id, patch });
export const accountArchiveTraveler = (traveler_id) => invoke({ action: "archive-traveler", traveler_id });
export const accountSetPrimary = (traveler_id) => invoke({ action: "set-primary-traveler", traveler_id });
export const listPassports = (traveler_id) => invoke({ action: "list-passports", traveler_id });
export const addPassport = (traveler_id, data) => invoke({ action: "add-passport", traveler_id, ...data });
export const listTravelerApplications = (traveler_id) => invoke({ action: "list-traveler-applications", traveler_id });
export const accountAudit = () => invoke({ action: "account-audit" });
export const listTrips = () => invoke({ action: "list-trips" });
export const createTrip = (p) => invoke({ action: "create-trip", ...p });
export const updateTrip = (group_id, patch) => invoke({ action: "update-trip", group_id, patch });
export const getTripProgress = (group_id) => invoke({ action: "get-trip-progress", group_id });
export const accountSettings = () => invoke({ action: "account-settings" });
export const requestDeletion = (reason) => invoke({ action: "request-deletion", reason });
export const cancelDeletion = () => invoke({ action: "cancel-deletion" });
export const deletionStatus = () => invoke({ action: "deletion-status" });
export const supportContext = (p) => invoke({ action: "support-context", ...p });
export const runAccountContractTests = () => invoke({ action: "run-account-contract-tests" });

// ---------- Phase 21: Destination Discovery, Search, SEO & Conversion ----------
export const publishSearch = (query, opts = {}) => invoke({ action: "publish-search", query, ...opts });
export const publishDestinationPage = (slug, opts = {}) => invoke({ action: "publish-destination-page", slug, ...opts });
export const publishPopular = (limit = 8) => invoke({ action: "publish-popular", limit });
export const publishRelated = (country_code) => invoke({ action: "publish-related", country_code });
export const publishSaveDestination = (country_code) => invoke({ action: "publish-save-destination", country_code });
export const publishUnsaveDestination = (country_code) => invoke({ action: "publish-unsave-destination", country_code });
export const publishIsSaved = (country_code) => invoke({ action: "publish-is-saved", country_code });
export const publishListSaved = () => invoke({ action: "publish-list-saved" });
export const publishSeoFeed = (base = "") => invoke({ action: "publish-seo-feed", base });
export const publishListExperiments = (audience) => invoke({ action: "publish-list-experiments", audience });
export const publishUpsertExperiment = (p) => invoke({ action: "publish-upsert-experiment", ...p });
export const publishSaveContent = (p) => invoke({ action: "publish-save-content", ...p });
export const publishListContent = () => invoke({ action: "publish-list-content" });
export const runPublishContractTests = () => invoke({ action: "run-publish-contract-tests" });

// ---------- Visa Intelligence Provider ----------
export const intelligenceRequirement = (passport, destination, bypass_cache = false) => invoke({ action: "intelligence-requirement", passport, destination, bypass_cache });
export const intelligenceHealth = () => invoke({ action: "intelligence-health" });
export const intelligenceResetHealth = () => invoke({ action: "intelligence-reset-health" });
export const adminTravelBuddyAcceptance = () => invoke({ action: "admin-travel-buddy-acceptance" });
// Legacy Pipeworx-specific helpers remain for existing admin screens.
export const pipeworxRequirement = (passport, destination, bypass_cache = false) => invoke({ action: "pipeworx-requirement", passport, destination, bypass_cache });
export const pipeworxFreeDestinations = (passport) => invoke({ action: "pipeworx-free-destinations", passport });
export const pipeworxCompare = (passports) => invoke({ action: "pipeworx-compare", passports });
export const pipeworxInvalidate = (opts = {}) => invoke({ action: "pipeworx-invalidate", ...opts });
export const pipeworxHealth = () => invoke({ action: "pipeworx-health" });
export const pipeworxResetHealth = () => invoke({ action: "pipeworx-reset-health" });
export const pipeworxCacheList = (limit = 100) => invoke({ action: "pipeworx-cache-list", limit });
export const runProviderContractTests = () => invoke({ action: "run-provider-contract-tests" });

// ---------- Phase 22: Travel Entry Engine + Country Capability Matrix ----------
export const getTravelEntry = (p) => invoke({ action: "entry-get", ...p });
export const listEntryCapabilities = () => invoke({ action: "entry-list-capabilities" });
export const entryFamilyReadiness = (p) => invoke({ action: "entry-family-readiness", ...p });
export const adminEntryList = () => invoke({ action: "admin-entry-list" });
export const adminEntryUpsert = (p) => invoke({ action: "admin-entry-upsert", ...p });
export const adminEntryPublish = (capability_id) => invoke({ action: "admin-entry-publish", capability_id });
export const adminEntrySuspend = (capability_id) => invoke({ action: "admin-entry-suspend", capability_id });
export const entryValidationReport = () => invoke({ action: "entry-validation-report" });
export const seedEntryCatalog = () => invoke({ action: "seed-entry-catalog" });
export const runEntryContractTests = () => invoke({ action: "run-entry-contract-tests" });

// ---------- Phase 23: Country x Provider x Execution Capability Matrix ----------
export const adminEntryDetail = (p) => invoke({ action: "admin-entry-detail", ...p });
export const adminProviderList = () => invoke({ action: "admin-provider-list" });
export const adminProviderUpsert = (p) => invoke({ action: "admin-provider-upsert", ...p });
export const adminBindingList = (p = {}) => invoke({ action: "admin-binding-list", ...p });
export const adminBindingUpsert = (p) => invoke({ action: "admin-binding-upsert", ...p });
export const adminResearchSetStatus = (p) => invoke({ action: "admin-research-set-status", ...p });
export const adminEntryExport = () => invoke({ action: "admin-entry-export" });

// ---------- Phase 24: Verification, evidence, research-workflow admin ----------
export const adminEvidenceList = (capability_id) => invoke({ action: "admin-evidence-list", capability_id });
export const adminEvidenceCreate = (p) => invoke({ action: "admin-evidence-create", ...p });
export const adminEvidenceUpdate = (p) => invoke({ action: "admin-evidence-update", ...p });
export const adminEvidenceVerify = (p) => invoke({ action: "admin-evidence-verify", ...p });
export const adminResearchList = (p = {}) => invoke({ action: "admin-research-list", ...p });
export const adminResearchCreate = (p) => invoke({ action: "admin-research-create", ...p });
export const adminResearchClaim = (p) => invoke({ action: "admin-research-claim", ...p });
export const adminResearchTransition = (p) => invoke({ action: "admin-research-transition", ...p });
export const adminResearchComplete = (p) => invoke({ action: "admin-research-complete", ...p });
export const adminProviderVerify = (p) => invoke({ action: "admin-provider-verify", ...p });
export const adminBindingExecution = (p) => invoke({ action: "admin-binding-execution", ...p });
export const adminStaleGenerate = () => invoke({ action: "admin-stale-generate" });
export const adminVerificationSummary = () => invoke({ action: "admin-verification-summary" });
export const adminVerificationExport = () => invoke({ action: "admin-verification-export" });

// ---------- Phase 25: Source Snapshot, Change Detection & Verification Maintenance ----------
export const adminSnapshotCapture = (p) => invoke({ action: "admin-snapshot-capture", ...p });
export const adminSnapshotList = (p = {}) => invoke({ action: "admin-snapshot-list", ...p });
export const adminChangeReviewList = () => invoke({ action: "admin-change-review-list" });
export const adminChangeAccept = (snapshot_id) => invoke({ action: "admin-change-accept", snapshot_id });
export const adminChangeReject = (p) => invoke({ action: "admin-change-reject", ...p });
export const adminSecondSourceBatch = () => invoke({ action: "admin-second-source-batch" });
export const adminFreshnessRecompute = () => invoke({ action: "admin-freshness-recompute" });