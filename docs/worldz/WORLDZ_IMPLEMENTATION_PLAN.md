# WORLDZ VISA — Implementation Plan (Phase 0)

Execution order follows spec §64. Every phase exits runnable: build passes, existing
ORCHESTRAL + legacy launch features remain intact, the new surface is feature-flagged
(`visa_engine`) and dark until verified. Phase-done report format in spec §68.

Guiding rule (spec §67): **Worldz Visa is a domain on the existing orchestrator, not a
second orchestrator.** No new Run/Task/DAG/Provider/Agent/Context/Memory/Audit/Event/Approval
systems. New code lives in `base44/shared/visa/`, new entities in `base44/entities/`,
new pages under `src/pages/visa/`, new `/v1` routes extend `orchestralApi`.

---

## Phase sequencing (summary)

| Phase | Scope | Key deliverables |
|---|---|---|
| 0 | Audit + plan (this doc set) | 3 docs ✅ |
| 1 | Visa domain foundation | Country, VisaType, VisaRoute, Traveler, Passport, VisaApplication; VisaRouteResolver + tests |
| 2 | Visa knowledge graph | Requirements, rules, sources, versions, eligibility; seed catalog |
| 3 | State machine + plan templates | VisaApplication FSM + `visa-*-v1` PlanTemplates + adapters skeleton + archTests |
| 4 | Document vault | TravelerDocument + signed URLs + vault API + UI cards |
| 5 | Document/passport intelligence | Extraction pipeline, findings, statuses; visa doc adapters |
| 6 | Dynamic question engine | ApplicationQuestion + visibility/validation rules + UI |
| 7 | Form engine | FormDefinition/Version/Field + mapping + validation; prepare_form adapter |
| 8 | Risk + consistency engine | RiskAssessment + cross-doc consistency; review-task integration |
| 9 | Consumer web | Destinations, visa pages, dashboard, application workspace, timeline |
| 10 | Operations console | Ops dashboards, operator workspace, admin config |
| 11 | Providers + first adapters | Visa capability providers, mock + 1 real adapter, fallback chain |
| 12 | Appointments + status tracking | Appointment engine, status normalization, monitoring worker |
| 13 | Payments + refunds | Stripe install, Payment/Invoice/RefundRule, idempotency |
| 14 | Comms + AI concierge | WhatsApp/email notifications, Ask Visa AI |
| 15 | Enterprise + group travel | Trip, manager approval, shared data |
| 16 | MCP server + public API | `/v1` visa routes, MCP tools (same services) |
| 17 | Rejection recovery | Refusal pipeline + agent + reapplication plan |
| 18 | Production hardening | Retention, rate limits, PII redaction, E2E suite, metrics |

---

## Phase 1 — Visa domain foundation

**Entities (create, all with `tenant_id` + RLS as in existing entities):**
`Country`, `VisaType`, `VisaRoute` (resolved route snapshot), `Traveler`, `Passport`, `VisaApplication`.

**Shared modules:**
- `base44/shared/visa/catalog.ts` — country/visa-type lookup.
- `base44/shared/visa/resolver.ts` — `resolveVisaRoute({nationality,residence,destination,purpose,travel_dates})` → deterministic; no LLM.
- `base44/shared/visa/traveler.ts` — CRUD + manual/extracted precedence for passport.
- `base44/shared/visa/application.ts` — create application, bind to a Run (stub for now).

**HTTP surface:** extend `orchestralApi` with `GET /v1/destinations`, `POST /v1/eligibility/check`,
`POST /v1/applications` (idempotent). Add a `visaCore` backend function only if a function is cleaner
than routerMUX; prefer extending `orchestralApi`.

**Tests:** mirror `archTests` shape — `base44/functions/visaTests/entry.ts` asserting:
country catalog lookup, route resolution determinism, application creation binds a Run,
passport manual-vs-extracted precedence, tenant isolation.

**Exit gate:** resolver is deterministic, application creates a durable `LaunchPlan` with
provenance `{application_id}`; tests green; existing ORCHESTRAL arch tests still green.

