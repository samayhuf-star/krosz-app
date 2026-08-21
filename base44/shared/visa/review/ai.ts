// Worldz Visa (Phase 13) — bounded AI reviewer.
// Guardrails (§§49-53): AI outputs possible inconsistencies only; never visa
// eligibility / approval probability / fraud claims. Every AI finding is capped
// at WARNING and requires human review. Malformed output or unsupported claims
// are dropped. Deterministic rules always win.
import type { RawFinding, ReviewInput } from "./rules.ts";

const AI_PROMPT = `You are a visa application QA reviewer. You receive STRUCTURED application data and deterministic review findings. \
Identify POSSIBLE inconsistencies, missing context, or data-quality issues that a human should review. \
You MUST NOT: state visa eligibility, predict approval, guarantee an outcome, confirm fraud, or invent facts. \
Every finding MUST cite concrete evidence from the provided data (field paths / values). If evidence is insufficient, emit no finding. \
Return ONLY JSON of shape { "findings": [ { "code": "POSSIBLE_*", "severity": "WARNING", "description": "...", "evidence": ["..."], "requires_human_review": true } ] }.`;

function sanitize(input: ReviewInput): any {
  const p = input.passportFields || {};
  return {
    application: { destination: input.application?.destination, purpose: input.application?.purpose, travel_start: input.application?.travel_start, travel_end: input.application?.travel_end, appointment_required: input.application?.appointment_required },
    traveler: { first_name: input.traveler?.first_name, last_name: input.traveler?.last_name, nationality: input.traveler?.nationality },
    passport: { surname: p.surname, given_names: p.given_names, nationality: p.nationality, date_of_birth: p.date_of_birth, passport_number_masked: p.passport_number ? "****" + String(p.passport_number).slice(-3) : "", expiry_date: p.expiry_date },
    answers: input.answers,
    form_fields: input.formSnapshot?.fields,
    documents: (input.progress.items || []).map((it: any) => ({ type: it.document_type, name: it.name, state: it.state })),
    payment: { required: input.paymentRequired, paid: input.paymentPaid },
    appointment: { required: !!input.application?.appointment_required, booked: input.appointmentBooked },
    deterministic_findings: [], // not sent to avoid echoing; engine merges separately
  };
}

const BLOCKED_PHRASES = ["visa eligible", "eligib", "approval probability", "chance of approval", "guaranteed", "fraud", "approval rate", "visa score"];

export async function runAiReview(base44: any, input: ReviewInput): Promise<RawFinding[]> {
  const payload = sanitize(input);
  const res = await base44.integrations.Core.InvokeLLM({
    prompt: AI_PROMPT + "\n\nDATA:\n" + JSON.stringify(payload).slice(0, 12000),
    response_json_schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              severity: { type: "string" },
              description: { type: "string" },
              evidence: { type: "array", items: { type: "string" } },
              requires_human_review: { type: "boolean" },
            },
          },
        },
      },
    },
  }).catch(() => null);
  const data: any = res?.data || res;
  const raw: any[] = (data && Array.isArray(data.findings)) ? data.findings : [];
  const out: RawFinding[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const desc = String(f.description || "").trim();
    const code = String(f.code || "POSSIBLE_INCONSISTENCY").toUpperCase();
    if (!desc) continue;
    if (BLOCKED_PHRASES.some((p) => (code + " " + desc).toLowerCase().includes(p))) continue;
    const evidence = Array.isArray(f.evidence) ? f.evidence.filter(Boolean) : [];
    if (!evidence.length) continue; // §51: no evidence → drop (no hallucinations).
    out.push({
      category: "Application",
      code: code.startsWith("POSSIBLE_") ? code : `POSSIBLE_${code}`,
      severity: "WARNING", // §52: AI never blocks regardless of confidence.
      title: "Possible issue to review",
      description: desc,
      description_operator: `AI finding; evidence: ${evidence.join(" | ")}`,
      source: "ai:reviewer",
      requires_human_review: true,
      evidence: { evidence },
    });
  }
  return out;
}