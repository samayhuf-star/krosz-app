import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, RefreshCw, Sparkles, Pause, Play, KeyRound, Trash2, Users, Mail, CheckCircle2 } from 'lucide-react';

export default function MailboxPanel({ data, businessId, onRefresh }) {
  const mailboxes = data?.mailboxes || [];
  const [recs, setRecs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // mailbox id being edited

  const recommend = useMutation({
    mutationFn: () => { setBusy(true); return commsApi.recommendMailboxes(businessId); },
    onSuccess: (r) => setRecs(r),
    onSettled: () => setBusy(false),
  });
  const approve = useMutation({
    mutationFn: (mailboxes) => { setBusy(true); return commsApi.approveMailboxes(businessId, mailboxes); },
    onSuccess: () => { setRecs(null); onRefresh(); },
    onSettled: () => setBusy(false),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div><CardTitle className="text-base flex items-center gap-2"><Sparkles size={16} /> AI Mailbox Recommendation</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Recommends a mailbox set grounded in your approved Business Blueprint. You approve, rename or delete before provisioning.</p>
          </div>
          <Button disabled={busy} onClick={() => recommend.mutate()}>{busy ? <Loader2 size={14} className="animate-spin mr-2" /> : <Sparkles size={14} className="mr-2" />}Recommend mailboxes</Button>
        </CardHeader>
        <CardContent>
          {!recs ? <p className="text-sm text-slate-500">No recommendations yet. Click “Recommend mailboxes” — the AI reads your business blueprint and proposes standard + industry-specific addresses.</p> : (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{recs.rationale}</div>
              <ul className="space-y-2">
                {(recs.mailboxes || []).map((m, i) => (
                  <li key={m.local_part + i} className="flex items-center justify-between rounded-xl border px-4 py-2.5">
                    <div><span className="font-mono font-medium text-slate-900">{m.local_part}@{data?.domainConfigs?.[0]?.domain_name || 'yourdomain'}</span> {m.is_primary ? <Badge className="ml-1 bg-emerald-600">Primary</Badge> : null}<p className="text-xs text-slate-500">{m.purpose}</p></div>
                    <Badge variant="outline" className="capitalize">{m.category}</Badge>
                  </li>
                ))}
              </ul>
              <Button className="w-full" disabled={busy} onClick={() => approve.mutate(recs.mailboxes)}><CheckCircle2 size={14} className="mr-2" /> Approve & provision all</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Mail size={16} /> Mailboxes ({mailboxes.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" /> New mailbox</Button>
        </CardHeader>
        <CardContent>
          {mailboxes.length === 0 ? <p className="text-sm text-slate-500">No mailboxes yet. Use the AI recommendation above or create one manually.</p> : (
            <div className="space-y-2">
              {mailboxes.map((m) => (
                <MailboxRow key={m.id} m={m} businessId={businessId} editing={editing === m.id} onEdit={() => setEditing(editing === m.id ? null : m.id)} onRefresh={onRefresh} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && <CreateMailboxModal businessId={businessId} domain={(data?.domainConfigs?.[0]?.domain_name) || ''} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onRefresh(); }} />}
    </div>
  );
}

function MailboxRow({ m, businessId, editing, onEdit, onRefresh }) {
  const [busy, setBusy] = useState('');
  const run = async (fn, key) => { try { setBusy(key); await fn(); onRefresh(); } finally { setBusy(''); } };
  const act = (key, fn) => run(fn, key);
  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Mail size={16} /></div>
          <div>
            <p className="font-medium text-slate-900">{m.email_address} {m.is_shared ? <Badge variant="outline" className="ml-1"><Users size={10} className="mr-1" />Shared</Badge> : null} {m.ai_recommended ? <Badge variant="outline" className="ml-1">AI</Badge> : null}</p>
            <p className="text-xs text-slate-500">{m.label} · {m.purpose} · {m.status} · {m.messages_count} msgs · {m.quota_mb - m.used_mb} MB free</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge className={m.sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : m.sync_status === 'error' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'} variant="secondary">{m.sync_status}</Badge>
          <Button size="sm" variant="ghost" disabled={busy === 'sync'} onClick={() => act('sync', () => commsApi.syncMailbox(m.id))}><RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} /></Button>
          {m.status === 'active'
            ? <Button size="sm" variant="ghost" disabled={busy === 'suspend'} onClick={() => act('suspend', () => commsApi.suspendMailbox(m.id, false))}><Pause size={14} /></Button>
            : <Button size="sm" variant="ghost" disabled={busy === 'resume'} onClick={() => act('resume', () => commsApi.suspendMailbox(m.id, true))}><Play size={14} /></Button>}
          <Button size="sm" variant="ghost" disabled={busy === 'pw'} onClick={() => act('pw', () => commsApi.resetMailboxPassword(m.id))}><KeyRound size={14} /></Button>
          <Button size="sm" variant="ghost" onClick={onEdit}><Plus size={14} /></Button>
          <Button size="sm" variant="ghost" disabled={busy === 'del'} onClick={() => { if (confirm(`Delete ${m.email_address}?`)) act('del', () => commsApi.deleteMailbox(m.id)); }}><Trash2 size={14} className="text-red-500" /></Button>
        </div>
      </div>
      {editing && <MailboxEditor m={m} onClose={onEdit} onSaved={() => { onEdit(); onRefresh(); }} />}
    </div>
  );
}

function MailboxEditor({ m, onClose, onSaved }) {
  const [aliases, setAliases] = useState((m.aliases || []).join(', '));
  const [forwarding, setForwarding] = useState((m.forwarding || []).join(', '));
  const [arEnabled, setArEnabled] = useState(!!m.auto_reply?.enabled);
  const [arSubject, setArSubject] = useState(m.auto_reply?.subject || '');
  const [arBody, setArBody] = useState(m.auto_reply?.body || '');
  const [catchAll, setCatchAll] = useState(!!m.has_catch_all);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await commsApi.updateMailbox(m.id, {
        aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean),
        forwarding: forwarding.split(',').map((s) => s.trim()).filter(Boolean),
        has_catch_all: catchAll,
        auto_reply: { enabled: arEnabled, subject: arSubject, body: arBody },
      });
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="border-t bg-slate-50/60 p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div><Label className="text-xs">Aliases (comma-separated)</Label><Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="info@, help@" /></div>
        <div><Label className="text-xs">Forwarding (comma-separated)</Label><Input value={forwarding} onChange={(e) => setForwarding(e.target.value)} placeholder="you@gmail.com" /></div>
      </div>
      <div className="flex items-center gap-2"><input type="checkbox" id={'ar' + m.id} checked={arEnabled} onChange={(e) => setArEnabled(e.target.checked)} /><Label htmlFor={'ar' + m.id} className="text-xs">Auto-reply enabled</Label></div>
      {arEnabled && <div className="space-y-2"><Input value={arSubject} onChange={(e) => setArSubject(e.target.value)} placeholder="Subject" /><Textarea rows={3} value={arBody} onChange={(e) => setArBody(e.target.value)} placeholder="Auto-reply body" /></div>}
      <div className="flex items-center gap-2"><input type="checkbox" id={'ca' + m.id} checked={catchAll} onChange={(e) => setCatchAll(e.target.checked)} /><Label htmlFor={'ca' + m.id} className="text-xs">Catch-all</Label></div>
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin mr-2" /> : null}Save</Button><Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button></div>
    </div>
  );
}

function CreateMailboxModal({ businessId, domain, onClose, onCreated }) {
  const [local, setLocal] = useState('');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { await commsApi.createMailbox(businessId, { local_part: local, label: label || local, purpose, is_shared: shared, industry: 'standard' }); onCreated(); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-3 font-semibold">Create mailbox</h3>
        <div className="space-y-3">
          <div><Label className="text-xs">Local part</Label><Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="info" /><p className="text-xs text-slate-400">→ {local || 'info'}@{domain}</p></div>
          <div><Label className="text-xs">Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Information" /></div>
          <div><Label className="text-xs">Purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="General inquiries" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Shared team inbox</label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !local} onClick={create}>{busy ? <Loader2 size={14} className="animate-spin" /> : 'Create'}</Button></div>
      </div>
    </div>
  );
}