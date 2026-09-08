# Operations note — non-visa backend functions in this repository

> ⚠️ **Needs a deliberate decision from the account owner — not an automatic cleanup.**

This Base44 app (`krosz-app`) is the **Krosz visa** product, but `base44/functions/`
contains a large number of backend-function directories that do **not** belong to
the visa domain. They appear to originate from a different product ("AI Business
Launch OS" — domain / website / SEO / CRM / communications / multi-tenant
business orchestration) that shares this repository.

They are listed here so the owner can decide, explicitly, whether to keep,
archive, or split them into a separate app — NOT so they can be silently deleted.

## Directories that appear unrelated to the Krosz visa product

`actionEngine`, `adiologyAssistant`, `adiologyCompatApi`, `adiologySaasApi`,
`adiologyWorkspace`, `agentRuntime`, `agentTeams`, `aiBusinessManager`,
`aiExecutives`, `aiOrchestrator`, `aiRuntime`, `archTests`, `blueprintEngine`,
`chatbotPlatform`, `commsHub`, `crmFactory`, `domainEngine`,
`executionProviderApi`, `industryIntelligence`, `knowledgeGraph`,
`launchAssistant`, `mcpApi`, `orchestralApi`, `orchestrator`,
`productionCertification`, `providerManagement`, `seoFactory`, `websiteFactory`,
`workflowStudio`.

(≈ 29 directories.)

## Directories that DO belong to the Krosz visa product (do NOT touch)

`visaApi`, `applicationCaseApi`, `operationsEngine`, `refundAdmin`,
`trustContent`, `helpContent`, `mailService`, `integrations`, `observability`,
`regressionRunner`, `slackApplicationAlert`, `slackChannelResolver`,
`telegramNotifier`, `githubPullRequests`, `stripeWebhook`, `mvpCatalogSeed`,
`enforceAdminAccess`, `qaOrchestrator`.

## Why this matters / risks

- These functions and their `base44/shared/…` dependencies (`blueprint`, `crm`,
  `seo`, `website`, `comms`, `domain`, `industries`, `orchestration`,
  `knowledge-graph`, `providers`, `registry`, etc.) inflate the deployed bundle
  and the typecheck/lint surface, and some reference entities
  (`Business`, `BusinessBlueprint`, `Website`, `SEOProject`, `CRMProject`,
  `EmailMessage`, `Lead`, `Domain`, `AIAgent`, `Adiology*`, …) that the visa
  product never uses.
- The repo previously shipped a stale `docs/ARCHITECTURE.md` describing that
  other product; it has been removed to stop misleading readers, but the
  underlying code is still here.
- No automatic action is taken here. **Owner action required:** confirm whether
  the "AI Business Launch OS" code should be split into its own Base44 app or
  archived, then remove the unused function directories + shared modules + the
  non-visa entities in a planned, reviewed change.

_Generated as part of the MVP launch-readiness pass (item 13). No files were
deleted by this note — it exists only to flag the situation._