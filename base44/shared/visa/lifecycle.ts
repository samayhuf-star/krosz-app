// Worldz Visa — Phase 3: bind a VisaApplication to a durable orchestrator Run.
// Reuses the existing engine (launchRun / runStatus / approveTask) — no duplicate
// orchestration. Visa runs anchor to a single shared "Worldz Visa" tenant Business
// since the engine is Business-scoped; provenance.visa_application_id ties it back.

import { launchRun, defineTemplate, runStatus, approveTask, advanceRun } from "../operations/engine.ts";

const VISA_TEMPLATE_ID = "visa_application";

const VISA_PLAN = [
  { key: "collect_documents", type: "visa_collect_documents", depends_on: [] },
  { key: "collect_application_information", type: "visa_collect_application_information", depends_on: ["collect_documents"] },
  { key: "validate_application_information", type: "visa_validate_application_information", depends_on: ["collect_application_information"] },
  { key: "generate_government_form", type: "visa_generate_government_form", depends_on: ["validate_application_information"] },
  { key: "validate_government_form", type: "visa_validate_government_form", depends_on: ["generate_government_form"] },
  { key: "build_submission_package", type: "visa_build_submission_package", depends_on: ["validate_government_form"] },
  { key: "review_application", type: "visa_review_application", depends_on: ["build_submission_package"] },
  { key: "application_approval", type: "approval_gate", depends_on: ["review_application"] },
  // Phase 8 (§23): provider resolution + submission creation happen AFTER user
  // approval. The orchestrator owns the lifecycle + approval gate; the actual
  // provider interaction is driven by the visaApi submission service.
  { key: "resolve_submission_provider", type: "visa_resolve_submission_provider", depends_on: ["application_approval"] },
  { key: "create_submission", type: "visa_create_submission", depends_on: ["resolve_submission_provider"] },
  { key: "submit_application", type: "visa_submit_application", depends_on: ["create_submission"] },
  // Phase 9 (§36/§37): appointment + passport-custody steps between submission
  // and the decision wait. These auto-complete via the orchestrator __stub__
  // adapter (the appointment engine owns external provider interaction, exactly
  // like the submission service in Phase 8). The tasks are always present in the
  // DAG; appointment-required-vs-not is enforced by the appointment engine +
  // readiness check, not by selectively spawning tasks.
  { key: "resolve_appointment", type: "visa_resolve_appointment", depends_on: ["submit_application"] },
  { key: "book_appointment", type: "visa_book_appointment", depends_on: ["resolve_appointment"] },
  { key: "attend_appointment", type: "visa_attend_appointment", depends_on: ["book_appointment"] },
  { key: "passport_submission", type: "visa_passport_submission", depends_on: ["attend_appointment"] },
  { key: "passport_return", type: "visa_passport_return", depends_on: ["passport_submission"] },
  { key: "wait_for_decision", type: "visa_wait_for_decision", depends_on: ["passport_return"] },
  { key: "track_status", type: "visa_track_status", depends_on: ["wait_for_decision"] },
];

export async function ensureVisaBusiness(svc: any): Promise<any> {
  const existing = await svc.entities.Business.filter({ tenant_id: "worldz", name: "Worldz Visa" }).catch(() => []);
  if (existing && existing.length) return existing[0];
  return await svc.entities.Business.create({ tenant_id: "worldz", name: "Worldz Visa", country: "IN", industry: "visa services", status: "draft", launch_stage: "business_info" });
}

export async function ensureVisaPlanTemplate(svc: any): Promise<void> {
  const rows = await svc.entities.PlanTemplate.filter({ template_id: VISA_TEMPLATE_ID, active: true }).catch(() => []);
  const existing = rows && rows[0];
  if (existing) {
    // Upgrade the template when the Phase 7 form stages are missing.
    const needed = ["generate_government_form", "validate_government_form", "build_submission_package", "resolve_submission_provider", "create_submission", "submit_application", "resolve_appointment", "book_appointment", "attend_appointment", "passport_submission", "passport_return", "wait_for_decision"];
    const tasks: any[] = (existing as any).tasks || (existing as any).definition?.tasks || [];
    if (!tasks.length && (existing as any).definition?.tasks) Object.assign(existing, { tasks: (existing as any).definition.tasks });
    const has = needed.every((k) => (existing.tasks || []).some((t: any) => t.key === k || t.task_key === k));
    if (has) return;
  }
  await defineTemplate(svc, { templateId: VISA_TEMPLATE_ID, name: "Visa Application", description: "Visa lifecycle: collect → form → package → approve → submit → track.", lifecycleGoal: "operating", tasks: VISA_PLAN, overwrite: true });
}

