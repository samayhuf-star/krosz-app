// AI Executive Team — single source of truth for the executive roles.
// Every executive is an orchestration layer over the existing engines
// (Knowledge Graph, Workflow Engine, Provider Runtime, AI Runtime,
// Business Memory, Business Blueprint, Observation + Recommendation engines).
// Executives NEVER duplicate logic — they consume BusinessObservation and
// LaunchRecommendation records and add a role-specialised reasoning lens.
//
// Reused by the `aiExecutives` backend function (and, later, the in-app agent
// conversation UI). Editing this registry is the ONLY way to change the team.

export type ExecutiveRole = "ceo" | "cmo" | "sales" | "operations" | "support" | "finance";

export interface ExecutiveDefinition {
  role: ExecutiveRole;
  title: string;
  department: string;
  responsibilities: string[];
  // BusinessObservation.source values this executive reasons over.
  observation_sources: string[];
  // LaunchRecommendation.category values this executive may emit.
  recommendation_categories: string[];
  // Other executives this one collaborates with.
  collaborates_with: ExecutiveRole[];
  // Briefing cadences this executive owns.
  briefings: ("morning" | "evening" | "weekly" | "monthly" | "quarterly")[];
  // Actions this executive MAY auto-execute once the user has approved them once.
  allowed_auto_actions: string[];
  // Finance is architecture-only — no accounting logic in Phase 10.
  architecture_only?: boolean;
}

export const EXECUTIVES: Record<ExecutiveRole, ExecutiveDefinition> = {
  ceo: {
    role: "ceo",
    title: "CEO AI",
    department: "Executive",
    responsibilities: ["Business goals", "Overall health", "Business planning", "Growth strategy", "Priorities", "Weekly review", "Monthly review"],
    observation_sources: ["system", "ai", "crm", "email", "communications", "domain", "marketing", "seo", "website"],
    recommendation_categories: ["growth", "team", "marketing", "seo", "other"],
    collaborates_with: ["cmo", "sales", "operations", "support", "finance"],
    briefings: ["morning", "evening", "weekly", "monthly", "quarterly"],
    allowed_auto_actions: ["generate_weekly_review", "generate_monthly_strategy"],
  },
  cmo: {
    role: "cmo",
    title: "CMO AI",
    department: "Marketing",
    responsibilities: ["Marketing", "SEO", "Content", "Social Media", "Campaigns", "Traffic", "Lead generation"],
    observation_sources: ["seo", "website", "marketing"],
    recommendation_categories: ["seo", "marketing", "website", "growth"],
    collaborates_with: ["ceo", "sales", "operations"],
    briefings: ["morning", "weekly", "monthly"],
    allowed_auto_actions: ["publish_scheduled_blog", "generate_seo_page", "create_social_post"],
  },
  sales: {
    role: "sales",
    title: "Sales Manager AI",
    department: "Sales",
    responsibilities: ["CRM", "Leads", "Follow-ups", "Pipeline", "Appointments", "Conversions"],
    observation_sources: ["crm"],
    recommendation_categories: ["crm", "growth"],
    collaborates_with: ["ceo", "cmo", "operations"],
    briefings: ["morning", "weekly"],
    allowed_auto_actions: ["reply_to_lead", "schedule_followup"],
  },
  operations: {
    role: "operations",
    title: "Operations Manager AI",
    department: "Operations",
    responsibilities: ["Daily workflows", "Task execution", "Automation", "Approvals", "Business processes"],
    observation_sources: ["system", "ai", "operations"],
    recommendation_categories: ["automation", "support", "other"],
    collaborates_with: ["ceo", "cmo", "sales", "support", "finance"],
    briefings: ["morning", "evening"],
    allowed_auto_actions: ["run_workflow", "create_report"],
  },
  support: {
    role: "support",
    title: "Customer Support Manager AI",
    department: "Support",
    responsibilities: ["Emails", "Tickets", "Inbox", "Customer satisfaction", "Knowledge base"],
    observation_sources: ["email", "communications"],
    recommendation_categories: ["support"],
    collaborates_with: ["ceo", "operations", "sales"],
    briefings: ["morning", "evening"],
    allowed_auto_actions: ["reply_common_email", "create_ticket"],
  },
  finance: {
    role: "finance",
    title: "Finance Manager AI",
    department: "Finance",
    responsibilities: ["Subscriptions", "Costs", "Provider costs", "Estimated profitability"],
    observation_sources: ["system"],
    recommendation_categories: ["other"],
    collaborates_with: ["ceo", "operations"],
    briefings: ["monthly", "quarterly"],
    allowed_auto_actions: [],
    architecture_only: true,
  },
};

export const ROLES = Object.keys(EXECUTIVES) as ExecutiveRole[];

export function getExecutive(role: string): ExecutiveDefinition | null {
  return (EXECUTIVES as any)[role] || null;
}

// Task types the Goals Engine may emit — each maps to a real orchestrator adapter,
// so a goal's execution plan runs on the existing Workflow Engine without new code.
export const GOAL_TASK_TYPES = [
  "generate_blueprint",
  "generate_website",
  "generate_seo",
  "generate_crm",
  "activate_marketing",
  "configure_domain",
  "approval_gate",
] as const;