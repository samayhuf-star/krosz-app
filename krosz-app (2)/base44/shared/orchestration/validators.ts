// Validation Engine — reusable, capability-scoped validators.
// Future modules register their own validators (Website, CRM, SEO, Marketing …).
// The orchestration engine runs them after every successful AI execution.

export interface ValidationContext {
  schema?: any;
  ctxSnapshot?: any;
  [k: string]: any;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

type Validator = (data: any, ctx: ValidationContext) => string[] | null; // null/[] = pass

const validators = new Map<string, Validator[]>();

export function registerValidator(scope: string, fn: Validator): () => void {
  const arr = validators.get(scope) || [];
  arr.push(fn);
  validators.set(scope, arr);
  return () => {
    const a = validators.get(scope);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
    if (!a.length) validators.delete(scope);
  };
}

export async function validate(capability: string, data: any, ctx: ValidationContext = {}): Promise<ValidationResult> {
  const errors: string[] = [];
  // Global validators always run (non-empty, basic shape).
  for (const fn of validators.get('*') || []) {
    const e = fn(data, ctx);
    if (e?.length) errors.push(...e.map((m) => `[global] ${m}`));
  }
  // Capability-specific validators.
  for (const fn of validators.get(capability) || []) {
    const e = fn(data, ctx);
    if (e?.length) errors.push(...e.map((m) => `[${capability}] ${m}`));
  }
  return { ok: errors.length === 0, errors };
}

// ---------- Built-in global validators ----------
registerValidator('*', (data) => {
  if (data == null) return ['result is null/undefined'];
  if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data || {}).length === 0) return ['result is an empty object'];
  if (typeof data === 'string' && data.trim() === '') return ['result is an empty string'];
  return null;
});

// ---------- Schema-shape validator (checks top-level keys present when schema declares them) ----------
export function schemaShapeValidator(data: any, ctx: ValidationContext): string[] | null {
  const schema = ctx.schema;
  if (!schema || schema.type !== 'object' || !schema.properties) return null;
  const required = (schema.required || []) as string[];
  const missing = required.filter((k) => data?.[k] === undefined || data?.[k] === null || data?.[k] === '');
  if (missing.length) return [`missing required fields: ${missing.join(', ')}`];
  return null;
}
registerValidator('*', schemaShapeValidator);

// ---------- Module validators (registered so Names match the spec) ----------
// These are intentionally lightweight shape checks; modules may register richer ones later.
function hasKeys(keys: string[]): Validator {
  return (data) => {
    if (!data || typeof data !== 'object') return ['expected an object'];
    const missing = keys.filter((k) => data[k] === undefined || data[k] === null);
    return missing.length ? [`missing: ${missing.join(', ')}`] : null;
  };
}

registerValidator('BusinessBlueprint', hasKeys(['business_name', 'business_description']));
registerValidator('WebsiteGeneration', (data) => Array.isArray(data?.pages) && data.pages.length ? null : ['no pages generated']);
registerValidator('LeadManagement', (data) => (Array.isArray(data?.stages) && data.stages.length ? null : ['no pipeline stages']));
registerValidator('SEOGeneration', (data) => (Array.isArray(data?.keywords) || Array.isArray(data?.page_seo) ? null : ['no keyword or page seo data']));
registerValidator('CampaignGeneration', hasKeys(['campaign_name']));