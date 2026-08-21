import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Pencil, X, Loader2, BookOpen, HelpCircle } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { HelpArticle, HelpFaq, HELP_CATEGORIES, categoryLabel } from '@/lib/helpApi';

const blankArticle = () => ({ category: 'getting-started', slug: '', title: '', summary: '', body: '', icon: '', order: 100, status: 'published' });
const blankFaq = () => ({ category: 'getting-started', question: '', answer: '', keywords: [], order: 100, status: 'published' });

export default function HelpContentAdmin() {
  const [tab, setTab] = useState('articles');
  return (
    <div>
      <PageHeader eyebrow="Help Center" title="Help content" description="Manage the guide articles and FAQs shown to travelers in the Help Center. Changes go live immediately." />
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8">
        <div className="mb-5 inline-flex rounded-full border border-slate-200 bg-white p-1">
          {[
            { k: 'articles', label: 'Articles', icon: BookOpen },
            { k: 'faqs', label: 'FAQs', icon: HelpCircle },
          ].map(({ k, label, icon: Icon }) => (
            <button key={k} onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === 'articles' ? <ArticlesManager /> : <FaqsManager />}
      </div>
    </div>
  );
}

function ArticlesManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = async () => { setLoading(true); try { setItems(await HelpArticle.list('order', 200)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const save = async (row) => {
    if (!row.title?.trim() || !row.slug?.trim()) return;
    if (row.id) await HelpArticle.update(row.id, row);
    else await HelpArticle.create(row);
    setEditing(null); load();
  };
  const remove = async (id) => { if (confirm('Delete this article?')) { await HelpArticle.delete(id); load(); } };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">{items.length} article{items.length === 1 ? '' : 's'}</p>
        <button onClick={() => setEditing(blankArticle())} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"><Plus size={15} /> New article</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {items.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{a.title}</p>
              <p className="text-xs text-slate-500">{categoryLabel(a.category)} · /{a.slug} · {a.status === 'draft' ? 'Draft' : 'Published'}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(a)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-50"><Pencil size={15} /></button>
              <button onClick={() => remove(a.id)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="p-6 text-sm text-slate-500">No articles yet.</p>}
      </div>
      {editing && <ArticleEditor initial={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function ArticleEditor({ initial, onCancel, onSave }) {
  const [row, setRow] = useState(initial);
  const [busy, setBusy] = useState(false);
  const upd = (p) => setRow({ ...row, ...p });
  const submit = async () => { setBusy(true); try { await onSave(row); } finally { setBusy(false); } };
  return (
    <Modal title={initial.id ? 'Edit article' : 'New article'} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="Title"><input className={inp} value={row.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug"><input className={inp} value={row.slug} onChange={(e) => upd({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="e.g. passport-upload-guide" /></Field>
          <Field label="Category">
            <select className={inp} value={row.category} onChange={(e) => upd({ category: e.target.value })}>
              {HELP_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Summary"><input className={inp} value={row.summary} onChange={(e) => upd({ summary: e.target.value })} /></Field>
        <Field label="Icon (lucide name, optional)"><input className={inp} value={row.icon} onChange={(e) => upd({ icon: e.target.value })} placeholder="Plane" /></Field>
        <Field label="Body (markdown)"><textarea rows={8} className={inp} value={row.body} onChange={(e) => upd({ body: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order"><input type="number" className={inp} value={row.order} onChange={(e) => upd({ order: Number(e.target.value) })} /></Field>
          <Field label="Status">
            <select className={inp} value={row.status} onChange={(e) => upd({ status: e.target.value })}>
              <option value="published">Published</option><option value="draft">Draft</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</button>
        </div>
      </div>
    </Modal>
  );
}

function FaqsManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const load = async () => { setLoading(true); try { setItems(await HelpFaq.list('order', 400)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const save = async (row) => {
    if (!row.question?.trim() || !row.answer?.trim()) return;
    const payload = { ...row, keywords: Array.isArray(row.keywords) ? row.keywords : String(row.keywords || '').split(',').map((s) => s.trim()).filter(Boolean) };
    if (row.id) await HelpFaq.update(row.id, payload);
    else await HelpFaq.create(payload);
    setEditing(null); load();
  };
  const remove = async (id) => { if (confirm('Delete this FAQ?')) { await HelpFaq.delete(id); load(); } };
  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">{items.length} FAQ{items.length === 1 ? '' : 's'}</p>
        <button onClick={() => setEditing(blankFaq())} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"><Plus size={15} /> New FAQ</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {items.map((f) => (
          <div key={f.id} className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{f.question}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{f.answer}</p>
              <p className="mt-1 text-[11px] text-slate-400">{categoryLabel(f.category)} · {f.status === 'draft' ? 'Draft' : 'Published'}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(f)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-50"><Pencil size={15} /></button>
              <button onClick={() => remove(f.id)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="p-6 text-sm text-slate-500">No FAQs yet.</p>}
      </div>
      {editing && <FaqEditor initial={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function FaqEditor({ initial, onCancel, onSave }) {
  const [row, setRow] = useState({ ...initial, keywords: Array.isArray(initial.keywords) ? initial.keywords.join(', ') : (initial.keywords || '') });
  const [busy, setBusy] = useState(false);
  const upd = (p) => setRow({ ...row, ...p });
  const submit = async () => { setBusy(true); try { await onSave(row); } finally { setBusy(false); } };
  return (
    <Modal title={initial.id ? 'Edit FAQ' : 'New FAQ'} onClose={onCancel}>
      <div className="space-y-3">
        <Field label="Question"><input className={inp} value={row.question} onChange={(e) => upd({ question: e.target.value })} /></Field>
        <Field label="Answer"><textarea rows={4} className={inp} value={row.answer} onChange={(e) => upd({ answer: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inp} value={row.category} onChange={(e) => upd({ category: e.target.value })}>
              {HELP_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Order"><input type="number" className={inp} value={row.order} onChange={(e) => upd({ order: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Extra search keywords (comma separated)"><input className={inp} value={row.keywords} onChange={(e) => upd({ keywords: e.target.value })} /></Field>
        <Field label="Status">
          <select className={inp} value={row.status} onChange={(e) => upd({ status: e.target.value })}>
            <option value="published">Published</option><option value="draft">Draft</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</button>
        </div>
      </div>
    </Modal>
  );
}

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400';
function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>; }
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-semibold text-slate-950">{title}</h3><button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}