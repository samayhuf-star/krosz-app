// Krosz admin-access policy enforcement.
// Only the authorized admin email may hold role === "admin". Everyone else is a
// customer (role === "user"). Runs as the service role so it can update User.role
// regardless of the caller's current role. Called from the frontend after every
// auth check (AuthContext.checkUserAuth) so the role field stays aligned with the
// policy on every login/signup, closing the window where an invited admin or a
// stale role could grant admin access to the wrong person.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

const ADMIN_EMAIL = "samayhuf@gmail.com";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const shouldBeAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL;
    const currentlyAdmin = user.role === "admin";
    if (shouldBeAdmin === currentlyAdmin) {
      return Response.json({ ok: true, role: user.role, changed: false });
    }

    const newRole = shouldBeAdmin ? "admin" : "user";
    await base44.asServiceRole.entities.User.update(user.id, { role: newRole });
    return Response.json({ ok: true, role: newRole, changed: true });
  } catch (error: any) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}