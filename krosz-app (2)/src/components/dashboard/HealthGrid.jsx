import { Bot, Check, CircleDashed, Globe2, Mail, Search, Users } from 'lucide-react';

const items = [
  ['Domain', 'domain', Globe2], ['Website', 'website', Check], ['SEO', 'seo', Search],
  ['Email', 'email', Mail], ['CRM', 'crm', Users], ['Chatbot', 'chatbot', Bot],
];

export default function HealthGrid({ active = {} }) {
  return <section><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Business Health</h2><span className="text-sm text-slate-600">Launch readiness</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(([label,key,Icon]) => { const ready = active[key]; return <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={19}/></span>{ready ? <Check size={18} className="text-emerald-700"/> : <CircleDashed size={18} className="text-slate-400"/>}</div><p className="mt-5 font-medium">{label}</p><p className="mt-1 text-sm text-slate-600">{ready ? 'Ready' : 'Not configured'}</p></div>})}</div></section>;
}