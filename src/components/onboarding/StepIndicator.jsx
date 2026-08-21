const labels = ['Business','Market','Launch brief'];
export default function StepIndicator({ step }) {
  return <div className="grid grid-cols-3 gap-2">{labels.map((label,index) => <div key={label}><div className={`h-1.5 rounded-full ${index <= step ? 'bg-emerald-700' : 'bg-slate-200'}`}/><p className={`mt-2 text-xs font-medium ${index === step ? 'text-slate-950' : 'text-slate-500'}`}>{index + 1}. {label}</p></div>)}</div>;
}