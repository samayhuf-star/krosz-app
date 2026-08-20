// Worldz Visa — Traveler CRUD (owner-scoped).

export async function listTravelers(svc: any, user: any): Promise<any[]> {
  // This helper serves customer routes. Administrative portfolio access must
  // use separate operations APIs so customer and admin shells cannot bleed.
  return await svc.entities.Traveler.filter({ user_id: user.id }, "-created_date", 100).catch(() => []);
}

export async function ensureTravelerForUser(svc: any, user: any, defaults: any = {}): Promise<any> {
  const mine: any[] = await svc.entities.Traveler.filter({ user_id: user.id }).catch(() => []);
  if (mine && mine.length) return mine[0];
  const name = (user.full_name || user.email || "Traveler").split(" ");
  const first = defaults.first_name || name[0] || "Traveler";
  const last = defaults.last_name || name.slice(1).join(" ") || "";
  return await svc.entities.Traveler.create({
    user_id: user.id,
    first_name: first,
    last_name: last,
    nationality: defaults.nationality || "IN",
    residence_country: defaults.residence_country || "IN",
    email: user.email || defaults.email || "",
  });
}

// Worldz Visa — Traveler deduplication (Phase 38 data-integrity).
// Deterministic survivor selection: only records with the SAME owner + identity
// fingerprint are eligible to merge. Email alone is intentionally NOT an identity
// key because spouses/children frequently share the account owner's email.
// The survivor is the row carrying the most dependent VisaApplications (most
// history to preserve); tiebreak by oldest created_date, then lowest id.
// Dependent records are repointed to the survivor BEFORE non-survivors are
// archived (status=ARCHIVED). Deletion is never used — archived rows retain
// historical snapshots. Idempotent: archived rows are excluded from clustering,
// so a second run finds only the survivor and no-ops. Admin-only.

export const TRAVELER_DEPENDENT_ENTITIES = [
  "VisaApplication", "Passport", "ApplicationDocument", "CaseEvent",
  "CaseException", "OperationsTask", "OperationsAuditEvent", "ApplicationAction",
  "ApplicationAnswer", "ApplicationTimelineEvent", "ApplicationReview",
  "ApplicationFormSnapshot", "ApplicationConfirmation", "ApplicationFinancialRecord",
  "Document", "DocumentVersion", "DocumentIntelligence", "ExecutionAttempt",
  "ExecutionPlan", "Order", "Payment", "Refund", "Invoice", "Receipt",
  "Submission", "SubmissionPackage", "Appointment", "AppointmentEvent",
  "SupportTicket", "SupportMessage", "SupportConversation", "VisaNotification",
  "VisaNotificationDelivery", "TrackingEvent", "FinancialEvent",
];

export function pickTravelerSurvivor(cluster: any[]): any {
  if (!cluster || !cluster.length) return null;
  return [...cluster].sort((a, b) => {
    const ac = (a.__appCount || 0), bc = (b.__appCount || 0);
    if (bc !== ac) return bc - ac;
    const ad = String(a.created_date || ""), bd = String(b.created_date || "");
    if (ad !== bd) return ad.localeCompare(bd);
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function identityFingerprint(t: any): string | null {
  const userId = String(t?.user_id || "").trim();
  const first = String(t?.first_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const last = String(t?.last_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const dob = String(t?.date_of_birth || "").trim();
  const nationality = String(t?.nationality || "").trim().toUpperCase();
  if (!userId || !first || !nationality) return null;

  // DOB is the strongest discriminator and is required for non-SELF travelers.
  // This prevents family members who share an email from ever being merged.
  if (dob) return `${userId}|${first}|${last}|${dob}|${nationality}`;

  // Legacy SELF rows often predate DOB capture. For these only, allow an exact
  // owner/name/nationality/email fingerprint. Empty email is not sufficient.
  const relationship = String(t?.relationship || "SELF").toUpperCase();
  const email = String(t?.email || "").trim().toLowerCase();
  if (relationship === "SELF" && email) return `${userId}|${first}|${last}|NO_DOB|${nationality}|${email}`;
  return null;
}

export async function canonicalizeTravelers(svc: any, adminId: string): Promise<{ clusters: number; survivors: number; repointed: number; archived: number; details: any[] }> {
  const all = await svc.entities.Traveler.list("-created_date", 500).catch(() : any[] => []);
  const active = all.filter((t) => t.status !== "ARCHIVED"); // idempotent: skip already-archived
  const groups = new Map<string, any[]>();
  for (const t of active) {
    const key = identityFingerprint(t);
    if (!key) continue; // ambiguous legacy rows require human review, never auto-merge
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const details: any[] = [];
  let repointed = 0, archived = 0;
  for (const [key, cluster] of groups) {
    if (cluster.length < 2) continue;
    for (const t of cluster) {
      const apps = await svc.entities.VisaApplication.filter({ traveler_id: t.id }).catch(() : any[] => []);
      (t as any).__appCount = apps.length;
    }
    const survivor = pickTravelerSurvivor(cluster);
    if (!survivor) continue;
    for (const t of cluster) {
      if (t.id === survivor.id) continue;
      for (const entity of TRAVELER_DEPENDENT_ENTITIES) {
        const rows: any[] = await svc.entities[entity].filter({ traveler_id: t.id }).catch(() : any[] => []);
        if (rows && rows.length) {
          await svc.entities[entity].updateMany({ traveler_id: t.id }, { $set: { traveler_id: survivor.id } }).catch(() : any => null);
          repointed += rows.length;
        }
      }
      await svc.entities.Traveler.update(t.id, { status: "ARCHIVED", is_primary: false, archived_at: new Date().toISOString(), metadata: { ...(t.metadata || {}), merged_into: survivor.id, merge_reason: "duplicate_identity_fingerprint", merged_by: adminId, merged_at: new Date().toISOString() } }).catch(() : any => null);
      archived++;
    }
    await svc.entities.Traveler.update(survivor.id, { status: "ACTIVE", is_primary: true }).catch(() : any => null);
    details.push({ cluster_key: key, survivor: survivor.id, survivor_apps: (survivor as any).__appCount, archived: cluster.length - 1 });
  }
  return { clusters: [...groups.values()].filter((g) => g.length >= 2).length, survivors: details.length, repointed, archived, details };
}