---

## Phase 2 — Visa knowledge graph

**Entities:** `VisaRequirement` (versioned), `RequirementRule` (conditional DAG),
`DocumentRequirement`, `FeeDefinition`, `ProcessingTime`, `AppointmentRequirement`,
`SubmissionMethod`, `VisaSource`, `SourceSnapshot`, `EligibilityRule`.

**Shared modules:**
- `base44/shared/visa/requirements.ts` — resolve requirements for a route+traveller profile;
  apply conditional rules; emit `mandatory|conditional|optional|recommended|not_applicable`.
- `base44/shared/visa/provenance.ts` — source_type/url/retrieved_at/verified_at/confidence.
- `base44/shared/visa/rules.ts` — structured rule representation (DAG of triggers).

**Seed (dev-labeled):** India → {UAE, Thailand, Vietnam, Singapore, France, Germany,
Italy, UK, USA, Japan}, purposes tourist/business/student. All rows:
`source_type: secondary_reference`, `confidence < 1`, `status: draft`, UI badge "Unverified".

**Tests:** requirement resolution for known routes, conditional path correctness
(employed vs self-employed vs student vs sponsored), version supersede keeps olds immutable.

**Exit gate:** requirements for at least the 10 seed routes resolve deterministically and
match rule expectations; no destructive updates.

---

## Phase 3 — State machine + orchestrator plan templates

**VisaApplication FSM (spec §17):** DRAFT → ELIGIBILITY_CONFIRMED → DOCUMENTS_PENDING →
DOCUMENT_REVIEW → APPLICATION_READY → USER_APPROVAL → APPOINTMENT_PENDING →
APPOINTMENT_BOOKED → SUBMISSION_READY → SUBMITTED → GOVERNMENT_PROCESSING →
ADDITIONAL_DOCUMENTS → DECISION → {APPROVED|REFUSED|CANCELLED|WITHDRAWN|COMPLETED}.
Every transition emits an immutable `ApplicationEvent` (reuses audit/event infra).

**Plan templates (versioned `PlanTemplate` rows via `ensureVisaTemplates`):**
`visa-tourist-standard-v1`, `visa-business-standard-v1`, `visa-student-standard-v1`.
Task keys + `approval_gate` at `user_review` and (default) before `submit_application`.

**Adapters (register in existing `REGISTRY`):** skeleton adapters for each task key that
emit stage progress + AIExecution rows; real logic filled in later phases. Stub behavior
is deterministic for tests (no LLM) — mirrors `stub_adapter` pattern.

**Tests:** extend `visaTests` — application launch runs the DAG to `awaiting_approval`,
approval unblocks submission, retry works, cancel works (reuse `archTests` patterns).

**Exit gate:** a visa application runs end-to-end on stub adapters through to the user
review gate; FSM transitions audited; existing arch tests untouched.

---

## Phase 4 — Document vault

**Entities:** `TravelerDocument`. Reuse `UploadPrivateFile` + `CreateFileSignedUrl`
(short-lived only — no permanent URLs in API responses).

**Shared:** `base44/shared/visa/vault.ts` — upload, replace, supersede, list, signed-url minting,
sha256 dedupe, expiry tracking, "used in" reverse index.

**API:** `POST /v1/applications/:id/documents`, `GET …/documents` (signed URLs only),
`DELETE`, `Replace`.

**UI:** `src/pages/visa/Documents.jsx` + doc cards (spec §39: verified / needs-attention /
rejected / expires-in / used-in / view / replace).

**Tests:** upload → persisted private, public API never returns the storage key, signed
URL expiry, supersede keeps history.

---

## Phase 5 — Passport / document intelligence

**Entities:** `DocumentExtraction`, `DocumentFinding`.
**Shared:** `base44/shared/visa/docs/pipeline.ts` (upload→check→classify→OCR→extract→
quality→identity match→requirement match→consistency→status), reusing
`ExtractDataFromUploadedFile` + `InvokeLLM`. Extraction stored separately with
confidence + extractor_version.
**Adapter:** `validate_documents` task adapter.
**Passport:** MRZ parsing → `Passport` (verification_status, confidence); manual never overwritten.
**Tests:** synthetic passport extraction, quality failure → NEEDS_REVIEW, mismatch → finding.

