import { base44 } from '@/api/base44Client';

// AI Discovery — the zero-form onboarding inference layer.
// One call to an internet-aware model turns a single sentence ("I own a gym in
// Noida") into a complete, structured business profile with web-researched
// existing-presence detection. The frontend only confirms or edits.
//
// Uses gemini_3_flash (supports add_context_from_internet) so the model can
// actually search for the business's website / socials / contact details.
// This is the onboarding moment — worth the richer model.

const SCHEMA = {
  type: 'object',
  properties: {
    business_name: { type: 'string' },
    industry: { type: 'string' },
    business_category: { type: 'string' },
    country: { type: 'string' },
    state: { type: 'string' },
    city: { type: 'string' },
    service_area: { type: 'string' },
    audience: { type: 'string' },
    products: { type: 'array', items: { type: 'string' } },
    services: { type: 'array', items: { type: 'string' } },
    business_model: { type: 'string' },
    target_customers: { type: 'string' },
    business_goal: { type: 'string' },
    suggested_keywords: { type: 'array', items: { type: 'string' } },
    suggested_brand_tone: { type: 'string' },
    suggested_website_structure: { type: 'array', items: { type: 'string' } },
    suggested_crm: { type: 'string' },
    suggested_emails: { type: 'array', items: { type: 'string' } },
    suggested_ai_agents: { type: 'array', items: { type: 'string' } },
    suggested_marketing_direction: { type: 'string' },
    confidence: { type: 'number' },
    existing_info: {
      type: 'object',
      properties: {
        website: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        google_business: { type: 'string' },
        instagram: { type: 'string' },
        facebook: { type: 'string' },
        linkedin: { type: 'string' },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, why: { type: 'string' }, field_key: { type: 'string' } },
        required: ['question', 'field_key'],
      },
    },
  },
  required: ['business_name', 'industry', 'country', 'business_goal', 'confidence'],
};

function memoryLine(accountMemory = {}) {
  const clean = Object.fromEntries(Object.entries(accountMemory).filter(([, v]) => v));
  const keys = Object.keys(clean);
  if (!keys.length) return '';
  return `\n\nAccount-level preferences this owner has ALREADY confirmed on a previous business. REUSE these automatically — do NOT ask for them again, and pre-fill the matching fields (country, contact email/phone, brand tone, language, currency, timezone) unless the new description clearly overrides them: ${JSON.stringify(clean)}`;
}

export async function understandBusiness(description, accountMemory = {}) {
  const prompt = `You are an expert business consultant inside an AI Business Operating System. A business owner described their business in one sentence. Infer a COMPLETE, practical business profile. Use web search to detect any real existing online presence for this business (website, Google Business Profile, Instagram, Facebook, LinkedIn, public phone, public email) and fill existing_info with what you genuinely find — leave fields empty if you cannot verify.

Rules:
- Infer whenever possible. Be specific and realistic, not generic.
- Set confidence (0-100) for how well you understood the business.
- ONLY add a question when critical information cannot be inferred. Max 3 questions. Each question must be short, friendly, include "why" (why you need it), and the "field_key" it fills (one of the schema field names). Never ask for something already inferred or already confirmed in the account-level preferences.
- Suggested fields (keywords, website_structure, emails, ai_agents, crm, marketing_direction) should be tailored to THIS business.

User description: """${description}"""${memoryLine(accountMemory)}`;

  const coerce = (res) => {
    const obj = typeof res === 'string' ? JSON.parse(res) : res;
    if (!obj || !obj.business_name) throw new Error('I could not understand that — could you add a little more detail?');
    return obj;
  };
  const call = (opts, ms) => Promise.race([
    base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: SCHEMA, ...opts }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

  // Attempt 1: internet-aware Gemini (detects real existing web presence).
  // Attempt 2 (fallback): fast inference-only so onboarding never hangs.
  try {
    return coerce(await call({ model: 'gemini_3_flash', add_context_from_internet: true }, 35000));
  } catch (e) {
    return coerce(await call({}, 45000));
  }
}