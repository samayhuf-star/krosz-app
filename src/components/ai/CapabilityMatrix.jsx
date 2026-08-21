const CAPS = [
  { key: 'chat', label: 'Chat' },
  { key: 'streaming', label: 'Stream' },
  { key: 'vision', label: 'Vision' },
  { key: 'function_calling', label: 'Tools' },
  { key: 'embeddings', label: 'Embed' },
];

export default function CapabilityMatrix({ providers = [], adapters = [] }) {
  const byKey = Object.fromEntries(adapters.map((a) => [a.key, a]));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b bg-slate-50 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Capability matrix</h2>
        <p className="text-xs text-slate-600">Which AI provider can serve which operation. The runtime routes requests using this matrix — no hardcoded model lists.</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-semibold">Provider</th>
            {CAPS.map((c) => (
              <th key={c.key} className="px-3 py-3 text-center font-semibold">{c.label}</th>
            ))}
            <th className="px-4 py-3 font-semibold">Adapter</th>
          </tr>
        </thead>
        <tbody>
          {providers.length === 0 && (
            <tr><td colSpan={CAPS.length + 2} className="px-4 py-8 text-center text-sm text-slate-500">No AI providers configured yet.</td></tr>
          )}
          {providers.map((p) => {
            const a = byKey[p.adapter_key];
            const caps = a?.capabilities || {};
            return (
              <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                {CAPS.map((c) => (
                  <td key={c.key} className="px-3 py-3 text-center">
                    {caps[c.key] ? <span className="text-emerald-600">✅</span> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.adapter_key}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}