---

## Phase 6 — Dynamic question engine

**Entities:** `ApplicationQuestion`.
**Shared:** `base44/shared/visa/questions.ts` — question graph with visibility/validation rules,
conditional show/hide, data_source binding to traveler/profile/documents.
**Adapter:** `collect_dynamic_answers`.
**UI:** `src/pages/visa/ApplicationQuestions.jsx` — adaptive, no 50-field static form.
**Tests:** conditional branches (self-employed → business fields), validation, reuse from profile.

---

## Phase 7 — Form engine

**Entities:** `FormDefinition`, `FormVersion`, `FormField`, `FieldMapping`, `FieldValidation`.
**Shared:** `base44/shared/visa/forms.ts` — map gov fields ← traveler/application source,
transform (uppercase, etc.), validate; produces a filled form object.
**Adapter:** `prepare_form`.
**UI:** review generated answers before approval gate.
**Tests:** field mapping correctness, transform/validation, missing-field detection.

---

## Phase 8 — Risk + consistency engine

**Entities:** `RiskAssessment` (+ findings on `DocumentFinding`).
**Shared:** `base44/shared/visa/risk.ts`, `base44/shared/visa/docs/consistency.ts`.
**Adapters:** `run_consistency_check`, `run_application_assessment`.
**Rules:** explainable scores per dimension; outputs application_health, findings[],
recommendations[]; **not** an approval probability. Consistency discrepancies auto-create
a review task (never auto-reject).
**UI:** risk summary in application Overview + ops review panel.
**Tests:** consistency findings severity, risk explains findings, no auto-reject.

---

## Phase 9 — Consumer web

**Pages:** `/`, `/destinations`, `/visa/:country`, `/visa/:country/:nationality`, `/pricing`,
`/how-it-works`, `/help`, `/dashboard`, `/applications`, `/applications/:id` (with tabs
Overview/Documents/Application/Tasks/Appointment/Messages/Payments/Timeline), `/documents`, `/profile`.
**Dashboard:** active applications first; primary CTA = current blocking task (spec §37).
**App workspace header:** destination, visa type, application #, status (spec §38).
**Timeline:** expandable events (spec §40).
**Reuses:** `AppShell`, `CommandBar`, existing shadcn components, Active* contexts adapted.

---

## Phase 10 — Operations console

**Pages:** `/ops`, `/ops/applications`, `/ops/reviews`, `/ops/appointments`, `/ops/documents`,
`/ops/queues`, `/ops/providers`, `/ops/incidents` (spec §41).
**Operator workspace (spec §42):** traveler, application, requirements, documents, findings,
recommendations, timeline, provider state, comms, tasks, audit; privileged actions
(approve/reject/request/override/assign/escalate/message/create-task/change-provider/retry)
all audited.
**Admin config (spec §43):** countries, visa types, requirements, rules, forms, providers,
bindings, fees, refund rules, notification templates, plan templates, AI agents, agent
permissions — all data-driven, no deploy.

---

## Phase 11 — Providers + first adapters

**Capability keys** (§25) on `Provider` + bindings via `BusinessProviderBinding`.
**Adapters:** implement `VisaProvider` interface (§26) as HTTP/REST adapters reusing
`providers/adapters/http_rest.ts`; first: `mock_visa` (tests) + one real eVisa-style provider
(behind feature flag `provider_x`). **Fallback** PRIMARY→SECONDARY→HUMAN via existing resolver.
**Rule:** selection never hard-coded in visa logic.

---

## Phase 12 — Appointments + status tracking

**Entities:** `Appointment`, `AppointmentRequirement`.
**Shared:** `base44/shared/visa/appointments.ts` (discover/reserve/confirm/reschedule/cancel/monitor).
**Where automation unavailable → `HUMAN_TASK`** (existing `dispatchStandaloneTask`).
**Status engine:** normalize external states to the internal set (spec §29); polling adapter
`monitor_status` as a scheduled task / workflow (`base44/workflows/Visa Status Poll.jsonc`).

