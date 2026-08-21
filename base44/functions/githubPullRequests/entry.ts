import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Krosz Engineering — syncs open pull requests from Samayhuf-star/krosz-app
// via the shared GitHub connector. Actions:
//   cached — read the GitHubPullRequest cache (admin, instant dashboard load)
//   live   — fetch from GitHub now, upsert cache, return rows (admin, on-demand)
//   sync   — same fetch+cache, workflow-safe (no user), minimal response (scheduled)
const REPO = "Samayhuf-star/krosz-app";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const sr = base44.asServiceRole.entities;

    const body = await req.json().catch(() => ({}));
    const action = body.action || "cached";

    // cached + live are admin-only; sync runs from the scheduled workflow (no user).
    if ((action === "cached" || action === "live") && (!user || user.role !== "admin")) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }

    if (action === "cached") {
      const rows = await sr.GitHubPullRequest.list("-updated_at_iso", 200).catch(() => []);
      const latest = await sr.GitHubPullRequest.list("-fetched_at", 1).catch(() => []);
      const last_synced = (latest && latest[0]?.fetched_at) || null;
      return Response.json({ repo: REPO, rows: rows || [], last_synced, count: (rows || []).length });
    }

    if (action === "sync" || action === "live") {
      const result = await fetchAndCache(base44, sr);
      if (action === "live") {
        return Response.json({ repo: REPO, rows: result.rows, last_synced: result.fetched_at, count: result.rows.length });
      }
      return Response.json({ ok: true, repo: REPO, count: result.rows.length, fetched_at: result.fetched_at });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error?.message || "Server error" }, { status: 500 });
  }
}

async function fetchAndCache(base44, sr) {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection("github");
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "krosz-app",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 300)}`);
  }
  const prs = await res.json();
  const fetched_at = new Date().toISOString();
  const rows = (prs || []).map((pr) => ({
    repo: REPO,
    pr_number: pr.number,
    title: pr.title || "",
    state: "open",
    draft: !!pr.draft,
    html_url: pr.html_url || "",
    author_login: pr.user?.login || "",
    author_avatar: pr.user?.avatar_url || "",
    head_branch: pr.head?.ref || "",
    base_branch: pr.base?.ref || "",
    created_at_iso: pr.created_at || null,
    updated_at_iso: pr.updated_at || null,
    mergeable_state: pr.mergeable_state || "",
    comments: pr.comments || 0,
    review_comments: pr.review_comments || 0,
    labels: (pr.labels || []).map((l) => l.name || "").filter(Boolean),
    fetched_at,
  }));

  // Replace the cache for this repo (bounded to its open PRs).
  await sr.GitHubPullRequest.deleteMany({ repo: REPO }).catch(() => {});
  if (rows.length) await sr.GitHubPullRequest.bulkCreate(rows).catch(() => {});
  return { rows, fetched_at };
}