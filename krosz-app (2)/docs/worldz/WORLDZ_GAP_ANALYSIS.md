# WORLDZ VISA — Gap Analysis (Phase 0)

What is missing to reach "Definition of Done" (spec §65), measured against the
existing architecture inventory in `WORLDZ_EXISTING_ARCHITECTURE.md`.

Gaps are grouped by spec section. Each gap states: **what's missing**, **why it matters**,
and **where it lands** (entity / adapter / shared module / page / API route / agent / provider).

---

## A. Visa Knowledge Graph (spec §7–11)

### A.1 Country & Visa catalog  (CREATE entities)
- `Country` (ISO code, region, flags, Schengen bloc membership, metadata).
- `VisaType` (per destination × purpose: tourist/business/student/transit…).
- `VisaRoute` (resolved nationality→residence→destination→purpose → visa_type + channel).
- **Why:** eligibility cannot be deterministic without a catalog. LLMs must not invent routes.
- **Lands in:** `base44/entities/*` + `base44/shared/visa/catalog.ts`.

### A.2 Versioned requirement/fee/processing/form/provenance (CREATE)
- `VisaRequirement`, `RequirementRule`, `DocumentRequirement`, `FormDefinition`,
  `FormVersion`, `FormField`, `FeeDefinition`, `ProcessingTime`,
  `AppointmentRequirement`, `SubmissionMethod`, `VisaSource`, `SourceSnapshot`.
- Each carries version + effective_from/until + source + verified_at + confidence + status.
- **Why:** visa info changes; destructive updates would silently corrupt active applications
  (spec §8, §9, §62 "no fake production data").

### A.3 VisaRouteResolver (deterministic) (CREATE module)
- Input {nationality, residence, destination, purpose, travel_dates} → output {eligible,
  visa_type, channel, appointment_required, requirements_version}.
- Pure function over the catalog + rules; never calls an LLM.
- **Why:** spec §10 demands determinism; only AI *explains*, never *decides*, routes.

---

## B. Traveler & documents (spec §4–6, §12–15)

### B.1 Traveler + Passport (CREATE entities)
- `Traveler` (UUID, scope: consumer = user; enterprise = org/trip).
- `Passport` (MRZ, parsed fields, verification_status, confidence; manual entry vs extraction).
- Manual vs extracted precedence: never silently overwrite verified fields.
- **Lands in:** entities + `base44/shared/visa/traveler.ts`, `passport.ts`.

### B.2 Document Vault (CREATE)
- `TravelerDocument` (type catalog, storage_key via `UploadPrivateFile`, sha256, version,
  status, issued_at/expires_at).
- Never expose permanent URLs — only `CreateFileSignedUrl` short-lived tokens (existing).
- **Lands in:** entities + `base44/shared/visa/vault.ts`.

### B.3 Document Intelligence Pipeline (CREATE)
- Stages: upload → type/malware check → OCR/extract → quality → identity match →
  requirement match → consistency → status.
- Uses existing `ExtractDataFromUploadedFile` + `InvokeLLM` integrations; extraction stored
  separately in `DocumentExtraction` (value + confidence + source_region + extractor_version).
- Document statuses: UPLOADED/PROCESSING/VERIFIED/NEEDS_REVIEW/REJECTED/EXPIRED/SUPERSEDED.
- **Lands in:** `base44/shared/visa/docs/pipeline.ts` mapped to orchestrator task adapters.

### B.4 Cross-document Consistency Engine (CREATE)
- Compare passport/bank/employment/ITR/salary/hotel/flight/insurance/invitation/answers.
- Findings severity INFO/LOW/MEDIUM/HIGH/CRITICAL; never auto-reject; creates a review task
  (`Approval gate` already in the engine).
- **Lands in:** `base44/shared/visa/docs/consistency.ts`.

---

## C. Application engine (spec §16–20)

### C.1 VisaApplication entity + state machine (CREATE)
- `VisaApplication` (traveler_id, destination, visa_type, purpose, status, current_step,
  requirements_version, form_version, provider, risk_score).
- State machine spec §17 (DRAFT → … → DECISION; terminals APPROVED/REFUSED/CANCELLED/
  WITHDRAWN/COMPLETED); every transition = immutable event.

### C.2 Application ↔ Run binding (EXTEND)
- A `VisaApplication` starts a `LaunchPlan` Run via `launchRun` with a visa plan template.
- Stored as `VisaApplication.run_id`; provenance stamped on the Run.
- Status sync: the visa state machine and the Run state stay consistent; the Run owns
  task lifecycle, the visa entity owns domain status.

### C.3 Dynamic question engine (CREATE)
- `ApplicationQuestion` (id, label, type, required, visibility_rule, validation_rule,
  data_source) → conditional show/hide from prior answers (employment_status→business_*).
- **Lands in:** `base44/shared/visa/questions.ts` + a task adapter `collect_dynamic_answers`.

