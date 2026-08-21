// Krosz admin-access policy enforcement.
// Only the authorized admin email may hold platform_role === "platform_owner".
// Everyone else defaults to "member". Runs as the service role so it can update
// User.platform_role regardless of the caller's current role. Called from the
// frontend after every auth check (AuthContext.checkUserAuth) so the field stays
// aligned with the policy on every login/signup, closing the window where an
// invited admin or a stale role could grant platform-owner access to the wrong
// person.
//
// NOTE: this used to read/write a legacy `role` field ("admin"/"user"). The User
// schema has since moved to `platform_role` (platform_owner | reseller_admin |
// tenant_admin | member) — see lockedFlow.ts's platform_owner check. Writing to
// the old `role` field silently no-ops against the current schema, which is why
// this stopped actually enforcing anything.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

const ADMIN_EMAIL = "samayhuf@gmail.com";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    // me() can reject transiently during a page load when the access token is
    // being refreshed/raced (e.g., ExpiredToken, cookie re-issue). Map those to
    // a clean 401 — never a 500 — so they don't pollute logs as enforcement
    // failures. The frontend AuthContext already swallows this best-effort.
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const shouldBeAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL;
    const currentlyAdmin = user.platform_role === "platform_owner";
    if (shouldBeAdmin === currentlyAdmin) {
      return Response.json({ ok: true, platform_role: user.platform_role, changed: false });
    }

    const newRole = shouldBeAdmin ? "platform_owner" : "member";
    await base44.asServiceRole.entities.User.update(user.id, { platform_role: newRole });
    return Response.json({ ok: true, platform_role: newRole, changed: true });
  } catch (error: any) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}