export async function launchVisaRun(svc: any, user: any, app: any): Promise<string> {
  await ensureVisaPlanTemplate(svc);
  const business = await ensureVisaBusiness(svc);
  const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
  const launched = await launchRun(svc, {
    businessId: business.id,
    templateId: VISA_TEMPLATE_ID,
    goal: `Visa ${app.destination} ${app.purpose} (${app.visa_type_key})`,
    requestedBy: actor,
    input: { visa_application_id: app.id, traveler_id: app.traveler_id, destination: app.destination, purpose: app.purpose, requirements_version: app.requirements_version, channel: app.channel },
  });
  await svc.entities.LaunchPlan.update(launched.run.id, { provenance: { domain: "visa", application_id: app.id, visa_application_id: app.id, api: "v1" } }).catch(() => {});
  return launched.run.id;
}

export async function getVisaRunProgress(svc: any, app: any): Promise<any> {
  if (!app || !app.run_id) return null;
  return await runStatus(svc, { runId: app.run_id });
}

// Derive domain status/current_step from the bound run so the VisaApplication state
// stays a faithful projection of the orchestrator (single source of truth).
export function deriveAppUpdate(status: any): any {
  const run = status?.run;
  const tasks: any[] = status?.tasks || [];
  const awaiting = tasks.find((t) => t.status === "awaiting_approval");
  const failed = tasks.find((t) => t.status === "failed" || t.status === "blocked");
  const allDone = tasks.length > 0 && tasks.every((t) => ["completed", "skipped"].includes(t.status));
  if (run?.status === "completed" || allDone) return { status: "government_processing", current_step: "decision" };
  if (awaiting) return { status: "user_approval", current_step: "submission" };
  if (failed) return { status: "additional_documents", current_step: "review" };
  if (run?.status === "running") {
    // first incomplete task decides the step
    const stepMap: Record<string, string> = { collect_documents: "documents", generate_government_form: "form", validate_government_form: "form", build_submission_package: "submission", review_application: "review", resolve_submission_provider: "submission", create_submission: "submission", submit_application: "submission", resolve_appointment: "appointment", book_appointment: "appointment", attend_appointment: "appointment", passport_submission: "appointment", passport_return: "decision", wait_for_decision: "decision", track_status: "decision" };
    const next = tasks.find((t) => !["completed", "skipped"].includes(t.status));
    if (next) return { status: "document_review", current_step: stepMap[next.task_key] || "documents" };
  }
  return null;
}

export async function approveVisaApplication(svc: any, user: any, app: any): Promise<any> {
  if (!app?.run_id) throw Object.assign(new Error("Application has no bound run"), { code: "NO_RUN" });
  const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
  const res = await approveTask(svc, { runId: app.run_id, actor });
  const status = await runStatus(svc, { runId: app.run_id });
  const update = deriveAppUpdate(status);
  if (update) await svc.entities.VisaApplication.update(app.id, update).catch(() => {});
  return { run: res.run, status, update };
}

export async function advanceVisaApplication(svc: any, user: any, app: any): Promise<any> {
  if (!app?.run_id) throw Object.assign(new Error("Application has no bound run"), { code: "NO_RUN" });
  const actor = (user && (user.full_name || user.email)) || (user && user.id) || "system";
  await advanceRun(svc, { runId: app.run_id, actor });
  const status = await runStatus(svc, { runId: app.run_id });
  const update = deriveAppUpdate(status);
  if (update) await svc.entities.VisaApplication.update(app.id, update).catch(() => {});
  return { status, update };
}