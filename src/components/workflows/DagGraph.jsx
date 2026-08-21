import { ArrowDown } from 'lucide-react';
import { computeLayers } from './statusMeta';
import NodeCard from './NodeCard';

// Layered DAG visualization. Each topological layer is a horizontal row of node
// cards; layers stack vertically with a centered connector + chevron between
// them. Parallel (independent) nodes render side by side, exactly mirroring the
// product mockup (Blueprint → Website → Domain → {CRM, Email} → Marketing).
export default function DagGraph({ tasks = [], selectedId, onSelectNode }) {
  if (!tasks.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
        This workflow has no steps yet.
      </div>
    );
  }
  const layers = computeLayers(tasks);

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto w-max min-w-full space-y-0">
        {layers.map((layer, i) => (
          <div key={i}>
            <div className="flex flex-wrap items-stretch justify-center gap-4">
              {layer.map((t) => (
                <div key={t.id} className="w-[230px]">
                  <NodeCard task={t} onSelect={onSelectNode} selected={t.id === selectedId} />
                </div>
              ))}
            </div>
            {i < layers.length - 1 && (
              <div className="flex justify-center py-2.5">
                <div className="flex flex-col items-center text-slate-300">
                  <span className="h-5 w-px bg-gradient-to-b from-slate-300 to-slate-200" />
                  <ArrowDown size={14} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}