import { useRef, useState, useCallback } from 'react';
import NodeIcon from './NodeIcon';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

const NODE_W = 184;
const NODE_H = 60;

const KIND_COLOR = {
  trigger: 'border-sky-300 bg-sky-50 text-sky-900',
  flow: 'border-amber-300 bg-amber-50 text-amber-900',
  factory: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  executive: 'border-violet-300 bg-violet-50 text-violet-900',
  connector: 'border-cyan-300 bg-cyan-50 text-cyan-900',
  notify: 'border-rose-300 bg-rose-50 text-rose-900',
};

// Visual DAG canvas over the existing PlanTemplate task graph.
// `edges` are { from, to } where `to` depends on `from` (real DAG deps).
// Supports: move (drag body), connect (drag the right-side port onto a node),
// disconnect (click a path or its midpoint ✕), select, zoom, fit, pan (scroll).
export default function StudioCanvas({ nodes, edges, selectedId, iconMap = {}, nodeErrors = {}, onSelect, onMove, onConnect, onDisconnect }) {
  const ref = useRef(null);
  const [connecting, setConnecting] = useState(null); // { from, x, y }
  const [zoom, setZoom] = useState(1);
  const [hoverNode, setHoverNode] = useState(null);
  const [stage, setStage] = useState({ w: 1, h: 1 });

  const center = (n, side) => {
    if (!n) return { x: 0, y: 0 };
    return side === 'out' ? { x: n.x + NODE_W, y: n.y + NODE_H / 2 } : { x: n.x, y: n.y + NODE_H / 2 };
  };
  const byId = (id) => nodes.find((n) => n.id === id);

  const startDrag = (e, node) => {
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const offX = e.clientX - box.left - node.x;
    const offY = e.clientY - box.top - node.y;
    onSelect(node.id);
    const move = (ev) => onMove(node.id, Math.max(0, (ev.clientX - box.left - offX) / zoom), Math.max(0, (ev.clientY - box.top - offY) / zoom));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startConnect = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const box = ref.current.getBoundingClientRect();
    const update = (ev) => setConnecting({ from: node.id, x: (ev.clientX - box.left) / zoom, y: (ev.clientY - box.top) / zoom });
    update(e);
    const up = (ev) => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest('[data-node-id]')?.getAttribute('data-node-id');
      if (target && target !== node.id && onConnect) onConnect(node.id, target);
      setConnecting(null);
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', up);
  };

  const fit = useCallback(() => {
    if (!nodes.length) { setZoom(1); return; }
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    const w = ref.current?.clientWidth || 800;
    const h = ref.current?.clientHeight || 600;
    const z = Math.min(1, Math.max(0.4, Math.min((w - 40) / maxX, (h - 40) / maxY)));
    setZoom(Math.round(z * 100) / 100);
    setStage({ w: maxX + 60, h: maxY + 60 });
  }, [nodes]);

  return (
    <div ref={ref} className="relative h-full w-full overflow-auto bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/90 px-1 py-1 shadow-sm">
        <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Zoom in"><ZoomIn size={14} /></button>
        <span className="w-9 text-center text-[11px] text-slate-500">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Zoom out"><ZoomOut size={14} /></button>
        <button onClick={fit} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Fit to screen"><Maximize size={14} /></button>
      </div>

      <div className="relative" style={{ width: stage.w * zoom, height: stage.h * zoom, minWidth: '100%', minHeight: '100%' }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width: stage.w, height: stage.h }}>
          <svg className="absolute inset-0" style={{ width: stage.w, height: stage.h, pointerEvents: 'none' }}>
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L9,3 L0,6 Z" fill="#64748b" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = byId(e.from), b = byId(e.to);
              if (!a || !b) return null;
              const p = center(a, 'out'), q = center(b, 'in');
              const midX = (p.x + q.x) / 2, midY = (p.y + q.y) / 2;
              return (
                <g key={i} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={() => onDisconnect && onDisconnect(e.from, e.to)}>
                  <path d={`M ${p.x} ${p.y} C ${midX} ${p.y}, ${midX} ${q.y}, ${q.x} ${q.y}`} stroke="#94a3b8" strokeWidth="2" fill="none" markerEnd="url(#arrow)" />
                  <circle cx={midX} cy={midY} r="7" fill="#fff" stroke="#cbd5e1" />
                  <path d={`M ${midX - 3} ${midY - 3} L ${midX + 3} ${midY + 3} M ${midX + 3} ${midY - 3} L ${midX - 3} ${midY + 3}`} stroke="#64748b" strokeWidth="1.5" />
                </g>
              );
            })}
            {connecting && (() => {
              const a = byId(connecting.from);
              const p = a ? center(a, 'out') : { x: connecting.x, y: connecting.y };
              const midX = (p.x + connecting.x) / 2;
              return <path d={`M ${p.x} ${p.y} C ${midX} ${p.y}, ${midX} ${connecting.y}, ${connecting.x} ${connecting.y}`} stroke="#10b981" strokeWidth="2" strokeDasharray="4 4" fill="none" />;
            })()}
          </svg>

          {nodes.map((n) => {
            const selected = n.id === selectedId;
            const isHover = hoverNode === n.id;
            const color = KIND_COLOR[n.kind] || 'border-slate-300 bg-white text-slate-900';
            const errs = nodeErrors[n.id] || [];
            return (
              <div
                key={n.id}
                data-node-id={n.id}
                onPointerDown={(e) => startDrag(e, n)}
                onPointerEnter={() => setHoverNode(n.id)}
                onPointerLeave={() => setHoverNode(null)}
                onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
                className={`absolute flex cursor-grab items-center gap-2 rounded-xl border px-3 text-xs shadow-sm transition-shadow ${color} ${selected ? 'ring-2 ring-emerald-500 shadow-md' : ''} ${errs.length ? '!border-rose-400 ring-1 ring-rose-300' : ''}`}
                style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              >
                <NodeIcon name={iconMap[n.engine_type || n.type] || 'Circle'} size={15} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{n.title || n.id}</p>
                  <p className="truncate text-[10px] opacity-60">{n.structural ? 'flow' : n.engine_type || n.type}{n.money_spending ? ' · 💳' : ''}{n.type === 'approval_gate' ? ' · 🔒' : ''}</p>
                </div>
                {errs.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white" title={errs.join('; ')}>!</span>}
                {/* output port (right) — drag onto another node to create a dependency from→to */}
                <span
                  onPointerDown={(e) => startConnect(e, n)}
                  className={`absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white ${isHover ? 'bg-emerald-500' : 'bg-emerald-400/70'}`}
                  title="Drag to another node to connect"
                />
              </div>
            );
          })}
          {nodes.length === 0 && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-sm text-slate-400">
              Drag a node from the left, or describe a workflow with AI above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}