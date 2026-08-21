// Action Execution — the fixed, real capability registry.
// Every capability here maps to an EXISTING backend that actually performs the
// work (Workflow Engine launchRun / dispatchStandaloneTask, or a direct entity
// read). The interpreter may ONLY return a capability key present here, or
// `not_available`. No capability is listed that the platform cannot genuinely
// execute today — we never fake.
//
// kinds:
//   workflow         → launchRun(svc, {templateId})          — full DAG template
//   standalone_task  → dispatchStandaloneTask(svc, {taskType}) — one factory adapter
//   read             → executeWeRead(svc, businessId, ctx)   — direct entity reads

export type CapabilityKind = "workflow" | "standalone_task" | "read" | "tool";

export interface Capability {
  key: string;
  label: string;
  summary: string;
  kind: CapabilityKind;
  // workflow
  templateId?: string;
  // standalone_task
  taskType?: string;
  taskKey?: string;
  capability?: string; // provider capability requested (ai_generation etc.)
  agentPurpose?: string; // standalone_task + taskType "run_agent": the standard agent to resolve/auto-seed
  argsSchema?: any; // tool: JSON schema validating the agent's tool-call arguments
  // human reasons (optional). The authoritative approval policy lives in the
  // PlanTemplate's approval gates; this is only used to explain "why" to the customer.
  approvalReason?: string;
  // whether re-running makes sense once completed (website/seo/crm regenerate).
  regenerateable?: boolean;
  intents: string[];
}

