import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Clock, Circle, Loader2, XCircle, Info, ChevronRight,
  ArrowRight, CalendarDays, Send, CreditCard,
} from "lucide-react";
import { getApplicationJourney } from "@/lib/visaApi";

const STAGE_ICON = {
  COMPLETED: CheckCircle2,
  ACTION_REQUIRED: AlertTriangle,
  IN_PROGRESS: Loader2,
  WAITING: Clock,
  NOT_STARTED: Circle,
  BLOCKED: XCircle,
  FAILED: XCircle,
};

function StagePill({ status, label }) {
  const Icon = STAGE_ICON[status] || Info;
  const tone = {
    COMPLETED: "bg-orange-50 text-orange-700",
    ACTION_REQUIRED: "bg-amber-50 text-amber-700",
    IN_PROGRESS: "bg-blue-50 text-blue-700",
    WAITING: "bg-slate-100 text-slate-600",
    BLOCKED: "bg-red-50 text-red-700",
    FAILED: "bg-red-50 text-red-700",
    NOT_STARTED: "bg-slate-100 text-slate-500",
  }[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      <Icon size={13} className={status === "IN_PROGRESS" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default function JourneyPanel({ applicationId }) {
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const load = async () => {
    try {
      const j = await getApplicationJourney(applicationId);
      setJourney(j);
      setError("");
    } catch (e) { setError(e?.message || "Unable to load journey"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    timer.current = setInterval(load, 25000);  // polling keeps the journey live (§48)
    return () => clearInterval(timer.current);
  }, [applicationId]);

  if (loading) return <div className="text-sm text-slate-500">Loading your application…</div>;
  if (error && !journey) return <div className="text-sm text-red-600">{error}</div>;
  if (!journey) return null;

  const { application: app, current_stage, progress, next_action, actions, timeline, blocking, blocking_reasons, estimated_processing_time } = journey;

  return (
    <div className="space-y-4">
      {/* Header card (§12/§52) */}
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{app.destination} · <span className="capitalize">{app.purpose}</span></p>
            <p className="text-sm text-slate-500">Application #{(app.id || "").slice(-6).toUpperCase()} · {app.visa_type_key}</p>
          </div>
          <StagePill status={current_stage.status} label={current_stage.title} />
        </div>

        {blocking && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Action required</p>
              <p className="text-xs text-amber-700">{blocking_reasons[0]}</p>
            </div>
          </div>
        )}

        {next_action ? (
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Next step</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{next_action.title}</p>
            {next_action.description && <p className="mt-0.5 text-sm text-slate-500">{next_action.description}</p>}
            {next_action.cta_link && (
              <Link to={next_action.cta_link} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700">
                {ctaLabel(next_action)} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <p className="text-sm text-slate-600">No action is required from you right now. We'll update you as your application progresses.</p>
          </div>
        )}

        {/* Progress (§13) */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Progress</span><span>{progress.percent}% complete</span>
          </div>
          <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-orange-600 transition-all" style={{ width: `${Math.max(2, progress.percent)}%` }} />
          </div>
          {estimated_processing_time && <p className="mt-2 text-xs text-slate-400">Estimated processing time: {estimated_processing_time}</p>}
          {!estimated_processing_time && ["PROCESSING"].includes(current_stage.stage) && <p className="mt-2 text-xs text-slate-400">Processing time unavailable.</p>}
        </div>
      </div>

      {/* Open actions (§15) */}
      {actions && actions.length > 0 && (
        <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
          <p className="text-sm font-semibold text-slate-900">Things to do ({actions.length})</p>
          <ul className="mt-3 space-y-2">
            {actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{a.title}</p>
                  {a.description && <p className="text-xs text-slate-500">{a.description}</p>}
                  {a.due_at && <p className="mt-0.5 text-xs text-amber-600">Due {fmtDate(a.due_at)}</p>}
                </div>
                {a.cta_link && (
                  <Link to={a.cta_link} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    {ctaLabel(a)} <ChevronRight size={13} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick context: appointment / submission / payment */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ContextCard icon={CalendarDays} title="Appointment">
          {journey.appointment ? <p className="text-sm text-slate-700">{journey.appointment.status} {journey.appointment.scheduled_at ? `· ${fmtDate(journey.appointment.scheduled_at)}` : ""}</p> : <p className="text-sm text-slate-400">{app.appointment_required ? "Not booked yet" : "Not required"}</p>}
        </ContextCard>
        <ContextCard icon={Send} title="Submission">
          {journey.submission ? <p className="text-sm text-slate-700">{journey.submission.status}{journey.submission.external_reference ? ` · ${journey.submission.external_reference}` : ""}</p> : <p className="text-sm text-slate-400">Not submitted</p>}
        </ContextCard>
        <ContextCard icon={CreditCard} title="Payment">
          {journey.payment?.paid ? <p className="text-sm text-orange-600">Paid</p> : journey.payment?.required ? <p className="text-sm text-amber-600">Payment required</p> : <p className="text-sm text-slate-400">—</p>}
        </ContextCard>
      </div>

      {/* Timeline (§55) */}
      <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <p className="text-sm font-semibold text-slate-900">Timeline</p>
        <ol className="mt-4 space-y-3 border-l border-slate-100 pl-5">
          {(timeline || []).length === 0 && <li className="text-sm text-slate-400">No updates yet.</li>}
          {timeline.map((t) => (
            <li key={t.id} className="relative">
              <span className="absolute -left-[26px] top-1 flex h-3 w-3 items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
              </span>
              <p className="text-sm font-medium text-slate-800">{t.title}</p>
              {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
              <p className="mt-0.5 text-xs text-slate-400">{fmtDate(t.occurred_at)}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ctaLabel(a) {
  if (a.type === "PAYMENT") return "Pay now";
  if (a.type === "APPOINTMENT") return "Book appointment";
  if (a.type === "DOCUMENT") return "Upload";
  if (a.type === "QUESTION") return "Answer";
  if (a.type === "APPROVAL") return "Review & approve";
  if (a.type === "HUMAN_HANDOFF") return "Resolve";
  return "Open";
}

function ContextCard({ icon: Icon, title, children }) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(15,23,42,.35)]">
      <div className="flex items-center gap-2 text-slate-400"><Icon size={14} /><span className="text-xs font-semibold uppercase tracking-wide">{title}</span></div>
      <div className="mt-2">{children}</div>
    </div>
  );
}