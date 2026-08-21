export default function HealthRing({ score = 0, size = 150, label = 'Business Health' }) {
  const s = Math.max(0, Math.min(100, score));
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (s / 100) * c;
  const color = s >= 80 ? '#059669' : s >= 50 ? '#d97706' : s >= 1 ? '#dc2626' : '#cbd5e1';
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-700 ease-out" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold tabular-nums" style={{ color }}>{s}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">/ 100</span>
        </div>
      </div>
      {label && <p className="mt-2 text-sm font-medium text-slate-600">{label}</p>}
    </div>
  );
}