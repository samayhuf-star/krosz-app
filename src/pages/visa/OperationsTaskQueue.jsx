import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { opsTaskList, opsTaskDashboard, opsTaskClaim, opsTaskBulk, opsTaskExport, opsTaskBackfill } from "@/lib/operationsTaskApi";
import PageHeader from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Search, Download, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

const QUEUES = ["ALL", "MY_TASKS", "DOCUMENTS", "REVIEW", "SUBMISSION", "PROVIDER", "ADDITIONAL_INFORMATION", "PAYMENTS", "EXCEPTIONS", "MANUAL_PROCESSING"];
const STATUSES = ["QUEUED", "ASSIGNED", "IN_PROGRESS", "WAITING", "BLOCKED", "COMPLETED", "CANCELLED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const EMPTY_FILTERS = { status: undefined, priority: undefined, unassigned: undefined, overdue: undefined };

const priorityStyle = { URGENT: "bg-red-100 text-red-800", HIGH: "bg-orange-100 text-orange-800", NORMAL: "bg-slate-100 text-slate-700", LOW: "bg-slate-50 text-slate-500" };
const statusStyle = { QUEUED: "bg-slate-100 text-slate-700", ASSIGNED: "bg-blue-100 text-blue-800", IN_PROGRESS: "bg-indigo-100 text-indigo-800", WAITING: "bg-amber-100 text-amber-800", BLOCKED: "bg-red-100 text-red-800", COMPLETED: "bg-orange-100 text-orange-800", CANCELLED: "bg-slate-100 text-slate-500" };

function Metric({ label, value, tone = "default" }) {
  const tones = { default: "border-slate-200", warn: "border-amber-300", crit: "border-red-300", ok: "border-orange-300" };
  return <div className={`rounded-xl border ${tones[tone]} bg-white p-4`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p></div>;
}

export default function OperationsTaskQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [queue, setQueue] = useState("ALL");
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const pageSize = 25;

  const dashQ = useQuery({ queryKey: ["ops-dashboard"], queryFn: opsTaskDashboard, staleTime: 15000 });
  const listQ = useQuery({
    queryKey: ["ops-tasks", queue, filters, search, page],
    queryFn: () => opsTaskList({ ...filters, queue_scope: queue === "ALL" ? undefined : queue, search: search || undefined }, "-created_at", pageSize, page * pageSize),
    placeholderData: (prev = {}) => prev,
  });

  const claimMut = useMutation({ mutationFn: opsTaskClaim, onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops-tasks"] }); qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); toast({ title: "Task claimed" }); } });
  /** @param {{ task_ids: any[], bulk_action: string, payload: Record<string, unknown> }} request */
  const bulkTasks = (request) => opsTaskBulk(request);
  /** @param {{ filters: Record<string, unknown>, format: string }} request */
  const exportTasks = (request) => opsTaskExport(request.filters, request.format);
  const bulkMut = useMutation({ mutationFn: bulkTasks, onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["ops-tasks"] }); qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); toast({ title: `Bulk: ${r.applied} applied` }); setSelected(new Set()); } });
  const exportMut = useMutation({ mutationFn: exportTasks, onSuccess: (r) => { const blob = new Blob([r.format === "json" ? JSON.stringify(r.rows, null, 2) : r.csv], { type: r.format === "json" ? "application/json" : "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `operations-tasks.${r.format}`; a.click(); URL.revokeObjectURL(url); } });
  const backfillMut = useMutation({ mutationFn: () => opsTaskBackfill(5000), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["ops-tasks"] }); qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); toast({ title: `Backfill: ${r.tasks_created} tasks created from ${r.events} events` }); } });

  const m = dashQ.data?.metrics || {};
  const tasks = listQ.data?.tasks || [];
  const total = listQ.data?.total || 0;
  const summary = listQ.data?.summary || {};

  function toggle(id) { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); }
  function setFilter(k, v) { setFilters((f) => ({ ...f, [k]: v || undefined })); setPage(0); }
  function runBulk(action, payload = {}) { if (!selected.size) return; bulkMut.mutate({ task_ids: Array.from(selected), bulk_action: action, payload }); }

  return (
    <div>
      <PageHeader eyebrow="Phase 32 · Operations Queue" title="Operations Queue" description="Work-management layer over the application case engine. Tasks are generated deterministically from case events — this queue never owns application case state."
        action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => backfillMut.mutate()} disabled={backfillMut.isPending}><RefreshCw className="mr-2 h-4 w-4" />Backfill</Button><Button variant="outline" size="sm" onClick={() => exportMut.mutate({ filters, format: "csv" })} disabled={exportMut.isPending}><Download className="mr-2 h-4 w-4" />Export CSV</Button><Button variant="outline" size="sm" onClick={() => exportMut.mutate({ filters, format: "json" })} disabled={exportMut.isPending}>JSON</Button></div>} />

      <div className="px-5 py-5 sm:px-8 lg:px-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Open" value={m.open ?? "—"} />
          <Metric label="Unassigned" value={m.unassigned ?? "—"} tone="warn" />
          <Metric label="Due Today" value={m.due_today ?? "—"} tone="warn" />
          <Metric label="Overdue" value={m.overdue ?? "—"} tone="crit" />
          <Metric label="High Priority" value={m.high_priority ?? "—"} tone="warn" />
          <Metric label="Completed Today" value={m.completed_today ?? "—"} tone="ok" />
          <Metric label="Waiting" value={m.waiting ?? "—"} />
          <Metric label="Blocked" value={m.blocked ?? "—"} tone="crit" />
          <Metric label="Exceptions" value={m.exceptions ?? "—"} tone="crit" />
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {QUEUES.map((q) => (
            <button key={q} onClick={() => { setQueue(q); setPage(0); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${queue === q ? "bg-slate-950 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"}`}>{q.replace("_", " ")}</button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input className="w-56 pl-8" placeholder="Search task / case / assignee" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={filters.status || ""} onChange={(e) => setFilter("status", e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={filters.priority || ""} onChange={(e) => setFilter("priority", e.target.value)}><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={filters.unassigned ? "1" : ""} onChange={(e) => setFilter("unassigned", e.target.value ? true : undefined)}><option value="">Any assignee</option><option value="1">Unassigned</option></select>
          <label className="flex items-center gap-2 text-xs text-slate-600"><Checkbox checked={!!filters.overdue} onCheckedChange={(v) => setFilter("overdue", v ? true : undefined)} />Overdue only</label>
          <Button variant="ghost" size="sm" onClick={() => { setFilters({ ...EMPTY_FILTERS }); setSearch(""); setPage(0); }}>Clear</Button>
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 p-2">
            <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => runBulk("ASSIGN", { assignee: null })}>Assign to me</Button>
            <Button size="sm" variant="outline" onClick={() => runBulk("PRIORITY", { priority: "HIGH", reason: "bulk: high priority" })}>Set HIGH</Button>
            <select className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm" onChange={(e) => { if (e.target.value) runBulk("MOVE_QUEUE", { queue: e.target.value }); e.target.value = ""; }}><option value="">Move to queue…</option>{QUEUES.filter((q) => !["ALL", "MY_TASKS"].includes(q)).map((q) => <option key={q} value={q}>{q}</option>)}</select>
            <Button size="sm" variant="outline" onClick={() => runBulk("MARK_WAITING", { waiting_reason: "BULK_WAITING" })}>Mark waiting</Button>
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left"><Checkbox checked={tasks.length > 0 && tasks.every((t) => selected.has(t.id))} onCheckedChange={(v) => { const n = new Set(); if (v) tasks.forEach((t) => n.add(t.id)); setSelected(n); }} /></th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Task</th>
                <th className="px-3 py-2 text-left">Case</th>
                <th className="px-3 py-2 text-left">Dest</th>
                <th className="px-3 py-2 text-left">Queue</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Assigned</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-left">Age</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listQ.isLoading && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Loading tasks…</td></tr>}
              {!listQ.isLoading && tasks.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">No tasks in this queue.</td></tr>}
              {tasks.map((t) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${t.overdue ? "bg-red-50/40" : ""}`}>
                  <td className="px-3 py-2"><Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} /></td>
                  <td className="px-3 py-2"><span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ${priorityStyle[t.priority]}`}>{t.priority}</span></td>
                  <td className="px-3 py-2"><Link to={`/admin/tasks/${t.id}`} className="font-medium text-slate-900 hover:underline">{t.title}</Link><p className="text-xs text-slate-500">{t.task_type.replace(/_/g, " ")}</p></td>
                  <td className="px-3 py-2"><Link to={`/admin/cases/${t.case_id}`} className="font-mono text-xs text-slate-600 hover:underline">{String(t.case_id).slice(-8)}</Link>{t.destination && <span className="ml-1 text-xs text-slate-400">· {t.destination}</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{t.destination || "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{t.queue}</Badge></td>
                  <td className="px-3 py-2"><span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ${statusStyle[t.status]}`}>{t.status.replace("_", " ")}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{t.assigned_to ? String(t.assigned_to).slice(-6) : <span className="text-amber-700">Unassigned</span>}</td>
                  <td className="px-3 py-2 text-xs">{t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}{t.overdue && <span className="ml-1 text-red-600">↗</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{t.created_at ? Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000) + "h" : "—"}</td>
                  <td className="px-3 py-2 text-right">{t.status === "QUEUED" && <Button size="sm" variant="outline" onClick={() => claimMut.mutate(t.id)} disabled={claimMut.isPending}>Claim</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} tasks{summary?.open != null && ` · ${summary.open} open`}</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="py-1 text-xs">Page {page + 1}</span><Button size="sm" variant="outline" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
        </div>
      </div>
    </div>
  );
}