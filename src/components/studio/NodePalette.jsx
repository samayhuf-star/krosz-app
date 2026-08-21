import NodeIcon from './NodeIcon';

export default function NodePalette({ library, onAdd }) {
  if (!library) return <div className="p-3 text-xs text-slate-400">Loading nodes…</div>;
  return (
    <div className="flex flex-col gap-4 p-3">
      {library.groups.map((g) => (
        <div key={g.kind}>
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</p>
          <div className="grid grid-cols-1 gap-1">
            {g.nodes.map((n) => (
              <button
                key={n.type}
                onClick={() => onAdd(n)}
                className="group flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-900"
                title={n.description}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                  <NodeIcon name={n.icon} size={14} />
                </span>
                <span className="font-medium">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}