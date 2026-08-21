import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { getApplication, getRequirements, approveApplication } from '@/lib/visaApi';
import RequirementsPanel from '@/components/visa/RequirementsPanel';
import ApplicationDocumentsPanel from '@/components/visa/ApplicationDocumentsPanel';
import SubmissionPanel from '@/components/visa/SubmissionPanel';
import AppointmentPanel from '@/components/visa/AppointmentPanel';
import JourneyPanel from '@/components/visa/JourneyPanel';
import SupportPanel from '@/components/visa/SupportPanel';
import ReviewCard from '@/components/visa/ReviewCard';

const STATUS_STYLE = {
  draft: 'bg-slate-100 text-slate-600',
  eligibility_confirmed: 'bg-orange-50 text-orange-700',
  documents_pending: 'bg-amber-50 text-amber-700',
  document_review: 'bg-blue-50 text-blue-700',
  user_approval: 'bg-amber-100 text-amber-800',
  submitted: 'bg-blue-50 text-blue-700',
  government_processing: 'bg-indigo-50 text-indigo-700',
  approved: 'bg-orange-100 text-orange-800',
  refused: 'bg-red-50 text-red-700',
};

export default function ApplicationDetail() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [reqData, setReqData] = useState(null);
  const [approving, setApproving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getApplication(id).then((r) => {
      setApp(r.application);
      setLoading(false);
      getRequirements(r.application.destination, r.application.purpose).then((d) => setReqData(d)).catch(() => {});
    }).catch((e) => { setError(e?.message || 'Not found'); setLoading(false); });
  }, [id]);

  const handleApprove = async () => {
    setApproving(true);
    try { const res = await approveApplication(id); if (res?.application) setApp(res.application); }
    catch (e) { setError(e?.message || 'Approval failed'); }
    finally { setApproving(false); }
  };

  if (loading) return <div className="px-4 md:px-8 py-8 text-sm text-slate-500">Loading…</div>;
  if (error && !app) return <div className="px-4 md:px-8 py-8"><p className="text-sm text-red-600">{error}</p><Link to="/applications" className="mt-2 inline-flex items-center gap-1 text-sm text-orange-700"><ArrowLeft size={14} /> Back</Link></div>;

  const canApprove = app.status === 'user_approval';

  return (
    <div className="px-4 md:px-8">
      <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Applications</Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_14px_45px_-36px_rgba(15,23,42,.35)]">
        <div>
          <p className="text-lg font-semibold text-slate-900">{app.destination} · <span className="capitalize">{app.purpose}</span></p>
          <p className="text-sm text-slate-500">{app.visa_type_key} · {app.channel} channel{app.appointment_required ? ' · appointment required' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/applications/${id}/workspace`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"><FileText size={14} /> Continue application</Link>
          <Link to={`/applications/${id}/government-form`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ShieldCheck size={14} /> Government form</Link>
          <Link to={`/applications/${id}/review`} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700"><ShieldCheck size={14} /> Review & pay</Link>
          <Link to={`/applications/${id}/status`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ShieldCheck size={14} /> Track status</Link>
          {canApprove && (
            <button onClick={handleApprove} disabled={approving} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><CheckCircle2 size={14} /> {approving ? 'Approving…' : 'Approve & submit'}</button>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[app.status] || 'bg-slate-100 text-slate-600'}`}>{app.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {/* Customer journey dashboard (Phase 12) */}
      <div className="mt-6"><JourneyPanel applicationId={id} /></div>

      {/* Application review (Phase 13) */}
      <div className="mt-6"><ReviewCard applicationId={id} /></div>

      <RequirementsPanel data={reqData} />
      <ApplicationDocumentsPanel applicationId={id} />
      <SubmissionPanel applicationId={id} />
      <AppointmentPanel applicationId={id} />

      <SupportPanel applicationId={id} />

      <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-amber-700"><ShieldCheck size={13} /> Some requirements are still being verified</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}