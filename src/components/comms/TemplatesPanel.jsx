import React, { useState } from 'react';
import { commsApi } from '@/lib/commsApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, FileText } from 'lucide-react';

export default function TemplatesPanel({ data, businessId, onRefresh }) {
  const templates = data?.templates || [];
  const [show, setShow] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div><CardTitle className="text-base flex items-center gap-2"><FileText size={16} /> Email Templates</CardTitle><p className="text-xs text-slate-500 mt-1">Versioned — edits create a new version; the latest published is live.</p></div>
        <Button size="sm" onClick={() => setShow(true)}><Plus size={14} className="mr-1" /> New template</Button>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? <p className="text-sm text-slate-500">No templates yet.</p> : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border px-4 py-3">
                <div><p className="font-medium text-slate-900">{t.name} <Badge variant="outline" className="ml-1 capitalize">{t.category}</Badge> <Badge variant="secondary" className="ml-1">v{t.version}</Badge></p><p className="text-xs text-slate-500">{t.subject}</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{t.usage_count} uses</Badge><Button size="sm" variant="ghost" disabled={t.is_system} onClick={async () => { await commsApi.deleteTemplate(t.id); onRefresh(); }}><Trash2 size={14} className="text-red-500" /></Button></div>
              </div>
            ))}
          </div>
        )}
        {show && <TemplateForm businessId={businessId} onClose={() => setShow(false)} onSaved={() => { setShow(false); onRefresh(); }} />}
      </CardContent>
    </Card>
  );
}

function TemplateForm({ businessId, onClose, onSaved }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await commsApi.saveTemplate(businessId, { key, name, subject, body, category }); onSaved(); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="mb-3 font-semibold">New template</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Key</Label><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="email.welcome" /></div>
            <div><Label className="text-xs">Category</Label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm">
                {['general', 'sales', 'support', 'finance', 'marketing', 'hr', 'onboarding', 'faq'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New Member Welcome" /></div>
          <div><Label className="text-xs">Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Welcome to {{business_name}}!" /></div>
          <div><Label className="text-xs">Body (supports {'{{merge_vars}}'})</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !key || !name || !subject} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin mr-2" /> : null}Save</Button></div>
      </div>
    </div>
  );
}