
// Traveler switcher (§42) — makes it extremely clear whose documents /
// applications / profile are being viewed. Prevents wrong-traveler mistakes.
export default function TravelerSwitcher({ travelers, selectedId, onSelect, compact = false }) {
  const selected = travelers.find((t) => t.id === selectedId) || travelers[0];
  if (!travelers.length) return null;
  return (
    <div className="inline-flex items-center gap-2">
      <div className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="font-medium text-slate-900">{selected ? `${selected.first_name} ${selected.last_name || ''}`.trim() : 'Select traveler'}</span>
        {selected?.is_primary && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">Primary</span>}
      </div>
      <select value={selectedId || ''} onChange={(e) => onSelect(e.target.value)} className={`rounded-lg border border-slate-200 bg-white ${compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'}`}>
        {travelers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name || ''} ({t.relationship || 'SELF'}){t.is_primary ? ' ★' : ''}</option>)}
      </select>
    </div>
  );
}