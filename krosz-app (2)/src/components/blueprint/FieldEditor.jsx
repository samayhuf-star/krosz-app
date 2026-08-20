import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

function humanize(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function blankTemplate(sample) {
  if (!sample || typeof sample !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(sample)) {
    if (Array.isArray(v)) out[k] = [];
    else if (v && typeof v === 'object') out[k] = blankTemplate(v);
    else if (typeof v === 'number') out[k] = 0;
    else out[k] = '';
  }
  return out;
}

// A single recursive editor that renders any node of the blueprint by its
// shape — string, number, string[], object{}, or object[] — with inline edit,
// add and delete. readOnly disables every control (for approved blueprints).
export default function FieldEditor({ value, onChange, label, readOnly = false, depth = 0 }) {
  if (value === null || value === undefined) return null;

  // Number
  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-9"
      />
    );
  }

  // String
  if (typeof value === 'string') {
    const long = value.length > 60 || /\n/.test(value);
    return (
      <Input
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={long ? 'h-16' : 'h-9'}
      />
    );
  }

  // Array
  if (Array.isArray(value)) {
    const objectItems = value.length > 0 && typeof value[0] === 'object' && !Array.isArray(value[0]);

    // string[]
    if (!objectItems) {
      return (
        <div className="space-y-2">
          {label && <p className="text-xs font-medium text-slate-500">{humanize(label)}</p>}
          <div className="flex flex-wrap gap-2">
            {value.map((v, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white pl-2 pr-1">
                <Input
                  value={v}
                  disabled={readOnly}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                  className="h-8 w-44 border-0 p-0 focus-visible:ring-0"
                />
                {!readOnly && (
                  <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600" aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                )}
              </span>
            ))}
            {!readOnly && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, ''])} className="h-8 border border-dashed border-slate-300 text-slate-600">
                <Plus size={14} /> Add
              </Button>
            )}
          </div>
        </div>
      );
    }

    // object[]
    return (
      <div className="space-y-3">
        {label && <p className="text-xs font-medium text-slate-500">{humanize(label)}</p>}
        {value.map((item, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">#{i + 1}</span>
              {!readOnly && (
                <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600" aria-label="Remove item">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <FieldEditor value={item} onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} readOnly={readOnly} depth={depth + 1} />
          </div>
        ))}
        {!readOnly && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, blankTemplate(value[0])])} className="h-8 border border-dashed border-slate-300 text-slate-600">
            <Plus size={14} /> Add item
          </Button>
        )}
      </div>
    );
  }

  // Object
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      <div className="space-y-3">
        {label && <p className="text-xs font-medium text-slate-500">{humanize(label)}</p>}
        {entries.length === 0 && <p className="text-xs italic text-slate-400">Empty — add an item in the parent list.</p>}
        {entries.map(([k, v]) => (
          <div key={k} className={depth > 0 ? '' : 'rounded-xl border border-slate-200 bg-white p-4'}>
            <p className="mb-1 text-xs font-medium text-slate-500">{humanize(k)}</p>
            <FieldEditor value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} label={k} readOnly={readOnly} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}