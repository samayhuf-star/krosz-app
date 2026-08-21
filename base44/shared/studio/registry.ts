// Visual Workflow Builder — auto-generated node library.
// Nodes are derived from the existing engines so a new capability/factory/
// executive/connector automatically appears in the studio palette.
//
// Each palette entry maps to an engine PlanTask `type` (the existing Workflow
// Engine runs it) OR is `structural: true` (Start / End / Merge / Triggers —
// canvas-only, never becomes a task). The studio never invents a new runtime.

import { EXECUTIVES, ROLES } from "../executives/registry.ts";
import { CONNECTOR_CATALOG } from "../integrations/registry.ts";

export interface PaletteNode {
  kind: string;            // palette group id
  group: string;           // display group
  type: string;            // engine PlanTask type (or canvas type when structural)
  label: string;
  icon: string;            // lucide icon name
  structural: boolean;      // true → canvas-only, not emitted as a PlanTask
  description: string;
  defaultConfig?: any;
  cost: { ai: number; api: number; runtime_ms: number };
}

// Real factory adapter types the engine already runs (from engine.ts / adapters).
const FACTORY_NODES: PaletteNode[] = [
  { kind: "factory", group: "Factories", type: "generate_blueprint", label: "Generate Blueprint", icon: "FileText", structural: false, description: "AI-generate the business blueprint.", cost: { ai: 0.04, api: 0, runtime_ms: 6000 } },
  { kind: "factory", group: "Factories", type: "generate_website", label: "Generate Website", icon: "Globe", structural: false, description: "AI-generate the website.", cost: { ai: 0.08, api: 0, runtime_ms: 12000 } },
  { kind: "factory", group: "Factories", type: "generate_seo", label: "Generate SEO", icon: "Search", structural: false, description: "AI-generate SEO assets.", cost: { ai: 0.06, api: 0, runtime_ms: 9000 } },
  { kind: "factory", group: "Factories", type: "generate_crm", label: "Generate CRM", icon: "Users", structural: false, description: "AI-generate the CRM configuration.", cost: { ai: 0.05, api: 0, runtime_ms: 8000 } },
  { kind: "factory", group: "Factories", type: "activate_marketing", label: "Activate Marketing", icon: "Megaphone", structural: false, description: "Plan + activate a marketing campaign.", cost: { ai: 0.05, api: 0, runtime_ms: 7000 } },
  { kind: "factory", group: "Factories", type: "configure_domain", label: "Configure Domain", icon: "Network", structural: false, description: "Register / configure the domain via a registrar provider.", cost: { ai: 0, api: 0.02, runtime_ms: 4000 } },
  { kind: "factory", group: "Factories", type: "verify_domain", label: "Verify Domain", icon: "ShieldCheck", structural: false, description: "Verify DNS / domain status.", cost: { ai: 0, api: 0.01, runtime_ms: 3000 } },
];

