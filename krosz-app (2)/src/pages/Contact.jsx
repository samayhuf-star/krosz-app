import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, ArrowRight, Twitter, Linkedin } from 'lucide-react';
import { useSeo } from '@/lib/seo';

export default function Contact() {
  useSeo({
    title: 'Contact Krosz — Visa support and questions',
    description: 'Reach the Krosz team for visa support, partnerships, or press. Email hello@krosz.com or use the contact form.',
    canonical_path: '/contact',
    robots: 'index,follow',
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent(`Krosz contact from ${name || 'a traveller'}`);
    const body = encodeURIComponent(`${message}\n\nFrom: ${name} <${email}>`);
    window.location.href = `mailto:hello@krosz.com?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-[#f8faf9] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="text-base font-semibold text-slate-900">Krosz</Link>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            Back to home <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-950">
          Contact us
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-700">
          Questions about a visa, a partnership, or press? Reach the Krosz team and we will respond within one business day.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Mail size={16} className="text-emerald-600" /> Email</p>
            <a href="mailto:hello@krosz.com" className="mt-2 block text-sm text-emerald-700 hover:underline">hello@krosz.com</a>

            <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-900"><MessageSquare size={16} className="text-emerald-600" /> In-app support</p>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">Signed-in travellers can open the Help Centre from any application workspace for live tracking and replies.</p>

            <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-900">Social</p>
            <div className="mt-2 flex items-center gap-4">
              <a href="https://twitter.com/krosz" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"><Twitter size={14} /> @krosz</a>
              <a href="https://www.linkedin.com/company/krosz" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"><Linkedin size={14} /> LinkedIn</a>
            </div>
          </div>

          <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </label>
            <button type="submit" className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
              Send message <ArrowRight size={16} />
            </button>
            {sent && <p className="text-xs text-emerald-700">Your email client should have opened with your message. If it didn’t, email us directly at hello@krosz.com.</p>}
          </form>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div><span className="font-bold text-slate-900">Krosz</span> · Visa guidance and application workspace</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link to="/about" className="hover:text-slate-900">About</Link>
            <Link to="/contact" className="hover:text-slate-900">Contact</Link>
            <span>© {new Date().getFullYear()} Krosz</span>
          </div>
        </div>
      </footer>
    </div>
  );
}