import { useEffect, useState } from 'react';
import { Save, Loader2, Plus, FileText } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { publishListContent, publishSaveContent } from '@/lib/visaApi';
import { useToast } from '@/components/ui/use-toast';

const STATUS = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

export default function DestinationContentAdmin() {
  const { toast } = useToast();
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const load = () => publishListContent().then((r) => setRows(r.content || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const edit = (row) => { setSelected(row); setDraft(toDraft(row)); setIsNew(false); };
  const fresh = () => { setSelected(null); setDraft(toDraft({ country_code: '', slug: '', status: 'DRAFT', language: 'en' })); setIsNew(true); };

  function toDraft(row) {
    return {
      country_code: row.country_code || '',
      slug: row.slug || '',
      language: row.language || 'en',
      status: row.status || 'DRAFT',
      intro: row.intro || '',
      overview: row.overview || '',
      visa_summary: row.visa_summary || '',
      travel_notes: row.travel_notes || '',
      important_notes: Array.isArray(row.important_notes) ? row.important_notes.join('\n') : '',
      how_it_works: JSON.stringify(row.how_it_works || [], null, 2),
      faq: JSON.stringify(row.faq || [], null, 2),
      related_destinations: Array.isArray(row.related_destinations) ? row.related_destinations.join(', ') : '',
      seo: JSON.stringify(row.seo || {}, null, 2),
      content_quality_score: row.content_quality_score || 0,
    };
  }

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.country_code) { toast({ title: 'Country code required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const payload = {
        country_code: draft.country_code.toUpperCase(),
        slug: draft.slug,
        language: draft.language,
        status: draft.status,
        intro: draft.intro,
        overview: draft.overview,
        visa_summary: draft.visa_summary,
        travel_notes: draft.travel_notes,
        important_notes: draft.important_notes.split('\n').map((s) => s.trim()).filter(Boolean),
        how_it_works: JSON.parse(draft.how_it_works || '[]'),
        faq: JSON.parse(draft.faq || '[]'),
        related_destinations: draft.related_destinations.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
        seo: JSON.parse(draft.seo || '{}'),
        content_quality_score: Number(draft.content_quality_score) || 0,
      };
      await publishSaveContent(payload);
      toast({ title: 'Saved', description: `${payload.country_code} content saved.` });
      setIsNew(false);
      load();
    } catch (e) {
      toast({ title: 'Save failed', description: e?.message || 'Check JSON fields (how_it_works / faq / seo).', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Phase 21" title="Destination Content" description="Editorial + SEO content overlay. Regulatory data (visa rules, fees, requirements) is NOT edited here — it lives in Visa Intelligence." />
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* List */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <button onClick={fresh} className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"><Plus size={15} /> New content</button>
            {rows === null && <div className="h-20 animate-pulse rounded bg-slate-100" />}
            {rows && rows.map((r) => (
              <button key={r.id || r.country_code} onClick={() => edit(r)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected?.id === r.id ? 'bg-orange-50 text-orange-800' : 'hover:bg-slate-50 text-slate-700'}`}>
                <FileText size={14} className="shrink-0 text-slate-400" />
                <span className="flex-1 truncate">{r.country_code} · {r.slug}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.status === 'PUBLISHED' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            {!draft && <p className="py-16 text-center text-sm text-slate-400">Select a content row or create new.</p>}
            {draft && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">{isNew ? 'New destination content' : `Edit ${draft.country_code}`}</h2>
                  <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={15} />} Save</button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Country code"><input value={draft.country_code} disabled={!isNew} onChange={(e) => set('country_code', e.target.value)} className="input" /></Field>
                  <Field label="Slug"><input value={draft.slug} onChange={(e) => set('slug', e.target.value)} className="input" placeholder="united-states" /></Field>
                  <Field label="Language"><input value={draft.language} onChange={(e) => set('language', e.target.value)} className="input" /></Field>
                  <Field label="Status"><select value={draft.status} onChange={(e) => set('status', e.target.value)} className="input">{STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
                </div>
                <Field label="Intro"><textarea value={draft.intro} onChange={(e) => set('intro', e.target.value)} rows={2} className="input" /></Field>
                <Field label="Overview"><textarea value={draft.overview} onChange={(e) => set('overview', e.target.value)} rows={3} className="input" /></Field>
                <Field label="Visa summary (editorial)"><textarea value={draft.visa_summary} onChange={(e) => set('visa_summary', e.target.value)} rows={2} className="input" /></Field>
                <Field label="Travel notes"><textarea value={draft.travel_notes} onChange={(e) => set('travel_notes', e.target.value)} rows={2} className="input" /></Field>
                <Field label="Important notes (one per line)"><textarea value={draft.important_notes} onChange={(e) => set('important_notes', e.target.value)} rows={3} className="input" /></Field>
                <Field label="How it works (JSON array)"><textarea value={draft.how_it_works} onChange={(e) => set('how_it_works', e.target.value)} rows={4} className="font-mono input text-xs" /></Field>
                <Field label="FAQ (JSON [{question, answer}])"><textarea value={draft.faq} onChange={(e) => set('faq', e.target.value)} rows={4} className="font-mono input text-xs" /></Field>
                <Field label="Related destinations (comma-separated codes)"><input value={draft.related_destinations} onChange={(e) => set('related_destinations', e.target.value)} className="input" placeholder="TH, VN, SG" /></Field>
                <Field label="SEO (JSON {title, description, canonical_path, og_title, og_description, image_url, robots})"><textarea value={draft.seo} onChange={(e) => set('seo', e.target.value)} rows={5} className="font-mono input text-xs" /></Field>
                <Field label="Content quality score (0-100)"><input type="number" value={draft.content_quality_score} onChange={(e) => set('content_quality_score', e.target.value)} className="input" /></Field>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`.input{width:100%;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none}.input:focus{border-color:#10b981}`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}