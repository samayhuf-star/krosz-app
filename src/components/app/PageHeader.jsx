export default function PageHeader({ eyebrow = "", title, description = "", subtitle = "", action = null }) {
  const supportingText = description || subtitle;
  return <header className="flex flex-col gap-5 border-b border-slate-200 bg-white px-5 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-10">
    <div className="max-w-3xl"><p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{eyebrow}</p><h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>{supportingText && <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{supportingText}</p>}</div>{action}
  </header>;
}