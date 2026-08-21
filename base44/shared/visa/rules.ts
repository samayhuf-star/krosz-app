// Worldz Visa (Phase 6) — deterministic condition evaluator.
// Shared by: question visibility rules, RequirementRule applicability (Phase 2),
// and any future deterministic branch. This IS the single conditional-expression
// engine for the visa domain — there is no competing evaluator.
//
// Semantics mirror RequirementRule (Phase 2): { field, operator, value }.
// Operators: eq | neq | gt | lt | gte | lte | in | exists
//   - eq/neq: string comparison (normalized: case-insensitive, trimmed).
//   - gt/lt/gte/lte: numeric, OR ISO-date comparison when both operands look like dates.
//   - in: value is an array; true if facts[field] (or its array elements) intersect.
//   - exists: true when the fact is present, non-empty, and not false.

export type Operator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "exists";

export interface Condition {
  field: string;
  operator: Operator;
  value?: any;
  applies_to_purposes?: string[];
  applies_to_destinations?: string[];
}

function looksLikeDate(v: any): boolean {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}/.test(v) || !Number.isNaN(new Date(v).getTime());
}
function asDateNum(v: any): number | null {
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

function normStr(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Evaluate a single deterministic condition against a flat facts map. */
export function evaluateCondition(cond: Condition | null | undefined, facts: Record<string, any>): boolean {
  if (!cond || !cond.field) return true;
  const v = facts[cond.field];
  switch (cond.operator) {
    case "eq":
      return normStr(v) === normStr(cond.value);
    case "neq":
      return normStr(v) !== normStr(cond.value);
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      // Date-aware comparison.
      if (looksLikeDate(v) && looksLikeDate(cond.value)) {
        const a = asDateNum(v), b = asDateNum(cond.value);
        if (a == null || b == null) return false;
        return cond.operator === "gt" ? a > b : cond.operator === "lt" ? a < b : cond.operator === "gte" ? a >= b : a <= b;
      }
      const a = Number(v), b = Number(cond.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return cond.operator === "gt" ? a > b : cond.operator === "lt" ? a < b : cond.operator === "gte" ? a >= b : a <= b;
    }
    case "in": {
      const allowed: any[] = Array.isArray(cond.value) ? cond.value : [cond.value];
      const cur = Array.isArray(v) ? v : [v];
      return cur.some((x) => allowed.map(normStr).includes(normStr(x)));
    }
    case "exists":
      return v != null && v !== "" && v !== false;
    default:
      return true;
  }
}

/** Evaluate whether the condition's route scoping matches the application. */
export function conditionAppliesToRoute(cond: Condition | null | undefined, app: { purpose?: string; destination?: string }): boolean {
  if (!cond) return true;
  if (cond.applies_to_purposes && cond.applies_to_purposes.length && !cond.applies_to_purposes.includes(String(app?.purpose || "").toLowerCase())) {
    // question-level scoping is separate; absence of purposes here means route-neutral
  }
  if (cond.applies_to_destinations && cond.applies_to_destinations.length && !cond.applies_to_destinations.includes(String(app?.destination || "").toUpperCase())) return false;
  return true;
}