// Launch Assistant prompt registry. The assistant never embeds prompts — it references
// versioned prompt ids that the AI Orchestration Engine resolves. This module seeds
// (idempotently, per tenant) the two Launch Assistant capabilities that need AI:
//   - launch.assessment       → assesses the goal against the Knowledge Graph and returns
//                                readiness + clarifying questions.
//   - launch.recommendations  → post-launch growth / optimization recommendations.
// Never overwrites an existing version (registry creates a new row). Business health
// scores and the launch report are computed deterministically (no AI needed).

import { latestPrompt, registerPrompt } from '../orchestration/registry.ts';

const ASSESSMENT_PROMPT = {
  prompt_id: 'launch.assessment',
  capability: 'LaunchAssistant',
  module: 'launch_assistant',
  variables: ['goal', 'brief', 'current_state'],
  default_model: 'automatic',
  fallback_models: ['gemini_3_flash'],
  response_schema: {
    type: 'object',
    properties: {
      goal_understood: { type: 'string' },
      readiness: {
        type: 'object',
        additionalProperties: true,
        properties: { score: { type: 'number' }, label: { type: 'string' } },
        required: ['score', 'label'],
      },
      clarifying_questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: { question: { type: 'string' }, field: { type: 'string' }, reason: { type: 'string' } },
          required: ['question'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['goal_understood', 'readiness', 'summary'],
  },
  content:
    'You are the Launch Assistant, an executive business copilot for the AI Business Launch OS.\n' +
    'The user stated this goal: {{goal}}\n' +
    'Additional context: {{brief}}\n\n' +
    'CURRENT BUSINESS STATE (from the Business Knowledge Graph — read-only, single source of truth):\n' +
    '{{business_context}}\n\n' +
    'SUMMARY OF WHAT EXISTS ALREADY: {{current_state}}\n\n' +
    'Assess how ready this business is to execute that goal. Identify any genuinely missing information the assistant should ask the customer for before launching (only ask for things not already present in the knowledge graph). Return ONLY JSON: goal_understood (one sentence confirming the goal), readiness {score 0-100, label e.g. "Ready"|"Mostly ready"|"Needs info"}, clarifying_questions [{question, field, reason}] (empty array if nothing is missing), and summary (2-3 sentences of plain-language explanation for an executive). Be concise and grounded in the provided state — never invent data.',
};

const RECOMMENDATIONS_PROMPT = {
  prompt_id: 'launch.recommendations',
  capability: 'LaunchAssistant',
  module: 'launch_assistant',
  variables: ['goal', 'health_json'],
  default_model: 'automatic',
  fallback_models: ['gemini_3_flash'],
  response_schema: {
    type: 'object',
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            key: { type: 'string' },
            title: { type: 'string' },
            category: { type: 'string', enum: ['seo', 'website', 'domain', 'crm', 'team', 'automation', 'growth', 'support', 'marketing', 'other'] },
            priority: { type: 'number' },
            rationale: { type: 'string' },
            action_label: { type: 'string' },
            action_target: { type: 'string' },
          },
          required: ['key', 'title', 'category', 'priority'],
        },
      },
    },
    required: ['recommendations'],
  },
  content:
    'You are the Launch Assistant for the AI Business Launch OS. A business launch just completed (or partially completed). Recommend concrete next actions the owner should take to grow and optimize.\n\n' +
    'Business Knowledge Graph (read-only):\n{{business_context}}\n\n' +
    'Goal: {{goal}}\n\n' +
    'Business health snapshot: {{health_json}}\n\n' +
    'Return ONLY JSON { recommendations: [...] }. Each recommendation: key (snake_case unique id), title (short), category (one of seo/website/domain/crm/team/automation/growth/support/marketing/other), priority 0-100, rationale (one sentence why), action_label (button label e.g. "Unlock premium domain"), action_target (a route like /seo or /crm). Produce 5-8 prioritized items. Ground them in the actual health gaps; never invent. Order by priority descending.',
};

const SEEDS = [ASSESSMENT_PROMPT, RECOMMENDATIONS_PROMPT];

/** Idempotently ensure the launch-assistant prompts exist for a tenant. */
export async function ensureLaunchPrompts(svc: any, tenantId: string): Promise<void> {
  if (!tenantId) return;
  for (const s of SEEDS) {
    try {
      const exists = await latestPrompt(svc, s.prompt_id, tenantId);
      if (!exists) {
        await registerPrompt(svc, { ...s, tenant_id: tenantId, status: 'approved' } as any);
      }
    } catch {
      // never block the launch flow on prompt seeding
    }
  }
}