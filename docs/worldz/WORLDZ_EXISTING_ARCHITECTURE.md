# WORLDZ VISA — Existing Architecture Inventory (Phase 0)

> Built on top of the **Business Operations Orchestrator** (now branded ORCHESTRAL).
> This document inventories what already exists in this repository so Phase 1+ never
> rebuilds working infrastructure. Every item below maps to a real file on disk.

---

## 0. How to read this document

Each subsystem is tagged:

- **EXISTS** — already implemented and in use; reuse directly.
- **EXTEND** — exists but needs visa-domain additions grafted on (no rewrite).
- **CREATE** — does not exist; build new in the visa domain.
- **DEPRECATE** — exists but should be retired for the visa surface (do not delete).
- **DO NOT TOUCH** — load-bearing platform plumbing; never modify for a domain.

---

## 1. Stack & layout

Base44 BaaS: React + Vite + Tailwind + shadcn frontend, serverless backend functions,
built-in Postgres-backed entities with Row-Level Security, auth, storage, integrations.

```
src/                         # React app (pages, components, lib, hooks)
base44/
  entities/                  # JSON-schema data models (RLS per entity)
  functions/                 # serverless HTTP handlers (entry.ts per function)
  shared/                    # cross-function TypeScript (the actual product logic)
  workflows/                 # scheduled/triggered workflow definitions (.jsonc)
  agents/                    # in-app AI agent configs
```

`base44/shared/` is where the **real engine** lives — backend functions are thin HTTP
shells that call into shared modules. Worldz Visa logic goes into `base44/shared/visa/`
and thin HTTP shells reuse it. **No new orchestrator.** `(DO NOT TOUCH shared/operations, shared/providers, shared/orchestration core)`
unless grafted extensions require it.

---

## 2. Orchestration engine  (EXISTS — DO NOT REPLICA)

Canonical files:

| File | Role |
|---|---|
| `base44/shared/operations/engine.ts` | Run/Task lifecycle: `launchRun`, `advanceRun`, `runStatus`, `approveTask`, `rejectTask`, `skipTask`, `retryTask`, `cancelRun`, `defineTemplate`, `ensureSeedTemplates`, `dispatchStandaloneTask`, `runDependencyTest`, `runParallelTest`, `runDomainTest`, `runFullRegression` |
| `base44/shared/operations/dag.ts` | Plan/DAG validation + eligibility + next-action scheduler (fixpoint) |
| `base44/shared/operations/adapters.ts` | Adapter registry (`REGISTRY`), stub adapter w/ checkpointing, factory adapters (domain/website/crm/seo/agent/agent_team), test-seam adapters |
| `base44/shared/operations/context.ts` | Immutable context snapshot (business + run context) |
| `base44/shared/operations/resolver.ts` | Capability-based provider resolution + circuit-breaker health tracking |
| `base44/shared/operations/idempotency.ts` | Input-hash idempotency for Run creation |
| `base44/shared/operations/audit.ts` | Audit-trail emission into `audit_trail` on the Run |
| `base44/shared/operations/ai_provider.ts` | Truthful provider runtime bridge to executeAIChat |

Invariants Worldz reuses **as-is**:
- Runs are durable `LaunchPlan` rows; tasks are `LaunchTask` rows.
- DAG dependency ordering, transitive blocking, idempotent resume, parallel execution.
- Approval gates (`approval_gate` task type) block downstream execution until decided.
- Retry policy, failure state, circuit-breaker degradation of providers.
- Context snapshots persisted on every Run.
- Audit trail (immutable events) appended on every transition.

**Verdict: EXISTS / DO NOT TOUCH core. EXTEND only via new task adapters + new plan templates.**

---

## 3. Entity model  (EXISTS — extend, do not duplicate)

Existing platform-core entities (verified schemas this session):

