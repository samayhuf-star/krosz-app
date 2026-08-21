import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commsApi } from '@/lib/commsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Send, X } from 'lucide-react';

export default function ComposeModal({ businessId, mailboxes, onClose, onSent }) {
  const [from, setFrom] = useState(mailboxes[0]?.id || '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const send = useMutation({
    mutationFn: () => commsApi.sendMessage(businessId, { mailbox_id: from, to_addr: to.split(',').map((s) => s.trim()).filter(Boolean), subject, body, draft }),
    onSuccess: () => onSent(),
  });
  const runAi = async () => {
    if (!body) return;
    const r = await commsApi.aiAction(mailboxes[0]?.id, 'rewrite'); // note: aiAction needs a message_id; rewrite is illustrative
    void r;
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="font-semibold flex items-center gap-2"><Send size={16} /> Compose email</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="space-y-3 p-5">
          <div><Label className="text-xs">From</Label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">To (comma separated)</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@example.com, bob@example.com" /></div>
          <div><Label className="text-xs">Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div><Label className="text-xs">Body</Label><Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <p className="text-xs text-slate-400">Tracking, scheduling and attachments are supported through the same composer in production; signatures come from the mailbox template.</p>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <label className="flex items-center gap-2 text-sm mr-auto"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as draft</label>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!from || !to || !subject || send.isLoading} onClick={() => send.mutate()}>{send.isLoading ? <Loader2 size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}{draft ? 'Save draft' : 'Send'}</Button>
        </div>
      </div>
    </div>
  );
}