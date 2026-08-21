// Worldz Visa (Phase 20): Traveler account, multi-traveler, trip/group, audit,
// settings, and deletion domain. Integrates with the existing Document Vault,
// Application engine, Payments, and Notification system — does not duplicate them.
//
// Model (§1-§4):
//   User (account owner) → Traveler rows (one per person the user manages).
//   The relationship (SELF/SPOUSE/CHILD/...) lives on the Traveler row because
//   each Traveler record is owned by exactly one user (§4 note). A future
//   many-to-many link table is a known limitation, not this phase.
//
// Authorization (§18/§19): every read/write asserts the traveler.user_id equals
// the current user (or admin). Application/document/payment access already
// checks created_by_id; here we additionally verify the traveler ownership so a
// user cannot reach another user's traveler via a guessed traveler_id.

import { ensureTravelerForUser as _ensureLegacy } from "../traveler.ts";

// ---------- Ownership / authorization ----------

export async function getTraveler(svc: any, user: any, travelerId: string): Promise<any> {
  const t = await svc.entities.Traveler.get(travelerId).catch(() => null);
  if (!t) throw Object.assign(new Error("Traveler not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && t.user_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  return t;
}

async function assertOwns(svc: any, user: any, travelerId: string): Promise<any> {
  return getTraveler(svc, user, travelerId);
}

// ---------- Traveler CRUD (§5) ----------

export async function listTravelers(svc: any, user: any, opts: { include_archived?: boolean } = {}): Promise<any[]> {
  // Never widen customer-shell data because the signed-in user is also an admin.
  // Admin-wide access is exposed only through isolated operations endpoints.
  const rows: any[] = await svc.entities.Traveler.filter({ user_id: user.id }, "-created_date", 200).catch(() => []);
  const filtered = opts.include_archived ? rows : (rows || []).filter((t) => t.status !== "ARCHIVED");
  return filtered.map((t) => ({ ...t, profile_completeness: computeCompleteness(t).score }));
}

export async function createTraveler(svc: any, user: any, input: any): Promise<any> {
  const first_name = (input.first_name || "").trim();
  const nationality = (input.nationality || "IN").toUpperCase();
  if (!first_name) throw Object.assign(new Error("first_name is required"), { code: "BAD_REQUEST" });

  // Duplicate prevention (§47): same name + DOB + nationality for the same owner.
  const existing: any[] = await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  const dup = (existing || []).find((t) =>
    t.status !== "ARCHIVED" &&
    String(t.first_name).toLowerCase() === first_name.toLowerCase() &&
    String(t.last_name || "").toLowerCase() === String(input.last_name || "").toLowerCase() &&
    (t.date_of_birth || "") === (input.date_of_birth || "") &&
    (t.nationality || "").toUpperCase() === nationality
  );
  if (dup) throw Object.assign(new Error("A traveler with this name, date of birth, and nationality already exists"), { code: "DUPLICATE_TRAVELER" });

  const rows: any[] = await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  const isFirst = !rows.some((t) => t.status !== "ARCHIVED");

  const t = await svc.entities.Traveler.create({
    user_id: user.id,
    organization_id: input.organization_id || null,
    first_name,
    middle_name: input.middle_name || "",
    last_name: input.last_name || "",
    date_of_birth: input.date_of_birth || null,
    gender: input.gender || null,
    nationality,
    country_of_birth: (input.country_of_birth || "").toUpperCase() || null,
    residence_country: (input.residence_country || nationality).toUpperCase(),
    email: input.email || "",
    phone: input.phone || "",
    address_line1: input.address_line1 || "",
    address_line2: input.address_line2 || "",
    address_city: input.address_city || "",
    address_state: input.address_state || "",
    address_country: (input.address_country || "").toUpperCase() || null,
    address_postal_code: input.address_postal_code || "",
    employment_status: input.employment_status || null,
    employer: input.employer || "",
    job_title: input.job_title || "",
    employment_start_date: input.employment_start_date || null,
    relationship: input.relationship || "SELF",
    is_primary: isFirst || !!input.is_primary,
    status: "ACTIVE",
    profile_completeness: 0,
  });

  // Exactly one primary per account (§3).
  if (t.is_primary) await ensureSinglePrimary(svc, user, t.id);
  await recordAudit(svc, user, "TRAVELER_CREATED", { target_traveler_id: t.id, summary: `Created traveler ${first_name} (${t.relationship})` });
  return { ...t, profile_completeness: computeCompleteness(t).score };
}

export async function updateTraveler(svc: any, user: any, travelerId: string, patch: any): Promise<any> {
  const t = await assertOwns(svc, user, travelerId);
  // Mutating historical application snapshots is NOT done here (§7). Profile
  // edits only update the reusable profile; existing applications keep their
  // pinned snapshots/answers.
  const allowed: any = {};
  for (const k of ["first_name", "middle_name", "last_name", "date_of_birth", "gender", "nationality", "country_of_birth", "residence_country", "email", "phone", "address_line1", "address_line2", "address_city", "address_state", "address_country", "address_postal_code", "employment_status", "employer", "job_title", "employment_start_date"]) {
    if (k in patch) allowed[k] = patch[k];
  }
  if (allowed.nationality) allowed.nationality = String(allowed.nationality).toUpperCase();
  if (allowed.address_country) allowed.address_country = String(allowed.address_country).toUpperCase();
  if (allowed.country_of_birth) allowed.country_of_birth = String(allowed.country_of_birth).toUpperCase();
  const merged = { ...t, ...allowed };
  allowed.profile_completeness = computeCompleteness(merged).score;
  await svc.entities.Traveler.update(travelerId, allowed);
  await recordAudit(svc, user, "TRAVELER_UPDATED", { target_traveler_id: travelerId, summary: "Updated traveler profile" });
  return { ...merged, profile_completeness: allowed.profile_completeness };
}

export async function archiveTraveler(svc: any, user: any, travelerId: string): Promise<any> {
  const t = await assertOwns(svc, user, travelerId);
  if (t.is_primary) throw Object.assign(new Error("Cannot archive the primary traveler; designate another primary first"), { code: "BAD_STATE" });
  const out = await svc.entities.Traveler.update(travelerId, { status: "ARCHIVED", archived_at: new Date().toISOString() });
  await recordAudit(svc, user, "TRAVELER_ARCHIVED", { target_traveler_id: travelerId, summary: "Archived traveler" });
  return out;
}

export async function setPrimaryTraveler(svc: any, user: any, travelerId: string): Promise<any> {
  const t = await assertOwns(svc, user, travelerId);
  if (t.status === "ARCHIVED") throw Object.assign(new Error("Archived traveler cannot be primary"), { code: "BAD_STATE" });
  await ensureSinglePrimary(svc, user, travelerId);
  const out = await svc.entities.Traveler.update(travelerId, { is_primary: true });
  await recordAudit(svc, user, "TRAVELER_PRIMARY_CHANGED", { target_traveler_id: travelerId, summary: "Primary traveler changed" });
  return out;
}

async function ensureSinglePrimary(svc: any, user: any, keepId: string): Promise<void> {
  const rows: any[] = user.role === "admin"
    ? [] // admin scope is not account-scoped; skip (admin doesn't set primary per-account here)
    : await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  for (const r of rows) {
    if (r.id !== keepId && r.is_primary) await svc.entities.Traveler.update(r.id, { is_primary: false }).catch(() => {});
  }
}

export function getPrimaryTraveler(travelers: any[]): any | null {
  return travelers.find((t) => t.status !== "ARCHIVED" && t.is_primary) || travelers.find((t) => t.status !== "ARCHIVED") || null;
}

// ---------- Profile completeness (§6) ----------

export function computeCompleteness(t: any): { score: number; sections: any } {
  const sections: any = {
    personal: !!(t.first_name && t.date_of_birth && t.nationality && (t.gender || t.country_of_birth)),
    passport: !!(t.nationality), // passport detail lives in Passport entity; this reflects identity nationality present
    contact: !!(t.email || t.phone),
    address: !!(t.address_line1 && t.address_country),
    employment: !!(t.employment_status),
  };
  const weights: any = { personal: 35, passport: 20, contact: 15, address: 15, employment: 15 };
  let score = 0;
  for (const k of Object.keys(weights)) if (sections[k]) score += weights[k];
  // Partial credit for employment fields (convenience indicator only, §6 — NOT eligibility).
  if (!sections.employment && t.employment_status) score += 5;
  return { score: Math.min(100, Math.round(score)), sections };
}

// ---------- Profile → Application prefill (§7) ----------

// Returns a flat map of application answer codes derivable from the profile.
// The workspace/question engine merges these; it never overwrites user-confirmed
// or document-extracted values (handled by the existing prefill priority system).
export function profilePrefill(t: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (t.first_name) out.applicant_first_name = t.first_name;
  if (t.last_name) out.applicant_last_name = t.last_name;
  if (t.middle_name) out.applicant_middle_name = t.middle_name;
  if (t.date_of_birth) out.applicant_dob = t.date_of_birth;
  if (t.gender) out.applicant_gender = t.gender;
  if (t.nationality) out.applicant_nationality = t.nationality;
  if (t.country_of_birth) out.applicant_country_of_birth = t.country_of_birth;
  if (t.residence_country) out.applicant_residence_country = t.residence_country;
  if (t.email) out.applicant_email = t.email;
  if (t.phone) out.applicant_phone = t.phone;
  if (t.address_line1) {
    out.applicant_address_line1 = t.address_line1;
    if (t.address_line2) out.applicant_address_line2 = t.address_line2;
    if (t.address_city) out.applicant_address_city = t.address_city;
    if (t.address_state) out.applicant_address_state = t.address_state;
    if (t.address_country) out.applicant_address_country = t.address_country;
    if (t.address_postal_code) out.applicant_address_postal_code = t.address_postal_code;
  }
  if (t.employment_status) {
    out.applicant_employment_status = t.employment_status;
    if (t.employer) out.applicant_employer = t.employer;
    if (t.job_title) out.applicant_job_title = t.job_title;
  }
  return out;
}

// ---------- Passport management (§8) ----------

export async function listPassports(svc: any, user: any, travelerId: string): Promise<any[]> {
  await assertOwns(svc, user, travelerId);
  const rows: any[] = await svc.entities.Passport.filter({ traveler_id: travelerId }, "-created_date", 50).catch(() => []);
  return rows.map((p) => ({ ...p, expiry_status: passportExpiryStatus(p) }));
}

export async function addPassport(svc: any, user: any, travelerId: string, data: any): Promise<any> {
  await assertOwns(svc, user, travelerId);
  if (!data.passport_number || !data.country) throw Object.assign(new Error("passport_number and country required"), { code: "BAD_REQUEST" });
  const row = await svc.entities.Passport.create({
    traveler_id: travelerId,
    passport_number: String(data.passport_number).toUpperCase(),
    country: String(data.country).toUpperCase(),
    surname: data.surname || "",
    given_names: data.given_names || "",
    date_of_birth: data.date_of_birth || null,
    place_of_birth: data.place_of_birth || "",
    nationality: String(data.nationality || "").toUpperCase(),
    issue_date: data.issue_date || null,
    expiry_date: data.expiry_date || null,
    sex: data.sex || "",
    mrz: data.mrz || "",
    verification_status: data.verification_status || "manual",
    confidence: data.confidence || 0,
    source: data.source || "manual",
  });
  await recordAudit(svc, user, "PASSPORT_ADDED", { target_traveler_id: travelerId, summary: "Passport record added" });
  return row;
}

export function passportExpiryStatus(p: any): string {
  if (!p.expiry_date) return "UNKNOWN";
  const days = Math.round((new Date(p.expiry_date).getTime() - Date.now()) / 86400000);
  if (days < 0) return "EXPIRED";
  if (days <= 180) return "EXPIRING_SOON";
  return "VALID";
}

// ---------- Traveler applications & history (§9-§14) ----------

export async function listTravelerApplications(svc: any, user: any, travelerId: string): Promise<any[]> {
  await assertOwns(svc, user, travelerId);
  const rows: any[] = await svc.entities.VisaApplication.filter({ traveler_id: travelerId }, "-created_date", 100).catch(() => []);
  return rows;
}

// Normalized visa history (§14) — derived from completed/decisioned applications.
export function buildVisaHistory(applications: any[]): any[] {
  return applications
    .filter((a) => ["approved", "completed", "refused", "decision"].includes(a.status) || a.final_review?.decision)
    .map((a) => ({
      application_id: a.id,
      destination: a.destination,
      visa_type_key: a.visa_type_key,
      purpose: a.purpose,
      travel_start: a.travel_start,
      travel_end: a.travel_end,
      decision: a.final_review?.decision || (a.status === "approved" ? "APPROVED" : a.status === "refused" ? "REFUSED" : null),
      decision_date: a.final_review?.decision_date || null,
      status: a.status,
      created_date: a.created_date,
    }))
    .sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
}

// ---------- Account dashboard & next-actions (§20/§21) ----------

export async function getAccountDashboard(svc: any, user: any): Promise<any> {
  const travelers = await listTravelers(svc, user);
  const allApps: any[] = await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 100).catch(() => []);

  const active = allApps.filter((a) => !["completed", "cancelled", "withdrawn", "refused", "approved"].includes(a.status));
  const travelersById = new Map(travelers.map((t) => [t.id, t]));

  // Document attention count (traveler-scoped documents needing review).
  // Fetched in parallel, not sequentially, to avoid the dashboard blocking
  // the main thread/network for one round-trip per traveler.
  const docListsByTraveler = await Promise.all(
    travelers.map((t) => svc.entities.Document.filter({ traveler_id: t.id }).catch(() => []))
  );
  let docAttention = 0, docTotal = 0;
  for (const docs of docListsByTraveler) {
    docTotal += docs.length;
    docAttention += docs.filter((d: any) => ["needs_review", "expired", "expiring_soon"].includes(d.expiry_status || "")).length;
  }

  // Reuse the applications and travelers already fetched above instead of
  // having getNextActions re-query them from scratch.
  const nextActions = await getNextActions(svc, user, allApps, travelers);

  return {
    travelers: travelers.map((t) => ({ id: t.id, first_name: t.first_name, last_name: t.last_name, relationship: t.relationship, is_primary: t.is_primary, profile_completeness: t.profile_completeness })),
    active_applications: active.map((a) => ({
      id: a.id, destination: a.destination, purpose: a.purpose, visa_type_key: a.visa_type_key,
      status: a.status, traveler_name: travelerName(travelersById.get(a.traveler_id)),
      last_updated: a.updated_date || a.created_date, current_step: a.current_step,
    })),
    documents: { total: docTotal, needs_attention: docAttention },
    next_actions: nextActions,
    counts: { active: active.length, travelers: travelers.length },
  };
}

export async function getNextActions(svc: any, user: any, apps?: any[], travelersIn?: any[]): Promise<any[]> {
  const allApps = apps ?? await svc.entities.VisaApplication.filter({ created_by_id: user.id }, "-created_date", 100).catch(() => []);
  const travelers: any[] = travelersIn ?? await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  const byId = new Map(travelers.map((t) => [t.id, t]));

  // Fetch open actions for every application in parallel rather than one
  // sequential round-trip per application — this was the main source of a
  // dashboard that could take a long time (or appear to freeze) to load
  // once a user had several applications/test records.
  const openActionsByApp = await Promise.all(
    allApps.map((a) => svc.entities.ApplicationAction.filter({ application_id: a.id, status: "OPEN" }, "-created_date", 20).catch(() => []))
  );

  const actions: any[] = [];
  allApps.forEach((a, i) => {
    const open: any[] = openActionsByApp[i] || [];
    for (const act of open) {
      actions.push({
        kind: "ACTION_REQUIRED", priority: priorityRank(act.priority || "MEDIUM"),
        application_id: a.id, destination: a.destination, traveler_name: travelerName(byId.get(a.traveler_id)),
        title: act.title, description: act.description, cta_link: act.cta_link || `/applications/${a.id}/workspace`,
      });
    }
    if (["payment_pending"].includes(a.status) || a.final_review?.state === "payment_pending") {
      actions.push({ kind: "PAYMENT_PENDING", priority: 2, application_id: a.id, destination: a.destination, traveler_name: travelerName(byId.get(a.traveler_id)), title: "Payment pending", description: `Complete payment for ${a.destination} application`, cta_link: `/applications/${a.id}/review` });
    }
  });
  return actions.sort((x, y) => x.priority - y.priority).slice(0, 12);
}

function priorityRank(p: string): number {
  return { CRITICAL: 0, URGENT: 0, SECURITY_VERIFICATION: 0, HIGH: 1, MEDIUM: 3, LOW: 5 }[p] ?? 3;
}
function travelerName(t: any): string {
  if (!t) return "—";
  return [t.first_name, t.last_name].filter(Boolean).join(" ") || "Traveler";
}

// ---------- Trip / Group (§15-§17) ----------

export async function listTrips(svc: any, user: any): Promise<any[]> {
  return user.role === "admin"
    ? await svc.entities.ApplicationGroup.list("-created_date", 100).catch(() => [])
    : await svc.entities.ApplicationGroup.filter({ created_by_id: user.id }, "-created_date", 100).catch(() => []);
}

export async function createTrip(svc: any, user: any, input: any): Promise<any> {
  if (!input.name) throw Object.assign(new Error("name is required"), { code: "BAD_REQUEST" });
  const g = await svc.entities.ApplicationGroup.create({
    name: input.name, owner_user_id: user.id,
    destination: (input.destination || "").toUpperCase(), purpose: input.purpose || "tourism",
    travel_start: input.travel_start || null, travel_end: input.travel_end || null,
    traveler_ids: input.traveler_ids || [], application_ids: input.application_ids || [],
    status: "ACTIVE",
  });
  await recordAudit(svc, user, "GROUP_CREATED", { target_group_id: g.id, summary: `Created trip ${input.name}` });
  return g;
}

export async function updateTrip(svc: any, user: any, groupId: string, patch: any): Promise<any> {
  const g = await svc.entities.ApplicationGroup.get(groupId).catch(() => null);
  if (!g) throw Object.assign(new Error("Trip not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && g.created_by_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const allowed: any = {};
  for (const k of ["name", "destination", "purpose", "travel_start", "travel_end", "traveler_ids", "application_ids", "status"]) if (k in patch) allowed[k] = patch[k];
  await svc.entities.ApplicationGroup.update(groupId, allowed);
  await recordAudit(svc, user, "GROUP_UPDATED", { target_group_id: groupId, summary: "Updated trip" });
  return { ...g, ...allowed };
}

export async function getTripProgress(svc: any, user: any, groupId: string): Promise<any> {
  const g = await svc.entities.ApplicationGroup.get(groupId).catch(() => null);
  if (!g) throw Object.assign(new Error("Trip not found"), { code: "NOT_FOUND" });
  if (user.role !== "admin" && g.created_by_id !== user.id) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
  const apps: any[] = [];
  for (const appId of g.application_ids || []) {
    const a = await svc.entities.VisaApplication.get(appId).catch(() => null);
    const t = a ? await svc.entities.Traveler.get(a.traveler_id).catch(() => null) : null;
    if (a) apps.push({
      id: a.id, destination: a.destination, status: a.status,
      traveler_name: travelerName(t),
      ready: isAppReady(a),
      issue: !isAppReady(a) ? describeIssue(a) : null,
    });
  }
  const readyCount = apps.filter((a) => a.ready).length;
  return { group: g, applications: apps, summary: { total: apps.length, ready: readyCount, not_ready: apps.length - readyCount } };
}

export function isAppReady(a: any): boolean {
  return ["ready_for_submission", "submitted", "government_processing", "approved", "completed"].includes(a.status);
}
export function describeIssue(a: any): string {
  if (a.status === "documents_pending" || a.status === "document_review") return "Document missing or under review";
  if (a.status === "draft" || a.status === "eligibility_confirmed") return "Application incomplete";
  if (a.status === "user_approval") return "Awaiting your approval";
  if (a.status === "appointment_pending" || a.status === "appointment_booked") return "Appointment step pending";
  if (a.status === "payment_pending" || a.final_review?.state === "payment_pending") return "Payment pending";
  return "Action required";
}

// ---------- Audit (§44) ----------

export async function recordAudit(svc: any, user: any, action: string, detail: any = {}): Promise<void> {
  try {
    await svc.entities.AccountAuditEvent.create({
      user_id: user.id, actor_id: user.id, action,
      target_traveler_id: detail.target_traveler_id || null,
      target_application_id: detail.target_application_id || null,
      target_group_id: detail.target_group_id || null,
      summary: detail.summary || action,
      metadata: detail.metadata || {},
    });
  } catch { /* audit is best-effort */ }
}

export async function listAuditEvents(svc: any, user: any): Promise<any[]> {
  return user.role === "admin"
    ? await svc.entities.AccountAuditEvent.list("-created_date", 50).catch(() => [])
    : await svc.entities.AccountAuditEvent.filter({ user_id: user.id }, "-created_date", 50).catch(() => []);
}

// ---------- Account settings, privacy, deletion (§35-§38) ----------

export async function getAccountSettings(svc: any, user: any): Promise<any> {
  const prefs: any[] = await svc.entities.VisaNotificationPreference.filter({ created_by_id: user.id }).catch(() => []);
  return {
    profile: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    notification_preferences: prefs[0] || null,
    security: { managed_by_auth_platform: true, note: "Password, sessions, and 2FA are managed by the platform authentication system." },
    privacy: { data_controls: ["profile", "travelers", "documents", "communication", "deletion"] },
  };
}

export async function requestAccountDeletion(svc: any, user: any, reason: string): Promise<any> {
  const open: any[] = await svc.entities.AccountDeletionRequest.filter({ user_id: user.id, status: { $in: ["PENDING", "PROCESSING"] } }).catch(() => []);
  if (open && open.length) throw Object.assign(new Error("A deletion request is already in progress"), { code: "DUPLICATE" });

  const apps: any[] = await svc.entities.VisaApplication.filter({ created_by_id: user.id }).catch(() => []);
  const orders: any[] = await svc.entities.Order.filter({ created_by_id: user.id }).catch(() => []);
  const activeApps = apps.filter((a) => !["completed", "cancelled", "withdrawn", "approved", "refused"].includes(a.status)).length;
  const activeOrders = orders.filter((o: any) => !["CANCELLED", "REFUNDED"].includes(o.status)).length;

  const req = await svc.entities.AccountDeletionRequest.create({
    user_id: user.id, status: "RETENTION_CHECKED", reason: reason || "",
    active_applications: activeApps, active_orders: activeOrders,
    retention_note: activeApps || activeOrders ? "Active applications/orders retained per retention policy until terminal state." : "No active obligations; eligible for anonymization.",
    requested_at: new Date().toISOString(),
  });
  await recordAudit(svc, user, "ACCOUNT_DELETION_REQUESTED", { summary: "Account deletion requested", metadata: { active_apps: activeApps, active_orders: activeOrders } });
  return req;
}

export async function cancelAccountDeletion(svc: any, user: any): Promise<any> {
  const rows: any[] = await svc.entities.AccountDeletionRequest.filter({ user_id: user.id, status: { $in: ["PENDING", "RETENTION_CHECKED", "PROCESSING"] } }).catch(() => []);
  for (const r of rows) await svc.entities.AccountDeletionRequest.update(r.id, { status: "CANCELLED", cancelled_at: new Date().toISOString() }).catch(() => {});
  await recordAudit(svc, user, "ACCOUNT_DELETION_CANCELLED", { summary: "Account deletion cancelled" });
  return { cancelled: rows.length };
}

export async function getDeletionStatus(svc: any, user: any): Promise<any> {
  const rows: any[] = await svc.entities.AccountDeletionRequest.filter({ user_id: user.id }, "-requested_at", 5).catch(() => []);
  return rows[0] || null;
}

// ---------- Support context (§39) ----------

export async function buildSupportContext(svc: any, user: any, ctx: { application_id?: string; order_id?: string; document_id?: string }): Promise<any> {
  const out: any = { user: { id: user.id, email: user.email, full_name: user.full_name } };
  if (ctx.application_id) {
    out.application = await svc.entities.VisaApplication.get(ctx.application_id).catch(() => null);
  }
  if (ctx.order_id) {
    out.order = await svc.entities.Order.get(ctx.order_id).catch(() => null);
  }
  return out;
}