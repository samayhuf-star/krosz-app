import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, ExternalLink, GitBranch, GitPullRequest, MessageSquare, FileEdit, Ban, CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/app/PageHeader';
import { fetchPullRequests, refreshPullRequests } from '@/lib/githubPullRequestsApi';

const REPO = "Samayhuf-star/krosz-app";

export default function PullRequestsAdmin() {
  const qc = useQueryClient();
  const cached = useQuery({ queryKey: ['gh-prs'], queryFn: fetchPullRequests });
  const refresh = useMutation({
    mutationFn: refreshPullRequests,
    onSuccess: (d) => qc.setQueryData(['gh-prs'], d),
  });

  const data = cached.data || {};
  const rows = data.rows || [];
  const drafts = rows.filter((r) => r.draft);
  const needsReview = rows.filter((r) => (r.review_comments || 0) > 0 || r.mergeable_state === "blocked");
  const clean = rows.filter((r) => !r.draft && !(r.review_comments > 0) && r.mergeable_state !== "blocked");

  return (
    <div>
      <PageHeader
        eyebrow="Engineering"
        title="Pull Requests"
        description={`Open pull request status synced from ${REPO}`}
        action={
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
          >
            <RefreshCw size={16} className={refresh.isPending ? "animate-spin" : ""} />
            {refresh.isPending ? "Syncing…" : "Sync now"}
          </button>
        }
      />

      <div className="px-5 py-6 sm:px-8 lg:px-10">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open PRs" value={rows.length} icon={GitPullRequest} tone="orange" />
          <Stat label="Needs review" value={needsReview.length} icon={MessageSquare} tone="amber" />
          <Stat label="Drafts" value={drafts.length} icon={FileEdit} tone="slate" />
          <Stat label="Clean" value={clean.length} icon={CheckCircle2} tone="emerald" />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>Last synced {data.last_synced ? new Date(data.last_synced).toLocaleString() : 'never'}</span>
          {(cached.isFetching || refresh.isPending) && <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Updating…</span>}
        </div>

        {/* List */}
        <div className="mt-4 space-y-3">
          {cached.isLoading && (
            <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {!cached.isLoading && rows.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <GitPullRequest className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No open pull requests right now.</p>
              <p className="text-xs text-slate-400">Try “Sync now” to pull the latest from GitHub.</p>
            </div>
          )}
          {rows.map((pr) => <PrCard key={pr.pr_number} pr={pr} />)}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const tones = {
    orange: "bg-orange-50 text-orange-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}><Icon size={16} /></span>
      </div>
      <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

function PrCard({ pr }) {
  const needsReview = (pr.review_comments || 0) > 0 || pr.mergeable_state === "blocked";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500">#{pr.pr_number}</span>
            {pr.draft && <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600"><FileEdit size={10} /> Draft</span>}
            {needsReview && !pr.draft && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"><Ban size={10} /> Needs review</span>}
          </div>
          <a href={pr.html_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm font-semibold text-slate-900 hover:text-orange-700">
            {pr.title || "Untitled pull request"}
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><GitBranch size={12} /> {pr.head_branch} → {pr.base_branch}</span>
            <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> {pr.comments}c · {pr.review_comments}rc</span>
            <span>Updated {relative(pr.updated_at_iso)}</span>
          </div>
          {pr.labels?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {pr.labels.map((l) => <span key={l} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">{l}</span>)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {pr.author_login && (
            <div className="flex items-center gap-2">
              {pr.author_avatar && <img src={pr.author_avatar} alt="" className="h-6 w-6 rounded-full" />}
              <span className="text-xs font-medium text-slate-600">{pr.author_login}</span>
            </div>
          )}
          <a href={pr.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ExternalLink size={12} /> Open
          </a>
        </div>
      </div>
    </div>
  );
}

function relative(iso) {
  if (!iso) return "—";
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}