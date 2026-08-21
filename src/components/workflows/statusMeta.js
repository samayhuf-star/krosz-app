import {
  CheckCircle2, Clock, ShieldCheck, Loader2, AlertTriangle, SkipForward, Ban, Pause, Play,
} from 'lucide-react';

// Task (node) status presentation.
export const STATUS_META = {
  completed: { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2, label: 'Completed' },
  approved: { color: 'text-sky-700 bg-sky-50 border-sky-200', dot: 'bg-sky-500', icon: ShieldCheck, label: 'Approved' },
  awaiting_approval: { color: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500', icon: ShieldCheck, label: 'Approval required', pulse: true },
  ready: { color: 'text-indigo-700 bg-indigo-50 border-indigo-200', dot: 'bg-indigo-500', icon: Play, label: 'Ready' },
  pending: { color: 'text-slate-500 bg-slate-50 border-slate-200', dot: 'bg-slate-300', icon: Clock, label: 'Queued' },
  running: { color: 'text-sky-700 bg-sky-50 border-sky-200', dot: 'bg-sky-500', icon: Loader2, label: 'Running', spin: true, pulse: true },
  retrying: { color: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500', icon: Loader2, label: 'Retrying', spin: true },
  blocked: { color: 'text-rose-700 bg-rose-50 border-rose-200', dot: 'bg-rose-500', icon: Ban, label: 'Blocked' },
  failed: { color: 'text-red-700 bg-red-50 border-red-200', dot: 'bg-red-500', icon: AlertTriangle, label: 'Failed' },
  skipped: { color: 'text-slate-400 bg-slate-50 border-slate-200', dot: 'bg-slate-300', icon: SkipForward, label: 'Skipped' },
  rejected: { color: 'text-rose-700 bg-rose-50 border-rose-200', dot: 'bg-rose-500', icon: AlertTriangle, label: 'Rejected' },
  cancelled: { color: 'text-slate-400 bg-slate-50 border-slate-200', dot: 'bg-slate-400', icon: Ban, label: 'Cancelled' },
};

// Run status presentation.
export const RUN_STATUS_META = {
  running: { color: 'text-sky-700 bg-sky-50', dot: 'bg-sky-500', label: 'Running' },
  ready: { color: 'text-indigo-700 bg-indigo-50', dot: 'bg-indigo-500', label: 'Ready' },
  pending: { color: 'text-slate-600 bg-slate-50', dot: 'bg-slate-400', label: 'Pending' },
  awaiting_approval: { color: 'text-amber-700 bg-amber-50', dot: 'bg-amber-500', label: 'Awaiting approval' },
  paused_approval: { color: 'text-amber-700 bg-amber-50', dot: 'bg-amber-500', label: 'Awaiting approval' },
  paused: { color: 'text-slate-500 bg-slate-50', dot: 'bg-slate-400', icon: Pause, label: 'Paused' },
  completed: { color: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500', label: 'Completed' },
  failed: { color: 'text-red-700 bg-red-50', dot: 'bg-red-500', label: 'Failed' },
  cancelled: { color: 'text-slate-500 bg-slate-50', dot: 'bg-slate-400', label: 'Cancelled' },
};

export const prettyKey = (k) =>
  (k || '').replace(/^./, (c) => c.toUpperCase()).replace(/_/g, ' ');

export const ACTIVE_RUN_STATES = new Set([
  'running', 'ready', 'pending', 'awaiting_approval', 'paused_approval',
]);

// Topological layers for DAG rendering. Layer 0 = no dependencies; each task sits
// one layer after its deepest dependency. Guards against malformed input.
export function computeLayers(tasks) {
  const byKey = {};
  tasks.forEach((t) => { byKey[t.task_key] = t; });
  const layerOf = {};
  const visiting = {};
  const layer = (key) => {
    if (key in layerOf) return layerOf[key];
    if (visiting[key]) return 0; // cycle guard (shouldn't happen — DAG-validated)
    visiting[key] = true;
    const deps = byKey[key]?.depends_on || [];
    const base = deps.length
      ? deps.map((d) => (d in byKey ? layer(d) : 0)).reduce((a, b) => Math.max(a, b), 0) + 1
      : 0;
    visiting[key] = false;
    layerOf[key] = base;
    return base;
  };
  tasks.forEach((t) => layer(t.task_key));
  const layers = {};
  tasks.forEach((t) => {
    const i = layerOf[t.task_key];
    // stable order within a layer by the declared workflow order
    (layers[i] = layers[i] || []).push(t);
  });
  return Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) =>
      layers[i].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}

export const fmtDuration = (ms) => {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

export const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};