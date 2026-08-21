import { Link } from "react-router-dom";
import { ChevronRight, AlertTriangle } from "lucide-react";

const STATUS_TONE = {
  COMPLETED: "bg-orange-50 text-orange-700",
  ACTION_REQUIRED: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  WAITING: "bg-slate-100 text-slate-600",
  BLOCKED: "bg-red-50 text-red-700",
};

export default function ApplicationJourneyCard({ journey }) {
  const app = journey.application;
  const stage = journey.current_stage;
  const next = journey.next_action;
  return (
    <Link to={`/applications/${app.id}`} className="block rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)] hover:border-orange-200 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{app.destination} · <span className="capitalize">{app.purpose}</span></p>
          <p className="text-xs text-slate-400">#{(app.id || "").slice(-6).toUpperCase()} · {app.visa_type_key}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[stage.status] || "bg-slate-100 text-slate-600"}`}>{stage.title}</span>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Progress</span><span>{journey.progress.percent}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-orange-600" style={{ width: `${Math.max(2, journey.progress.percent)}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {next ? (
          <div className="flex items-center gap-1.5 text-sm text-slate-700">
            <AlertTriangle size={14} className="text-amber-500" />
            <span>{next.title}</span>
          </div>
        ) : (
          <span className="text-sm text-slate-400">No action required</span>
        )}
        <ChevronRight size={16} className="text-slate-400" />
      </div>
    </Link>
  );
}