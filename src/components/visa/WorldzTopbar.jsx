import { Link } from 'react-router-dom';
import { Plus, Globe, Sparkles } from 'lucide-react';

export default function WorldzTopbar({ onAskAI }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-white"><Globe size={16} /></span>
        Krosz
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAskAI} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
          <Sparkles size={16} className="text-orange-600" /> Ask AI
        </button>
        <Link to="/destinations" className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700">
          <Plus size={16} /> New application
        </Link>
      </div>
    </header>
  );
}