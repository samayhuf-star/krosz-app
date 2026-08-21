import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, Zap } from 'lucide-react';

const TRIGGERS = ['has_invoice', 'has_complaint', 'has_lead', 'vip_customer', 'subject_contains', 'category_is', 'importance_is'];
const TARGETS = [
  { value: 'crm', label: 'CRM (lead/opportunity)' },
  { value: 'support', label: 'Support (ticket)' },
  { value: 'finance', label: 'Finance (billing)' },
  { value: 'hr', label: 'HR (careers)' },
  { value: 'calendar', label: 'Calendar (appointment)' },
  { value: 'kg', label: 'Knowledge Graph' },
  { value: 'none', label: 'No routing' },
];

export default function AutomationsPanel({ data, businessId, onRefresh }) {
  const rules = data?.automations || [];
  const [show, setShow] = useState(false);
  const toggle = useMutation({ mutationFn: ({ id, enabled }) => commsApi.updateAutomation(id, { enabled }), onSuccess: onRefresh });
  const del = useMutation({ mutationFn: (id) => commsApi.deleteAutomation(id), onSuccess: onRefresh });

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div><CardTitle className="text-base flex items-center gap-2"><Zap size={16} /> Inbound Routing Automations</CardTitle><p className="text-xs text-slate-500 mt-1">Invoice→Finance · Complaint→Support · Lead→CRM · Appointment→Calendar · VIP→Priority.</p></div>
        <Button size="sm" onClick={() => setShow(true)}><Plus size={14} className="mr-1" /> New rule</Button>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? <p className="text-sm text-slate-500">No automation rules yet.</p> : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="rounded-xl border px-4 py-3">
                <div className="flex items-center justify-between">
                  <div><p className="font-medium text-slate-900">{r.name} <Badge variant="outline" className="ml-1 capitalize">{r.trigger}</Badge> {r.enabled ? <Badge className="ml-1 bg-emerald-600">on</Badge> : <Badge variant="secondary" className="ml-1">off</Badge>}</p><p className="text-xs text-slate-500">→ {r.action_target_module} · priority {r.priority}</p></div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs"><input type="checkbox" checked={r.enabled} onChange={(e) => toggle.mutate({ id: r.id, enabled: e.target.checked })} /> enabled</label>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 size={14} className="text-red-500" /></Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">{(r.actions || []).map((a, i) => <Badge key={i} variant="outline" className="text-[10px] capitalize">{a.type}{a.value ? `: ${a.value}` : ''}</Badge>)}</div>
              </div>
            ))}
          </div>
        )}
        {show && <RuleForm businessId={businessId} onClose={() => setShow(false)} onSaved={() => { setShow(false); onRefresh(); }} />}
      </CardContent>
    </Card>
  );
}

function RuleForm({ businessId, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('has_invoice');
  const [target, setTarget] = useState('finance');
  const [label, setLabel] = useState('');
  const [priority, setPriority] = useState(80);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await commsApi.saveAutomation(businessId, {
        name, trigger, action_target_module: target, priority: Number(priority),
        conditions: [], mailbox_scope: [],
        actions: [{ type: 'label', value: label || target }, { type: 'set_category', value: target }, { type: 'route_to_module', module: target }],
      });
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-3 font-semibold">New routing rule</h3>
        <div className="space-y-3">
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoice → Finance" /></div>
          <div><Label className="text-xs">Trigger</Label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm">{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div><Label className="text-xs">Route to</Label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm">{TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="finance" /></div>
            <div><Label className="text-xs">Priority</Label><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !name} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}Save</Button></div>
      </div>
    </div>
  );
}