export const CAPABILITIES: Record<string, Capability> = {
  launch_business: {
    key: "launch_business", label: "Launch the business",
    summary: "Run the full launch journey — blueprint, domain, website, SEO, CRM — end to end.",
    kind: "workflow", templateId: "launch_business",
    approvalReason: "Launching spends money (domain) and publishes your business online, so a couple of checkpoints ask for your approval.",
    regenerateable: false,
    intents: ["launch my business", "launch the business", "start my business", "get my business online", "get my business up and running", "go live", "set everything up"],
  },
  create_website: {
    key: "create_website", label: "Build the website",
    summary: "Generate (or regenerate) the business website through the Website Factory.",
    kind: "standalone_task", taskType: "generate_website", taskKey: "website", capability: "ai_generation",
    approvalReason: "Publishing your site makes it public — I'll ask before it goes live.",
    regenerateable: false,
    intents: ["create my website", "build my website", "make my website", "generate my website", "redesign my website", "rebuild my website"],
  },
  improve_website: {
    key: "improve_website", label: "Improve the website",
    summary: "Regenerate the website with the latest business context.",
    kind: "standalone_task", taskType: "generate_website", taskKey: "website", capability: "ai_generation",
    approvalReason: "Publishing your site makes it public — I'll ask before it goes live.",
    regenerateable: true,
    intents: ["improve my website", "update my website", "fix my website", "make my website better", "refresh my website"],
  },
  improve_seo: {
    key: "improve_seo", label: "Improve SEO / get found on Google",
    summary: "Generate a new SEO edition through the SEO Factory — keywords, on-page SEO, schema.",
    kind: "standalone_task", taskType: "generate_seo", taskKey: "seo", capability: "ai_generation",
    approvalReason: "SEO changes can affect your search ranking — I'll ask before publishing.",
    regenerateable: true,
    intents: ["improve my seo", "improve my google ranking", "get found on google", "rank higher on google", "do my seo", "set up seo", "seo"],
  },
  setup_crm: {
    key: "setup_crm", label: "Set up the CRM",
    summary: "Generate the CRM pipeline, lead scoring and automations through the CRM Factory.",
    kind: "standalone_task", taskType: "generate_crm", taskKey: "crm", capability: "ai_generation",
    regenerateable: false,
    intents: ["set up my crm", "set up crm", "build my crm", "configure my crm", "crm setup", "crm"],
  },
  get_domain_ready: {
    key: "get_domain_ready", label: "Register / configure the domain",
    summary: "Register and configure the business domain through the Domain Engine.",
    kind: "standalone_task", taskType: "configure_domain", taskKey: "domain", capability: "domain_registrar",
    approvalReason: "Registering a domain spends money and creates an external account, so it requires your approval first.",
    regenerateable: false,
    intents: ["register my domain", "get my domain ready", "set up my domain", "buy a domain", "configure my domain", "verify my domain", "domain", "get a domain"],
  },
  relaunch_marketing: {
    key: "relaunch_marketing", label: "Run a marketing campaign",
    summary: "Activate a marketing relaunch — campaign plan and channel activation.",
    kind: "workflow", templateId: "relaunch_marketing",
    approvalReason: "Marketing sends external communications and may spend budget — I'll ask before anything goes out.",
    regenerateable: true,
    intents: ["run a marketing campaign", "create a marketing campaign", "do marketing", "relaunch marketing", "start marketing", "marketing campaign"],
  },
  list_customers: {
    key: "list_customers", label: "Show customers / leads",
    summary: "Read your real leads and contacts from the CRM.",
    kind: "read", regenerateable: false,
    intents: ["show me my customers", "show my customers", "show my new leads", "find my new customers", "show leads", "who are my customers", "list customers", "list leads", "my leads"],
  },
  show_status: {
    key: "show_status", label: "Show business status",
    summary: "Read real status across every business system.",
    kind: "read", regenerateable: false,
    intents: ["how is my business doing", "what's stopping my business from going live", "what is stopping my business", "business status", "status", "what needs my attention", "what's the status", "how are things going", "what needs attention"],
  },
  advice_today: {
    key: "advice_today", label: "What should I do today",
    summary: "Pick the single most important next action from real business state.",
    kind: "read", regenerateable: false,
    intents: ["what should i do today", "what's the most important thing i should do", "what should i do", "what should i do next", "priorities", "next steps", "what now", "what's next", "advice", "what is the most important thing", "what to do today"],
  },
  analyze_website: {
    key: "analyze_website", label: "Analyze the website",
    summary: "Fetch the business website and return a structured analysis (title, technologies, content) via the Website Analyzer agent.",
    kind: "standalone_task", taskType: "run_agent", taskKey: "website_analyzer", capability: "ai_generation",
    agentPurpose: "website_analysis", regenerateable: false,
    intents: ["analyze my website", "analyze the website", "review my website", "check my website", "audit my website", "scan my website", "look at my website"],
  },
  website_fetch: {
    key: "website_fetch", label: "Fetch a website",
    summary: "Fetch a public website URL and return its HTTP status, title, detected technologies, and a content excerpt.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { url: { type: "string", description: "Absolute http(s) URL to fetch." } }, required: ["url"] },
    intents: ["fetch a website", "analyze a website", "look at a website", "read a website url", "scan a website"],
  },
  remember_business_fact: {
    key: "remember_business_fact", label: "Remember a business fact",
    summary: "Persist a durable, validated business fact (e.g. primary_website, business_timezone) to business memory with a confidence score. Use only for confirmed facts, never speculation.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { key: { type: "string", description: "Stable fact key e.g. primary_website, business_timezone." }, value: { type: "string", description: "The fact value." }, confidence: { type: "number", description: "0-1 confidence (>=0.9 verified, 0.5-0.9 reliable, <0.5 weak)." } }, required: ["key", "value", "confidence"] },
    intents: ["remember a business fact", "save a fact", "persist a business fact"],
  },
  // ---- Phase 14: Chatbot tools ---- consumer-facing capabilities the chatbot
  // agent may invoke inside its bounded loop. They execute REAL backends (CRM
  // Lead, Support Ticket, BusinessContext/Knowledge) — nothing is faked.
  lookup_business_info: {
    key: "lookup_business_info", label: "Look up business information",
    summary: "Look up real, approved business information (services, hours, location, contact, prices-if-known) to answer a customer's question. Returns only confirmed facts — never invented.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { query: { type: "string", description: "The customer's information need, e.g. 'timings' or 'do you offer a trial'." } }, required: ["query"] },
    intents: ["what are your", "what services", "how much", "where are you", "what are your timings", "do you offer"],
  },
  check_business_hours: {
    key: "check_business_hours", label: "Check business hours",
    summary: "Return the business's real operating hours and whether it is currently open.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: {}, additionalProperties: true },
    intents: ["are you open", "what are your hours", "are you open now", "business hours"],
  },
  capture_lead: {
    key: "capture_lead", label: "Capture a lead",
    summary: "Create a real CRM Lead from the conversation (source = chatbot, linked to the conversation). Idempotent per conversation — one lead per conversation unless details change materially.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { name: { type: "string", description: "Customer's name." }, phone: { type: "string", description: "Contact phone. Required unless email is present." }, email: { type: "string", description: "Contact email. Required unless phone is present." }, service: { type: "string", description: "What the customer wants (intent), e.g. 'trial', 'callback', 'membership'." }, message: { type: "string", description: "Optional extra context the customer shared." } }, required: ["name", "service"] },
    intents: ["i want a trial", "book", "i want a callback", "contact me", "i'm interested", "membership", "appointment"],
  },
  escalate_to_human: {
    key: "escalate_to_human", label: "Escalate to a human",
    summary: "Create a real Support Ticket and hand the conversation to the business team. Use when the customer asks for a person, wants to complain, or needs something the chatbot can't handle.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { reason: { type: "string", description: "Why escalation is needed (complaint, complex request, customer asked for a person)." }, summary: { type: "string", description: "Short summary of the conversation context for the team." } }, required: ["reason", "summary"] },
    intents: ["speak to a person", "talk to a human", "complaint", "i want to complain", "agent", "manager"],
  },
  // ---- Phase 13C: Website Intelligence Team tools (stateless HTTP fetch tools) ----
  technology_detector: {
    key: "technology_detector", label: "Detect website technologies",
    summary: "Fetch a public website URL and detect its technologies (CMS, frameworks, hosting, analytics).",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { url: { type: "string", description: "Absolute http(s) URL to fetch." } }, required: ["url"] },
    intents: ["detect technologies", "what technologies does the site use", "scan for tech"],
  },
  metadata: {
    key: "metadata", label: "Read page metadata",
    summary: "Fetch a public website URL and return its title, meta description, Open Graph and viewport tags.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { url: { type: "string", description: "Absolute http(s) URL to fetch." } }, required: ["url"] },
    intents: ["read metadata", "get meta tags", "page metadata"],
  },
  robots: {
    key: "robots", label: "Read robots.txt",
    summary: "Fetch the robots.txt for a website and return declared sitemaps, user-agents and disallowed paths.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { url: { type: "string", description: "Website base URL (http(s))." } }, required: ["url"] },
    intents: ["read robots", "robots.txt", "check robots"],
  },
  sitemap: {
    key: "sitemap", label: "Read sitemap.xml",
    summary: "Fetch the sitemap.xml for a website and return the list of URLs and counts.",
    kind: "tool", regenerateable: false,
    argsSchema: { type: "object", properties: { url: { type: "string", description: "Website base URL (http(s))." } }, required: ["url"] },
    intents: ["read sitemap", "sitemap.xml", "check sitemap"],
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES);

// Capabilities that are genuinely NOT automatable yet. Returned honestly as
// `not_available` — never faked. Updated only when a real path exists.
export const UNAVAILABLE_INTENTS = [
  "reply to a customer", "reply to this customer", "reply to john", "reply to an email",
  "call a lead", "make a call", "call a customer",
  "book an appointment", "schedule an appointment",
  "generate a proposal", "write a proposal", "create a proposal",
  "send an email campaign", "send a campaign",
];