- `Organization`, `Project`, `Application` — ORCHESTRAL ownership hierarchy (`Organization → Project → Application → Runs → Tasks`). `Application.business_id` optional link.
- `Business` — legacy launch domain record (`tenant_id`, lifecycle, config, approved_assets).
- `LaunchPlan` (the **Run**), `LaunchTask` (the **Task**), `PlanTemplate` (versioned DAG), `TaskTemplate`.
- `Provider`, `ProviderCredential`, `ProviderOverride`, `BusinessProviderBinding` — provider registry + capability bindings.
- `AIAgent`, `AgentTeam` — agent definitions + governed agent teams.
- `AIExecution`, `CostLog`, `UsageLog` — telemetry/cost.
- `AuditLog`, `Notification`, `CommunicationLog`, `CommunicationChannelConfig`.
- `BusinessMemory`, `BusinessKnowledgeGraph`, `BusinessBlueprint`, `BusinessObservation`.
- `FeatureFlag`, `Setting`, `Subscription`, `WhiteLabelAccount`, `Tenant`.
- Domain buckets: `Website`, `Page`, `WebsitePage`, `WebsiteArchitecture`, `ComponentInstance`, `PublishHistory`, `MediaPlan`; `SEOProject`, `SEOVersion`, `SEOData`, `Keyword`, `KeywordCluster`, `InternalLink`, `SEOValidation`, `SEORecommendation`, `TechnicalSEOReport`, `ImageSEO`, `SchemaDefinition`, `ContentOpportunity`; `CRMProject`, `CRMVersion`, `Pipeline`, `PipelineStage`, `Lead`, `Contact`, `CRMActivity`, `CRMReport`, `Form`, `LeadScoreRule`; `Domain`, `EmailAccount`, `EmailMessage`, `EmailMailbox`, `EmailTemplate`, `EmailAutomationRule`, `EmailProviderConfig`, `EmailDomainConfig`; `IndustryBlueprint`, `IndustryBenchmark`; `Chatbot`, `Conversation`, `ChatMessage`, `Message`, `Ticket`; `Job`, `SyncRun`, `IntegrationConnector`, `CustomerAction`, `ValidationReport`.
- `User` — built-in auth user (read-only for app code).

**Verdict: EXISTS. Worldz adds NEW entities only (see §6). Does not subclass Run/Task.**

---

## 4. Provider runtime  (EXISTS — extend)

`base44/shared/providers/`:
- `registry.ts`, `catalog.ts`, `resolver.ts`, `runtime.ts`, `types.ts`, `results.ts`.
- AI adapters: `gemini.ts`, `anthropic.ts`, `openai_compatible.ts`, `base44core_ai.ts`.
- Domain registrar adapters: `openprovider_domain.ts`, `opensrs_domain.ts`, `mock_domain.ts`.
- HTTP REST generic adapter: `adapters/http_rest.ts`.
- Capabilities are **string keys**; `BusinessProviderBinding` binds a capability to a provider per Business. `resolveProvider(svc, businessId, capability)` returns a healthy provider with fallback + circuit breaker.

Worldz adds: `visa.requirements`, `visa.eligibility`, `visa.application`, `visa.form`,
`visa.document_submission`, `visa.appointment`, `visa.status`, `visa.payment`, `visa.delivery`
capabilities and provider rows + adapters. Selection stays in the resolver, never in visa logic.

**Verdict: EXISTS / EXTEND. No second provider system.**

---

## 5. Agent system  (EXISTS — extend)

`base44/shared/agents/`:
- `runtime.ts` (agent loop), `tools.ts`, `memory.ts`, `context.ts`, `lifecycle.ts`, `hardeningTest.ts`.
- `AIAgent` entity has `config.tools` (capability allow-list), `config.approval_required`, versioning.
- `AgentTeam` entity governs multi-agent DAGs inside a single `run_agent_team` task; team tool permission = intersection with agent's own.
- Agent execution reuses Provider Runtime + AIExecution + BusinessMemory + Langfuse.

Worldz adds specialized visa agents (Eligibility, Document, Form, Risk, Appointment, Tracking, Support, Rejection-Recovery, Ops) as `AIAgent` rows + tool-permission grants — **not** new agent runtime code.

**Verdict: EXISTS / EXTEND.**

---

## 6. NEW visa-domain entities to add  (CREATE)

Existing entities cover runs/tasks/providers/agents/audit/comms. Worldz creates:

| Entity | Purpose |
|---|---|
| `Country` | ISO country, region groupings (e.g. Schengen), metadata. |
| `VisaType` | Catalog of visa categories per destination (tourist, business, student…). |
| `VisaRoute` | Resolved nationality→residence→destination→purpose route → visa_type + channel. |
| `VisaRequirement` | Versioned requirement row (mandatory/conditional/optional/recommended/NA). |
| `RequirementRule` | Structured conditional rule (DAG-style triggers). |
| `DocumentRequirement` | Which document categories a route demands. |
| `FormDefinition` / `FormVersion` / `FormField` | Government form model + field mappings + validation. |
| `FeeDefinition` | Versioned fee schedule. |
| `ProcessingTime` | Versioned processing-time estimate per route. |
| `AppointmentRequirement` | Whether/how appointment is needed. |
| `SubmissionMethod` | Submission channels (VAC/embassy/eVisa/mail). |
| `VisaSource` / `SourceSnapshot` | Provenance: government/embassy/etc., url, retrieved_at, verified_at, confidence. |
| `Traveler` | Per-user traveler record (links to User, optional Organization). |
| `Passport` | Passport model w/ MRZ + verification_status + confidence. |
| `TravelerDocument` | Document vault row (type, storage_key, sha256, version, status, expiry). |
| `DocumentExtraction` | Structured extraction separate from file (fields + confidence + extractor version). |
| `DocumentFinding` | Classification/quality/consistency findings. |
| `VisaApplication` | Application row (state machine, requirements_version, form_version, risk). |
| `ApplicationQuestion` | Dynamic question instances + answers per application. |
| `Appointment` | Booking row (slot, provider, status). |
| `ApplicationEvent` | Domain event log (uses existing event infra underneath). |
| `RiskAssessment` | Application health + findings + recommendations. |
| `Trip` | Enterprise/group travel grouping. |
| `Payment` / `PaymentAttempt` / `Invoice` | Payment entities (Stripe available in IN region). |
| `RefundRule` | Configurable refund policy version. |

