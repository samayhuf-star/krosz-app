// Single source of truth for who may see the Krosz admin dashboard.
// The backend (enforceAdminAccess function) keeps User.role aligned with this
// policy; the UI gates on email so access is correct even before the post-login
// enforcement round-trip completes.
export const ADMIN_EMAIL = "samayhuf@gmail.com";

export function isAppAdmin(user) {
  return !!user && (user.email || "").toLowerCase() === ADMIN_EMAIL;
}