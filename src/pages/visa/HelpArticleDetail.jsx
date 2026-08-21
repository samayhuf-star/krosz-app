import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Loader2, BookOpen, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getArticlePublic, listArticlesPublic, categoryLabel } from '@/lib/helpApi';

export default function HelpArticleDetail() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    (async () => {
      try {
        const a = await getArticlePublic(slug);
        if (!active) return;
        if (a?.error || !a?.article) { setError(a?.error || 'Article not found'); return; }
        setArticle(a.article);
        const all = await listArticlesPublic(a.article.category);
        setRelated((all.articles || []).filter((x) => x.slug !== a.article.slug).slice(0, 4));
      } catch (e) { if (active) setError(e?.message || 'Could not load article.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [slug]);

  if (loading) return <div className="mx-auto max-w-3xl px-5 py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  if (error) return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-sm text-rose-700">{error}</p>
      <Link to="/help" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#006CEC] hover:underline"><ArrowLeft size={14} /> Back to Help Center</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="flex items-center gap-1.5 text-xs text-slate-400">
        <Link to="/help" className="hover:text-slate-700">Help Center</Link>
        <ChevronRight size={12} />
        <Link to={`/help?category=${article.category}`} className="hover:text-slate-700">{categoryLabel(article.category)}</Link>
        <ChevronRight size={12} />
        <span className="truncate text-slate-600">{article.title}</span>
      </nav>

      <article className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><BookOpen size={18} /></span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">{article.title}</h1>
        {article.summary && <p className="mt-2 text-base leading-7 text-slate-600">{article.summary}</p>}
        <div className="prose prose-slate mt-6 max-w-none text-sm leading-7 text-slate-700">
          <ReactMarkdown>{article.body || ''}</ReactMarkdown>
        </div>
        <p className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-400">This guide is general information, not legal or visa advice. Visa rules are set by the relevant government and can change.</p>
      </article>

      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">Related guides</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <Link key={r.id} to={`/help/${r.slug}`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-orange-200">
                <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}