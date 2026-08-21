import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { opsTaskDetail, opsTaskClaim, opsTaskRelease, opsTaskAction, opsTaskTransition, opsTaskPriority, opsExceptionResolve, opsTaskNoteCreate } from "@/lib/operationsTaskApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Clock, AlertTriangle, CheckCircle2, User, FileText, Send } from "lucide-react";
import PageHeader from "@/components/app/PageHeader";

const priorityStyle = { URGENT: "bg-red-100 text-red-800", HIGH: "bg-orange-100 text-orange-800", NORMAL: "bg-slate-100 text-slate-700", LOW: "bg-slate-50 text-slate-500" };
const statusStyle = { QUEUED: "bg-slate-100 text-slate-700", ASSIGNED: "bg-blue-100 text-blue-800", IN_PROGRESS: "bg-indigo-100 text-indigo-800", WAITING: "bg-amber-100 text-amber-800", BLOCKED: "bg-red-100 text-red-800", COMPLETED: "bg-orange-100 text-orange-800", CANCELLED: "bg-slate-100 text-slate-500" };

function Card({ title, children, icon: Icon }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5"><header className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-slate-400" /><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2></header>{children}</section>;
}
function Row({ k, v }) { return <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0"><dt className="text-sm text-slate-500">{k}</dt><dd className="text-sm font-medium text-slate-900 text-right">{v || "—"}</dd></div>; }

export default function OperationsTaskDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [waitingReason, setWaitingReason] = useState("");
  const [priority, setPriority] = useState("HIGH");

  const q = useQuery({ queryKey: ["ops-task-detail", id], queryFn: () => opsTaskDetail(id), enabled: !!id });
  const t = q.data?.task;
  const ctx = q.data?.case_context || {};
  const actions = q.data?.actions || [];
  const required = q.data?.required_resolution;

  function refresh() { qc.invalidateQueries({ queryKey: ["ops-task-detail", id] }); qc.invalidateQueries({ queryKey: ["ops-tasks"] }); qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }

  const claimMut = useMutation({ mutationFn: () => opsTaskClaim(id), onSuccess: () => { refresh(); toast({ title: "Task claimed" }); } });
  const releaseMut = useMutation({ mutationFn: () => opsTaskRelease(id), onSuccess: () => { refresh(); toast({ title: "Task released" }); } });
  const actMut = useMutation({ mutationFn: (code) => opsTaskAction({ id, action_code: code, reason }), onSuccess: (r) => { refresh(); toast({ title: `Action completed · ${r.decision}` }); }, onError: (e) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }) });
  /** @param {{ to: string, waiting_reason?: string, block_reason?: string, reason?: string }} transition */
  const transitionTask = (transition) => opsTaskTransition({ id, ...transition });
  const transMut = useMutation({ mutationFn: transitionTask, onSuccess: () => { refresh(); toast({ title: "Status updated" }); } });
  const prioMut = useMutation({ mutationFn: () => opsTaskPriority({ id, priority, reason }), onSuccess: () => { refresh(); toast({ title: "Priority set" }); } });
  const resolveExcMut = useMutation({ mutationFn: (eid) => opsExceptionResolve({ exception_id: eid, resolution: reason, status: "RESOLVED" }), onSuccess: () => { refresh(); toast({ title: "Exception resolved" }); } });
  const noteMut = useMutation({ mutationFn: () => opsTaskNoteCreate({ task_id: id, body: note }), onSuccess: () => { setNote(""); refresh(); toast({ title: "Note added" }); } });

  if (q.isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;
  if (!t) return <div className="px-5 py-10 text-center text-sm text-slate-500">Task not found. <Link to="/admin/tasks" className="text-orange-700 hover:underline">Back to queue</Link></div>;

  return (
    <div>
      <PageHeader
        eyebrow="Operations Task"
        title={t.title}
        description={`${t.task_type.replace(/_/g, " ")} · Queue ${t.queue} · ${t.id}`}
        action={<div className="flex items-center gap-2">
          <Link to="/admin/tasks" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft size={14} /> All tasks</Link>
          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${priorityStyle[t.priority]}`}>{t.priority}</span>
          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${statusStyle[t.status]}`}>{t.status.replace(/_/g, " ")}</span>
        </div>}
      />

      <div className="grid gap-4 px-5 py-6 sm:px-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Reason / Source" icon={FileText}>
            <p className="text-sm text-slate-700">{t.description || `Generated by rule: ${t.source_rule || "—"}`}</p>
            <div className="mt-3 grid grid-cols-2 gap-x-6">
              <Row k="Source rule" v={t.source_rule} /><Row k="Source event" v={t.source_event_id ? String(t.source_event_id).slice(-10) : "—"} />
              <Row k="Idempotency key" v={t.idempotency_key ? String(t.idempotency_key).slice(-20) : "—"} /><Row k="Automation class" v={t.automation_class} />
            </div>
          </Card>

          <Card title="Case Context (projection)" icon={User}>
            {ctx ? <div className="grid grid-cols-2 gap-x-6">
              <Row k="Case" v={<Link to={`/admin/cases/${ctx.case_id}`} className="font-mono text-xs hover:underline">{String(ctx.case_id || "").slice(-8)}</Link>} />
              <Row k="Destination" v={ctx.destination} /><Row k="Journey" v={ctx.journey} /><Row k="Nationality" v={ctx.nationality} />
              <Row k="Case state" v={(ctx.case_state || "").replace(/_/g, " ")} /><Row k="Execution capability" v={ctx.execution_capability} />
              <Row k="Provider" v={ctx.provider_key} /><Row k="Travel date" v={ctx.travel_date ? new Date(ctx.travel_date).toLocaleDateString() : "—"} />
              <Row k="Paid" v={ctx.paid_at ? "Yes" : "No"} /><Row k="Snapshot version" v={ctx.case_snapshot_version} />
            </div> : <p className="text-sm text-slate-400">No case context available.</p>}
            <p className="mt-3 text-xs text-slate-400">Case context is projected read-only from the case — this task does not own case state.</p>
          </Card>

          <Card title="SLA (Operational)" icon={Clock}>
            <div className="grid grid-cols-2 gap-x-6">
              <Row k="Due" v={t.due_at ? new Date(t.due_at).toLocaleString() : "—"} /><Row k="SLA policy" v={t.sla_policy?.label || "—"} />
              <Row k="Created" v={t.created_at ? new Date(t.created_at).toLocaleString() : "—"} /><Row k="Overdue" v={typeof t.overdue === "boolean" ? (t.overdue ? "Yes" : "No") : "—"} />
            </div>
            <p className="mt-2 text-xs text-slate-400">Operational SLA only — never a government visa processing guarantee.</p>
          </Card>

          <Card title="Timeline / Audit" icon={FileText}>
            <ol className="space-y-2">
              {(q.data?.audit || []).slice(0, 15).map((a, i) => (
                <li key={i} className="flex gap-3 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" /><div><p className="font-medium text-slate-800">{a.action.replace(/_/g, " ")} <span className="text-xs text-slate-400">· {a.actor_id || "system"}</span></p>{a.reason && <p className="text-xs text-slate-500">{a.reason}</p>}<p className="text-xs text-slate-400">{a.occurred_at ? new Date(a.occurred_at).toLocaleString() : ""}</p></div></li>
              ))}
              {(q.data?.audit || []).length === 0 && <li className="text-sm text-slate-400">No audit events yet.</li>}
            </ol>
          </Card>

          {t.exception_id && (q.data?.exceptions || []).length > 0 && (
            <Card title="Exceptions" icon={AlertTriangle}>
              {(q.data?.exceptions || []).map((e) => (
                <div key={e.id} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-amber-900">{e.type.replace(/_/g, " ")} · {e.severity}</span><Badge variant="outline">{e.status}</Badge></div><p className="mt-1 text-sm text-amber-800">{e.message}</p>{e.status !== "RESOLVED" && <Button size="sm" variant="outline" className="mt-2" onClick={() => resolveExcMut.mutate(e.id)} disabled={resolveExcMut.isPending}>Resolve</Button>}</div>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Actions" icon={CheckCircle2}>
            <p className="mb-2 text-xs text-slate-500">{required ? `Resolution required: ${required.join(", ")}` : "Generic resolution allowed"}</p>
            <div className="space-y-2">
              {actions.map((code) => (
                <Button key={code} className="w-full justify-start" disabled={actMut.isPending} onClick={() => actMut.mutate(code)}>
                  {code.replace(/_/g, " ")}
                </Button>
              ))}
              {actions.length === 0 && <p className="text-sm text-slate-400">No actions for this task type.</p>}
            </div>
            <Textarea className="mt-2" placeholder="Reason / notes for the action…" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <p className="mt-2 text-xs text-slate-400">Decision actions drive the Case Engine — the case state change is validated server-side and a CaseEvent is persisted.</p>
          </Card>

          <Card title="Assignment" icon={User}>
            <div className="space-y-2">
              <Row k="Assigned to" v={t.assigned_to ? String(t.assigned_to).slice(-8) : "Unassigned"} /><Row k="Team" v={t.assigned_team} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" disabled={t.status === "COMPLETED" || claimMut.isPending} onClick={() => claimMut.mutate()}>Claim</Button>
              <Button size="sm" variant="outline" className="flex-1" disabled={t.status === "QUEUED" || releaseMut.isPending} onClick={() => releaseMut.mutate()}>Release</Button>
            </div>
          </Card>

          <Card title="Status" icon={Clock}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={t.status !== "ASSIGNED" && t.status !== "QUEUED" || transMut.isPending} onClick={() => transMut.mutate({ to: "IN_PROGRESS" })}>Start</Button>
              <Button size="sm" variant="outline" disabled={t.status === "WAITING" || transMut.isPending} onClick={() => { if (waitingReason) transMut.mutate({ to: "WAITING", waiting_reason: waitingReason }); }}>Waiting</Button>
              <Button size="sm" variant="outline" disabled={t.status === "BLOCKED" || transMut.isPending} onClick={() => transMut.mutate({ to: "BLOCKED", block_reason: "Operator flagged" })}>Blocked</Button>
              <Button size="sm" variant="outline" disabled={transMut.isPending} onClick={() => transMut.mutate({ to: "CANCELLED", reason: "Cancelled by operator" })}>Cancel</Button>
            </div>
            <Input className="mt-2" placeholder="Waiting reason…" value={waitingReason} onChange={(e) => setWaitingReason(e.target.value)} />
          </Card>

          <Card title="Priority" icon={AlertTriangle}>
            <div className="flex gap-2">
              <select className="h-9 flex-1 rounded-md border border-slate-200 px-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}><option>HIGH</option><option>URGENT</option><option>NORMAL</option><option>LOW</option></select>
              <Button size="sm" disabled={prioMut.isPending} onClick={() => prioMut.mutate()}>Set</Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Overrides require a reason + actor and are audited. URGENT cannot be lowered.</p>
          </Card>

          <Card title="Internal Notes" icon={FileText}>
            <div className="space-y-2">
              {(q.data?.notes || []).map((n) => <div key={n.id} className="rounded-lg bg-slate-50 p-2 text-sm"><p className="font-medium text-slate-700">{n.author_name}</p><p className="text-slate-600">{n.body}</p><p className="text-xs text-slate-400">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</p></div>)}
              {(q.data?.notes || []).length === 0 && <p className="text-sm text-slate-400">No notes.</p>}
            </div>
            <Textarea className="mt-2" placeholder="Add an internal note (operators only)…" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            <Button size="sm" variant="outline" className="mt-2" disabled={!note || noteMut.isPending} onClick={() => noteMut.mutate()}><Send className="mr-1 h-3 w-3" />Add note</Button>
          </Card>

          {t.resolution && <Card title="Resolution" icon={CheckCircle2}><Row k="Decision" v={t.resolution.decision} /><Row k="Reason" v={t.resolution.reason} /><Row k="By" v={t.resolution.by} /><Row k="At" v={t.resolution.at ? new Date(t.resolution.at).toLocaleString() : "—"} /></Card>}
        </div>
      </div>
    </div>
  );
}