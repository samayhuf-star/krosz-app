import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, MessageCircle, Search, Loader2, Plane, FileText, ShieldCheck, CreditCard, LifeBuoy, Bell, UserRound, Map } from 'lucide-react';
import AskAIPanel from '@/components/visa/AskAIPanel';
import { listArticlesPublic, listFaqsPublic, searchHelpPublic, HELP_CATEGORIES, categoryLabel } from '@/lib/helpApi';

const ICON_MAP = { Plane, FileText, ShieldCheck, CreditCard, LifeBuoy, BookOpen, Bell, User: UserRound, Map };
function GuideIcon({ name }) {
  const Icon = ICON_MAP[name] || BookOpen;
  return <Icon size={18} />;
}

export default function HelpCenter() {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('all');
  const [openFaq, setOpenFaq] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [articles, setArticles] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = async (cat) => {
    setLoading(true); setError('');
    try {
      const [a, f] = await Promise.all([
        cat === 'all' ? listArticlesPublic() : listArticlesPublic(cat),
        cat === 'all' ? listFaqsPublic() : listFaqsPublic(cat),
      ]);
      setArticles(a.articles || []); setFaqs(f.faqs || []);
    } catch (e) { setError(e?.message || 'Could not load help content.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(activeCat); }, [activeCat]);

  const q = query.trim().toLowerCase();
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!q) { setSearchResults(null); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchHelpPublic(q);
        if (!cancelled) setSearchResults(r);
      } catch (e) { if (!cancelled) setSearchResults({ articles: [], faqs: [] }); }
      finally { if (!cancelled) setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const shownFaqs = searchResults ? searchResults.faqs : faqs;
  const shownArticles = searchResults ? searchResults.articles : articles;

  return (
    <div className="mx-auto max-w-5xl">
      <section className="rounded-[28px] border border-orange-100 bg-gradient-to-br from-orange-50 to-white px-5 py-8 sm:px-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-orange-700"><BookOpen size={17} /> Krosz Help Center</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">How can we help?</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Search our guides and FAQs, or ask the Krosz AI assistant. If it cannot answer confidently, your question is escalated to our support team instead of being guessed.</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
            <Search size={17} className="text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 w-full bg-transparent text-sm outline-none" placeholder="Search help, documents, payments, refunds…" />
            {searching && <Loader2 size={16} className="animate-spin text-slate-400" />}
          </label>
          <button onClick={() => setChatOpen(true)} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-700"><MessageCircle size={17} /> Ask Krosz AI</button>
        </div>
      </section>

      {!q && (
        <div className="mt-7 flex flex-wrap gap-2">
          {[{ key: 'all', label: 'All' }, ...HELP_CATEGORIES].map((c) => (
            <button key={c.key} onClick={() => setActiveCat(c.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${activeCat === c.key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="mt-10 flex items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
      {error && <p className="mt-8 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {!loading && !error && (
        <>
          {!q && (
            <section className="mt-7">
              <h2 className="text-lg font-bold text-slate-950">Guides</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {shownArticles.map((a) => (
                  <article key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><GuideIcon name={a.icon} /></span>
                    <h3 className="mt-3 text-sm font-semibold text-slate-900">{a.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-500">{a.summary}</p>
                    <p className="mt-2 text-[11px] text-slate-400">{categoryLabel(a.category)}</p>
                  </article>
                ))}
                {shownArticles.length === 0 && <p className="text-sm text-slate-500">No guides in this category yet.</p>}
              </div>
            </section>
          )}

          <section className={q ? 'mt-7' : 'mt-9'}>
            <h2 className="text-lg font-bold text-slate-950">{q ? `Results for “${query}”` : 'Frequently asked questions'}</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {shownFaqs.map((f, i) => (
                <div key={f.id} className="border-b border-slate-100 last:border-0">
                  <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-slate-900">
                    <span>{f.question}</span><ChevronDown size={17} className={`shrink-0 transition ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && <p className="px-5 pb-5 text-sm leading-6 text-slate-600">{f.answer}</p>}
                </div>
              ))}
              {shownFaqs.length === 0 && shownArticles.length === 0 && (
                <div className="p-6 text-sm text-slate-500">No matching article. Ask Krosz AI and it will escalate the question if it cannot answer confidently.</div>
              )}
            </div>
          </section>
        </>
      )}

      <section className="my-9 flex flex-col items-start justify-between gap-4 rounded-2xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold">Still need help?</h2>
          <p className="mt-1 text-sm text-slate-300">Ask the AI assistant first. Unresolved questions become support tickets for the admin team.</p>
        </div>
        <button onClick={() => setChatOpen(true)} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950">Start AI chat</button>
      </section>
      <AskAIPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}