export default function Field({ label, id, as = 'input', required, ...props }) {
  const Component = as;
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium text-slate-800">{label}{required && <span className="text-rose-700"> *</span>}</label><Component id={id} required={required} {...props} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 shadow-sm outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"/></div>;
}