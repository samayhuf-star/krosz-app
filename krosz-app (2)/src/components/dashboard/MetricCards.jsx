const cards = [
  ['New leads','leads'],['AI conversations','conversations'],['Open tickets','tickets'],['Published pages','pages']
];
export default function MetricCards({ metrics }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,key]) => <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{metrics[key] || 0}</p><p className="mt-1 text-xs text-slate-500">Current tenant</p></div>)}</div>;
}