All inherit built-ins (`id`, `created_date`, `updated_date`, `created_by_id`) and carry `tenant_id` + RLS (same pattern as existing tables). No new run/task entities.

**Verdict: CREATE.**

---

## 7. Public / API surface  (EXISTS — extend)

`base44/functions/orchestralApi/entry.ts` already implements a REST `/v1` router that
delegates to the engine (templates, runs, tasks, approvals, applications, audit).
This is the **agent-native + API-first** surface. Worldz adds `/v1` visa routes
(destinations, eligibility, applications, documents, appointments, status, timeline)
to the **same** API function/router — no second gateway.

`orchestrator` function exposes domain actions (`launch`, `dispatch-task`, approvals…)
and `agentRuntime` / `agentTeams` expose agents/teams. `aiOrchestrator` exposes the
prompt registry + orchestration pipeline.

**Verdict: EXISTS / EXTEND.**

---

## 8. Frontend shell  (EXISTS — extend)

- `src/App.jsx` — router, `ProtectedRoute`, `AppShell` layout, existing pages.
- `src/components/app/` — `AppShell`, `AppSidebar`, `AppTopbar`, `CommandBar`, `JourneyNav`, `BusinessSwitcher`, `PageHeader`.
- shadcn/ui installed (`src/components/ui/*`), Tailwind tokens in `src/index.css`.
- Existing domain pages (website, seo, crm, domains, comms, agents, workflows, studio, customers, ops) — these are the **legacy launch domain** and remain intact for existing users.

Worldz adds new page trees (`/visa/*`, `/applications/*`, `/documents`, `/profile`,
`/organization/*`, `/ops/*`) and a Worldz landing experience. The existing dashboard
(`Home.jsx → CustomerDashboard`) is **re-scoped** for Worldz; legacy pages stay reachable
but are not the default surface.

**Verdict: EXISTS / EXTEND for shell + nav. CREATE visa pages.**

---

## 9. Observability, audit, events, memory  (EXISTS — DO NOT TOUCH)

- Observability: `base44/shared/observability/` — Langfuse traces/spans/generations, AsyncLocalStorage context propagation, secret scrubbing, batched ingestion. `getObsConfig()` + `ObservabilityService`.
- Audit: `base44/shared/operations/audit.ts` + `AuditLog` entity — immutable transitions.
- Events: `base44/shared/events/bus.ts` — in-process event bus.
- Memory: `BusinessMemory` entity + `base44/shared/ai/coo.ts` helpers.
- Knowledge graph: `base44/shared/knowledge-graph/` + `BusinessKnowledgeGraph`.

Worldz reuses all of these; the visa domain publishes domain events onto the existing
bus and persists immutable transitions via the existing audit path. Langfuse continues
to receive agent/LLM/tool telemetry; PII is scrubbed before ingestion (already enforced).

**Verdict: EXISTS / DO NOT TOUCH.**

---

## 10. Auth, RLS, storage, secrets  (EXISTS — DO NOT TOUCH)

- Auth Provider + `ProtectedRoute` (email/password, OTP, Google) — platform-owned.
- RLS per entity in `base44/entities/*.jsonc` (`tenant_id` + role rules) — Worldz copies the same pattern.
- File storage via `UploadFile` (public) / `UploadPrivateFile` (private) + `CreateFileSignedUrl` for short-lived access — exactly what the Document Vault needs.
- Secrets via `set_secrets`; `OPENAI_API_KEY` already present.
- Payment: Stripe is the available provider in IN region (Wix Payments unavailable) — Worldz uses Stripe for `visa.payment`.

**Verdict: EXISTS / DO NOT TOUCH.**

---

## 11. What Worldz does NOT own (orchestrator surface vs visa surface)

The orchestrator owns (DO NOT rebuild): runs, tasks, dependencies, durability, retries,
approvals, context snapshots, provider selection, circuit breakers, audit, events,
agent execution, observability.

Worldz owns (CREATE/EXTEND): visa rules, requirements, traveler data, documents,
extractions, forms, dynamic questions, appointments, applications, risk, visa-specific
agents, visa-specific providers, visa-specific UX, visa public API + MCP.

---

## 12. Phase 0 conclusion

Everything required to *execute* a visa application as an orchestrated Run already
exists. The work ahead is **content + adapters + UX**, not infrastructure.