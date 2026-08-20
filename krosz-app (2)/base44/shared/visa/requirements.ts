// Worldz Visa — Phase 2 Requirements Knowledge Graph.
// Dev-labeled seed only. Deterministic generation per route from channel/Schengen flags.
// Resolver pins to a requirements_version; rules evaluated in deterministic order, never by an LLM.

import { SEED_COUNTRIES, requirementsVersion } from "./catalog.ts";

const CHANNEL: Record<string, "evisa" | "vac" | "embassy"> = {
  AE: "evisa", TH: "evisa", VN: "evisa", SG: "evisa", JP: "evisa",
  FR: "vac", DE: "vac", IT: "vac", GB: "embassy", US: "embassy",
};

export interface ReqSpec { category: string; title: string; description?: string; level: "mandatory" | "conditional" | "optional" | "recommended"; doc?: string; ruleId?: string; }
export interface DocSpec { category: string; name: string; level: "mandatory" | "conditional" | "optional"; ruleId?: string; }

function buildRouteRequirements(dest: string, purpose: string): { requirements: ReqSpec[]; documents: DocSpec[]; rules: any[] } {
  const channel = CHANNEL[dest] || "evisa";
  const schengen = (SEED_COUNTRIES.find((c) => c.code === dest) || { is_schengen: false }).is_schengen;
  const reqs: ReqSpec[] = [];
  const docs: DocSpec[] = [];
  const rules: any[] = [];

  // Base requirements — every route
  reqs.push({ category: "passport", title: "Passport valid 6+ months from travel date with 2+ blank pages", description: "Must be original, undamaged.", level: "mandatory", doc: "passport" });
  docs.push({ category: "passport", name: "Passport (bio page + all pages with stamps)", level: "mandatory" });

  reqs.push({ category: "photo", title: channel === "evisa" ? "Digital passport-size photograph (recent, white background)" : "Passport-size photograph (recent, white background)", level: "mandatory", doc: "photo" });
  docs.push({ category: "photo", name: "Passport-size photograph", level: "mandatory" });

  reqs.push({ category: "travel", title: "Confirmed return / onward ticket", level: "mandatory", doc: "return_ticket" });
  docs.push({ category: "return_ticket", name: "Return / onward flight itinerary", level: "mandatory" });

  reqs.push({ category: "financial", title: "Bank statements covering the last 3-6 months", description: "Must show sufficient funds for the stay.", level: "mandatory", doc: "bank_statements" });
  docs.push({ category: "bank_statements", name: "Bank statements (3-6 months)", level: "mandatory" });

  reqs.push({ category: "accommodation", title: "Proof of accommodation for the entire stay", description: "Hotel booking, host letter, or lease.", level: "mandatory", doc: "accommodation_proof" });
  docs.push({ category: "accommodation_proof", name: "Accommodation proof", level: "mandatory" });

  // Schengen → travel insurance
  if (schengen) {
    reqs.push({ category: "insurance", title: "Travel medical insurance covering ≥ €30,000 for the entire Schengen stay", level: "mandatory", doc: "travel_insurance" });
    docs.push({ category: "travel_insurance", name: "Travel medical insurance (≥ €30,000)", level: "mandatory" });
  }

  // Business → invitation + employer letter
  if (purpose === "business") {
    reqs.push({ category: "invitation", title: "Invitation letter from the host company / organization", level: "mandatory", doc: "invitation_letter" });
    docs.push({ category: "invitation_letter", name: "Invitation letter from host", level: "mandatory" });
    reqs.push({ category: "employment", title: "Employer cover letter / No-Objection Certificate on company letterhead", level: "mandatory", doc: "employer_letter" });
    docs.push({ category: "employer_letter", name: "Employer cover letter / NOC", level: "mandatory" });
  }

  // Study → admission letter + stronger financial proof
  if (purpose === "study") {
    reqs.push({ category: "education", title: "Admission / enrollment letter from the institution", level: "mandatory", doc: "admission_letter" });
    docs.push({ category: "admission_letter", name: "Admission letter", level: "mandatory" });
    reqs.push({ category: "financial", title: "Tuition payment proof and guaranteed funds for the study period", level: "mandatory", doc: "tuition_proof" });
    docs.push({ category: "tuition_proof", name: "Tuition + funds proof", level: "mandatory" });
  }

  // Embassy / VAC appointment → biometrics
  if (channel === "embassy" || channel === "vac") {
    reqs.push({ category: "identity", title: `Biometrics capture at ${channel === "vac" ? "the Visa Application Center" : "the embassy/consulate"}`, level: "mandatory" });
  }

  // Conditional rule: prior refusal → police clearance mandatory
  reqs.push({ category: "other", title: "Police clearance certificate", level: "conditional", doc: "police_clearance", ruleId: `rule_${dest}_${purpose}_prev_refusal` });
  docs.push({ category: "police_clearance", name: "Police clearance certificate", level: "conditional", ruleId: `rule_${dest}_${purpose}_prev_refusal` });
  rules.push({ rule_id: `rule_${dest}_${purpose}_prev_refusal`, condition_field: "previous_refusal", operator: "eq", value: "yes", applies_to_category: "other", effect: "required", description: "If the traveler has a prior refusal, police clearance becomes mandatory." });

  return { requirements: reqs, documents: docs, rules };
}