export function generateNodeLibrary(): { groups: { kind: string; group: string; nodes: PaletteNode[] }[] } {
  const triggers: PaletteNode[] = [
    { kind: "trigger", group: "Triggers", type: "start", label: "Start", icon: "Play", structural: true, description: "Workflow entry point.", cost: { ai: 0, api: 0, runtime_ms: 0 } },
    { kind: "trigger", group: "Triggers", type: "trigger.webhook", label: "Webhook Trigger", icon: "Webhook", structural: true, description: "Start when an external webhook arrives (wired to a connector).", defaultConfig: { event: "" }, cost: { ai: 0, api: 0, runtime_ms: 0 } },
    { kind: "trigger", group: "Triggers", type: "trigger.schedule", label: "Schedule Trigger", icon: "CalendarClock", structural: true, description: "Start on a cron schedule.", defaultConfig: { cron: "0 7 * * *" }, cost: { ai: 0, api: 0, runtime_ms: 0 } },
  ];
  const flow: PaletteNode[] = [
    { kind: "flow", group: "Flow Control", type: "approval_gate", label: "Approval", icon: "ShieldCheck", structural: false, description: "Pause for a human approval decision.", cost: { ai: 0, api: 0, runtime_ms: 0 } },
    { kind: "flow", group: "Flow Control", type: "noop.delay", label: "Delay", icon: "Clock", structural: false, description: "Wait a fixed duration before continuing.", defaultConfig: { wait: "PT1H" }, cost: { ai: 0, api: 0, runtime_ms: 0 } },
    { kind: "flow", group: "Flow Control", type: "merge", label: "Merge", icon: "GitMerge", structural: true, description: "Fan-in: wait for all incoming branches.", cost: { ai: 0, api: 0, runtime_ms: 0 } },
    { kind: "flow", group: "Flow Control", type: "end", label: "End", icon: "Square", structural: true, description: "Workflow exit.", cost: { ai: 0, api: 0, runtime_ms: 0 } },
  ];
  // One node per AI Executive (Phase 10) — engine stubs until an exec adapter ships.
  const executives: PaletteNode[] = ROLES.filter((r) => !EXECUTIVES[r].architecture_only).map((r) => ({
    kind: "executive", group: "AI Executives", type: `exec.${r}`, label: EXECUTIVES[r].title, icon: "Bot",
    structural: false, description: `Delegate to ${EXECUTIVES[r].title}: ${EXECUTIVES[r].responsibilities.slice(0, 2).join(", ")}.`,
    defaultConfig: { role: r }, cost: { ai: 0.03, api: 0, runtime_ms: 5000 },
  }));
  // One node per installable connector (Phase 11).
  const connectors: PaletteNode[] = CONNECTOR_CATALOG.filter((c) => c.installable).map((c) => ({
    kind: "connector", group: "Integrations", type: `connector.${c.key}`, label: c.name, icon: "Plug",
    structural: false, description: c.description, defaultConfig: { connector_key: c.key },
    cost: { ai: 0, api: 0.002, runtime_ms: 2500 },
  }));
  const notify: PaletteNode[] = [
    { kind: "notify", group: "Output", type: "notify.email", label: "Send Email", icon: "Mail", structural: false, description: "Send a templated email.", cost: { ai: 0, api: 0.001, runtime_ms: 1500 } },
    { kind: "notify", group: "Output", type: "notify.message", label: "Send Message", icon: "MessageSquare", structural: false, description: "Send a message to a channel.", cost: { ai: 0, api: 0.0005, runtime_ms: 1200 } },
  ];
  const groups = [
    { kind: "trigger", group: "Triggers", nodes: triggers },
    { kind: "flow", group: "Flow Control", nodes: flow },
    { kind: "factory", group: "Factories", nodes: FACTORY_NODES },
    { kind: "executive", group: "AI Executives", nodes: executives },
    { kind: "connector", group: "Integrations", nodes: connectors },
    { kind: "notify", group: "Output", nodes: notify },
  ];
  return { groups };
}

export function paletteKey(type: string): PaletteNode | null {
  const lib = generateNodeLibrary();
  for (const g of lib.groups) for (const n of g.nodes) if (n.type === type) return n;
  return null;
}

// Cost estimate for a node config (used by simulation + debugger preview).
export function estimateCost(node: any): { ai: number; api: number; runtime_ms: number } {
  const p = paletteKey(node.type || node.engine_type);
  if (!p) return { ai: 0, api: 0, runtime_ms: 2000 };
  const c = { ...p.cost };
  if (node.config?.cost_override) Object.assign(c, node.config.cost_override);
  return c;
}

// Auto-layout: place nodes in left-to-right layers by dependency depth.
export function autoLayout(tasks: any[]): { nodes: any[]; edges: any[] } {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const depthOf = (k: string, seen = new Set<string>()): number => {
    if (seen.has(k)) return 0; seen.add(k);
    const deps = (byKey.get(k)?.depends_on || []).filter((d) => byKey.has(d));
    if (!deps.length) return 0;
    return 1 + Math.max(...deps.map((d) => depthOf(d, seen)));
  };
  const layer: Record<number, string[]> = {};
  for (const t of tasks) { const d = depthOf(t.key); (layer[d] ||= []).push(t.key); }
  const nodes = tasks.map((t) => {
    const d = depthOf(t.key);
    const idx = layer[d].indexOf(t.key);
    return { id: t.key, type: t.type, title: t.title || t.key, x: 80 + d * 240, y: 80 + idx * 130, structural: false, engine_type: t.type, config: t.config || {}, capability: t.capability, needs_approval: !!t.needs_approval, money_spending: !!t.money_spending };
  });
  const edges: any[] = [];
  for (const t of tasks) for (const d of t.depends_on || []) edges.push({ from: d, to: t.key });
  return { nodes, edges };
}