### C.4 Form engine (CREATE)
- `FormDefinition/Version/Field` + `FieldMapping` (gov field → traveler/application source
  → transform → validation), e.g. surname ← traveler.last_name, uppercase, required.
- **Lands in:** `base44/shared/visa/forms.ts` + adapter `prepare_form`.

---

## D. Orchestrator integration (spec §23–25)

### D.1 Visa plan templates (EXTEND)
- Versioned `PlanTemplate` rows: `visa-tourist-standard-v1`, business, student, refusal-recovery.
- Task keys: resolve_eligibility, collect_passport, collect_photo, collect_required_documents,
  validate_documents, run_consistency_check, run_application_assessment, prepare_form,
  user_review (approval_gate), book_appointment, submit_application, monitor_status, process_decision.
- **Lands in:** `ensureVisaTemplates(svc)` mirroring `ensureSeedTemplates`.

### D.2 Visa task adapters (EXTEND)
- Register adapters in the existing `REGISTRY` (adapters.ts pattern), under `base44/shared/visa/adapters/`:
  `eligibility.ts`, `documents.ts`, `consistency.ts`, `risk.ts`, `form.ts`, `appointment.ts`,
  `submission.ts`, `status.ts`, `decision.ts`.
- Each returns `ExecuteResult` (output + aiExecution meta) and reuses `recordProviderFailure`.

### D.3 Provider capabilities + adapters (EXTEND)
- New capability keys (§25) bound via `BusinessProviderBinding`.
- `VisaProvider` adapter interface (§26) implemented as HTTP/REST adapters reusing
  `providers/adapters/http_rest.ts`; first adapters: mock visa provider (tests) + 1 real eVisa style.
- Fallback chain PRIMARY→SECONDARY→HUMAN via existing resolver + circuit breaker (§27).

---

## E. Appointments, status, comms (spec §28–30)

### E.1 Appointment engine (CREATE)
- `Appointment` entity + `AppointmentRequirement/Provider/Slot/Booking`.
- Capabilities discover/reserve/confirm/reschedule/cancel/monitor; where automation
  unavailable → `HUMAN_TASK` (existing `dispatchStandaloneTask`).
- **Lands in:** `base44/shared/visa/appointments.ts` + adapter.

### E.2 Status engine (CREATE)
- Normalize external provider states → internal set
  (DRAFT/SUBMITTED/PROCESSING/ACTION_REQUIRED/DECISION_READY/APPROVED/REFUSED).
- Provider polling adapter `monitor_status`.

### E.3 Communication (EXTEND — reuse)
- Existing `CommunicationChannelConfig`, `CommunicationLog`, `Notification`, comms hub.
- Add visa event notifications (document requested/rejected, appointment booked,
  status changed, decision received) via existing channels (WhatsApp/email/in-app)
  — requires a WhatsApp/email provider binding (new capability `comms.whatsapp`).

---

## F. Risk engine (spec §22)

### F.1 RiskAssessment (CREATE)
- Dimensions: document completeness/quality, identity/financial/travel/employment/timeline
  consistency, previous visa history, completeness.
- Output application_health + findings[] + recommendations[].
- NOT a visa-approval probability; explicit language only.
- Explainable, served to traveler + operator.
- **Lands in:** `base44/shared/visa/risk.ts` + adapter `run_application_assessment`.

---

## G. Agents, MCP, public API (spec §31–34)

### G.1 Specialized visa agents (CREATE rows, EXTEND infra)
- Eligibility, Document, Form, Risk, Appointment, Tracking, Support, Rejection-Recovery, Ops.
- Implemented as `AIAgent` rows with scoped `config.tools` (capability allow-list) +
  `config.approval_required` where submission is involved. Reuse agent runtime + AgentTeam.

### G.2 Visa MCP server (CREATE)
- Tools (spec §34) invoke the same internal services as web/API (no separate logic).
- Reuse the existing app MCP capability guide; expose visa tools via an MCP surface.
- **Lands in:** `base44/shared/visa/mcp/tools.ts` + MCP page/deployment per platform guide.

### G.3 Public API (EXTEND)
- Add `/v1` visa routes to the existing `orchestralApi` router (destinations, eligibility/check,
  applications CRUD, documents, assessment, review, appointments, status, timeline).
- Idempotency keys on mutations (reuse existing `Idempotency` module).

---

## H. Consumer + enterprise + ops UX (spec §36–42)

### H.1 Consumer web (CREATE pages, EXTEND shell)
- Public: `/`, `/destinations`, `/visa/:country`, `/visa/:country/:nationality`, `/pricing`,
  `/how-it-works`, `/help`.
- Authenticated: `/dashboard`, `/applications`, `/applications/:id` (Overview/Documents/
  Application/Tasks/Appointment/Messages/Payments/Timeline), `/documents`, `/profile`.
- Dashboard prioritizes active applications; primary CTA = current blocking task.