const DEV_SOURCE = { name: "Dev Seed Catalog", source_type: "dev_seed", url: "", confidence: 0.4, status: "active" };

export async function ensureVisaRequirements(svc: any): Promise<{ sources: number; versions: number; requirements: number }> {
  // one dev source
  let source = (await svc.entities.VisaSource.filter({ source_type: "dev_seed" }).catch(() => []))[0];
  if (!source) source = await svc.entities.VisaSource.create(DEV_SOURCE).catch(() => null);
  const sourceId = source?.id || null;

  const dests = SEED_COUNTRIES.filter((c) => c.code !== "IN");
  let vCount = 0, rCount = 0;
  for (const d of dests) {
    for (const purpose of ["tourism", "business", "study"]) {
      const vLabel = requirementsVersion(d.code, purpose);
      // version row
      const vExisting = await svc.entities.VisaRequirementsVersion.filter({ requirements_version: vLabel }).catch(() => []);
      const vRow = { requirements_version: vLabel, destination: d.code, purpose, visa_type_key: `${d.code}-${purpose}`, source_id: sourceId, status: "active", notes: "dev seed" };
      if (vExisting && vExisting.length) await svc.entities.VisaRequirementsVersion.update(vExisting[0].id, vRow).catch(() => {});
      else await svc.entities.VisaRequirementsVersion.create(vRow).catch(() => {});
      vCount++;
      // requirements + documents + rules
      const { requirements, documents, rules } = buildRouteRequirements(d.code, purpose);
      await svc.entities.VisaRequirement.deleteMany({ requirements_version: vLabel }).catch(() => {});
      for (const r of requirements) {
        await svc.entities.VisaRequirement.create({
          requirements_version: vLabel, destination: d.code, purpose, visa_type_key: `${d.code}-${purpose}`,
          category: r.category, title: r.title, description: r.description || null,
          mandatory_level: r.level, document_category: r.doc || null, rule_id: r.ruleId || null, source_id: sourceId, status: "active",
        }).catch(() => {});
        rCount++;
      }
      await svc.entities.DocumentRequirement.deleteMany({ requirements_version: vLabel }).catch(() => {});
      for (const doc of documents) {
        await svc.entities.DocumentRequirement.create({
          requirements_version: vLabel, destination: d.code, purpose, category: doc.category, name: doc.name, mandatory_level: doc.level, rule_id: doc.ruleId || null, source_id: sourceId, status: "active",
        }).catch(() => {});
      }
      await svc.entities.RequirementRule.deleteMany({ requirements_version: vLabel }).catch(() => {});
      for (const rl of rules) {
        await svc.entities.RequirementRule.create({
          rule_id: rl.rule_id, requirements_version: vLabel, destination: d.code, purpose,
          condition_field: rl.condition_field, operator: rl.operator, value: rl.value,
          applies_to_category: rl.applies_to_category, effect: rl.effect, description: rl.description, status: "active",
        }).catch(() => {});
      }
    }
  }
  return { sources: 1, versions: vCount, requirements: rCount };
}

// Deterministic resolution — pin to the active version, return its graph. No AI.
export async function resolveRequirements(svc: any, destination: string, purpose: string): Promise<any> {
  const dest = String(destination || "").toUpperCase();
  const p = String(purpose || "tourism").toLowerCase();
  const vLabel = requirementsVersion(dest, p);
  const versions: any[] = await svc.entities.VisaRequirementsVersion.filter({ requirements_version: vLabel, status: "active" }).catch(() => []);
  if (!versions || !versions.length) return { version: null, requirements: [], documents: [], rules: [], _provenance: { source: "dev_seed", verified: false } };
  const version = versions[0];
  const [requirements, documents, rules] = await Promise.all([
    svc.entities.VisaRequirement.filter({ requirements_version: vLabel, status: "active" }).catch(() => []),
    svc.entities.DocumentRequirement.filter({ requirements_version: vLabel, status: "active" }).catch(() => []),
    svc.entities.RequirementRule.filter({ requirements_version: vLabel, status: "active" }).catch(() => []),
  ]);
  return { version, requirements: requirements || [], documents: documents || [], rules: rules || [], _provenance: { source: "dev_seed", verified: false } };
}