---

## Phase 13 — Payments + refunds

**Provider:** Stripe (IN region; Wix Payments unavailable). Use `suggest_payments_installation`
once for wiring. **Entities:** `Payment`, `PaymentAttempt`, `Invoice`, `RefundRule`.
Separate government/service/insurance/courier/appointment/optional/taxes. Idempotent via
existing `Idempotency`. No raw card data (Stripe-hosted). **Refund engine** configurable by
policy version.

---

## Phase 14 — Communication + AI concierge

**Comms:** reuse `CommunicationChannelConfig`/`CommunicationLog`/`Notification`/comms hub;
add visa event notifications; require a WhatsApp provider binding (`comms.whatsapp` capability)
— connect via `get_connectors_info`/`request_oauth_authorization` only if the user opts in.
**Ask Visa AI:** conversational resolver over `VisaRouteResolver` + catalog + `InvokeLLM`;
targeted clarifications; offers application creation; never invents routes.
**Agents (initialize `AIAgent` rows):** Eligibility, Document, Form, Risk, Appointment,
Tracking, Support, Ops — each with scoped `config.tools`.

---

## Phase 15 — Enterprise + group travel

**Entities:** `Trip`. Enterprise workflow = a plan template with manager-approval gates.
Group travel: shared itinerary/accommodation/invitation collected once; per-traveler
application reuses vault documents. Pages: `/organization`, `/trips`, `/travelers`,
`/approvals`, `/billing`.

---

## Phase 16 — MCP server + public API

**MCP:** `base44/shared/visa/mcp/tools.ts` exposing the spec §34 tool list; tools invoke the
**same** internal services as web/API (no duplicate logic); MCP deployment per platform
guide (`get_capability_guide("app_mcp")`).
**Public API:** finalize `/v1` visa routes in `orchestralApi` with idempotency + auth + MCP auth.

---

## Phase 17 — Rejection recovery

Plan template `visa-refusal-recovery-v1`: upload/read refusal → extract reason → analyze
prior app → identify deficiencies → recovery plan → human review → reapplication.
`RejectionRecoveryAgent` (AIAgent row). Gate before reapplication submission.

---

## Phase 18 — Production hardening

- Retention policies (documents/OCR/audit/messages), deletion workflows, consent records.
- Rate limiting at API + MCP; PII redaction layer for `InvokeLLM` inputs.
- Business metrics on existing observability (completion, rejection, abandonment, SLA).
- Full E2E suite (`visaTests`: happy, expired passport, name/DOB mismatch, missing/
  conditional doc, self-employed, student, minor, sponsored, family, group, prior refusal,
  provider outage, appointment unavailable, payment failure, duplicate submission, retry,
  human override, cancel, refund — spec §54).
- Feature flags flip live by tenant; provenance badges verified/estimated/unavailable/unknown.

---

## Cross-phase rules

1. **Every phase leaves the app runnable** — new surface behind `FeatureFlag` until verified;
   legacy launch + ORCHESTRAL core untouched.
2. **Every side effect idempotent** — reuse `Idempotency`; provider request ids recorded.
3. **No fake production data** — seeds dev-labeled; UI provenance badges mandatory.
4. **No autonomous government submission** — default `approval_required = true` on
   `submit_application` unless a binding explicitly permits autonomy.
5. **No new orchestrator** — adapters + templates only.
6. **Per-phase report** format (spec §68): PHASE / COMPLETED / FILES CHANGED / DATABASE CHANGES /
   APIs ADDED / UI ADDED / ORCHESTRATOR INTEGRATION / TESTS / VERIFICATION / KNOWN LIMITATIONS /
   NEXT PHASE.

---

## Starting Phase 1

Begin with entities + `resolveVisaRoute` + `visaTests`, behind flag `visa_engine`, reusing the
verified engine path from the O1 work this session.