### H.2 Enterprise (CREATE pages)
- `/organization`, `/trips`, `/travelers`, `/approvals`, `/billing` (+ `Trip` entity + manager-approval
  workflow as a plan template with approval gates).

### H.3 Operations console (CREATE pages)
- `/ops`, `/ops/applications`, `/ops/reviews`, `/ops/appointments`, `/ops/documents`,
  `/ops/queues`, `/ops/providers`, `/ops/incidents`.
- Operator workspace: traveler/application/requirements/documents/findings/recommendations/
  timeline/provider/comms/tasks/audit; privileged actions audited.

### H.4 Admin configuration (CREATE pages)
- Countries, visa types, requirements, rules, forms, providers, bindings, fees, refund rules,
  notification templates, plan templates, AI agents, agent permissions (no deploy needed).

---

## I. Payments, refunds, rejection recovery, groups (spec §44–48)

### I.1 Payments (CREATE, in IN region use Stripe)
- Wix Payments unavailable in IN → Stripe (already installed `@stripe/...`).
- Entities: Payment, PaymentAttempt, Invoice, RefundRule; idempotent handling; no raw card data.
- Use existing `suggest_payments_installation` flow when wiring checkout.

### I.2 Refund engine (CREATE)
- Configurable policy version → eligible/amount/reason.

### I.3 Rejection recovery (CREATE, as a plan template)
- `visa-refusal-recovery-v1` tasks + `RejectionRecoveryAgent`; produces a reapplication plan,
  human review gate.

### I.4 Enterprise / group travel (CREATE)
- `Trip` entity; shared itinerary/accommodation/invitation collected once; per-traveler
  application reuses documents via the vault.

---

## J. Cross-cutting (spec §49–62)

### J.1 SEO from the knowledge graph (EXTEND)
- Generate `/visa/:country`, `/visa/:country-from-india`, `/visa/:country-tourist-visa`
  from catalog + current verified requirements/fees (reuse existing `SEOProject`/`SEOVersion`
  surface or build a lightweight visa-SEO generator).
- Never hard-code fees/timelines into marketing copy.

### J.2 Ask Visa AI (CREATE)
- Conversational route resolver over `VisaRouteResolver` + catalog + `InvokeLLM`;
  asks targeted clarifications; offers application creation; never invents routes.

### J.3 Observability + security (REUSE)
- Langfuse traces already scrub PII (existing). Add visa metrics
  (completion rate, rejection rate, avg completion time, human-intervention rate, provider
  failure, appointment success, submission success, abandonment, support contacts/app).
- RLS on all new entities (tenant_id + role), signed URLs only, audit on privileged ops,
  rate limiting at API, MCP auth.

### J.4 Testing (CREATE)
- Unit: eligibility, requirements, rules, field mapping, risk rules, state transitions, refund.
- Integration: application creation, document upload, orchestrator execution, provider mock, payment, notifications, MCP, API.
- E2E: traveler → France application → upload → requirements → documents → review →
  approval → appointment → submission → tracking → decision.
- Reuse the `archTests` pattern (backend function assertions) for the visa suite.

### J.5 Feature flags (EXTEND)
- New flags on `FeatureFlag`: `visa_engine`, `document_ai`, `risk_engine`,
  `appointment_automation`, `mcp`, `enterprise`, `rejection_recovery`, `provider_x`.

### J.6 Seed data (CREATE, labeled dev/unverified)
- India → {UAE, Thailand, Vietnam, Singapore, France, Germany, Italy, UK, USA, Japan},
  purposes {tourist, business, student}, flagged `source_type: secondary_reference` /
  `dev_seed` until verified, with `confidence < 1` and UI "verified/estimated/unavailable/unknown" badges.

---

## K. Gaps NOT requiring new infrastructure (confirm reuse)

- Run/Task/DAG engine → reuse (`engine.ts`, `dag.ts`).
- Provider registry/resolver/circuit breaker → reuse.
- Agent runtime + team governance → reuse.
- Audit, events, memory, Langfuse → reuse.
- Auth, RLS, storage, secrets → reuse.
- `/v1` router → reuse `orchestralApi`.

---

## L. Risk register for Phase 1+

1. **Fizzbuzz of fake data** — hardest cultural risk: never fabricate gov fees/processing/decisions.
   Seed data is dev-labeled; production UI marks provenance.
2. **Domain leakage** — visa logic must not reach into `launch_business`/website/crm factories.
   New adapters + templates only.
3. **Autonomous submission** — `submit_application` MUST default to `approval_required = true`
   unless a provider binding explicitly authorizes autonomy.
4. **PII in traces** — rely on existing Langfuse scrubbing; add a visa PII redaction layer for
   document extraction fields before any `InvokeLLM` call.
5. **Idempotency** — every side-effect adapter (payment, appointment, submission, comms, refund)
   must assert the existing idempotency key or provider request id.