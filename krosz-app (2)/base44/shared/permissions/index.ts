// Shared Permission Framework — role + capability resolver.
// Account-level (Customer Account), Workspace-level (a Business in the account),
// Module-level (Website/SEO/CRM/...), Resource-level (a specific version/record).
// Framework only — no Team Management UI is built here (by explicit scope).
// Roles and the capability matrix are the single source of truth; the UI and
// backend functions resolve access through `can()` rather than hardcoding roles.

export type Role = 'owner' | 'admin' | 'manager' | 'editor' | 'viewer';

export const ROLES: Role[] = ['owner', 'admin', 'manager', 'editor', 'viewer'];

// Capability ordering matters: a role grants every capability of lower roles.
const ROLE_RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, editor: 2, viewer: 1 };

// Explicit capabilities that are NOT simply rank-derived (e.g. account-level actions).
// Everything else falls back to rank comparison against the capability's min role.
export const CAPABILITY_MIN_ROLE: Record<string, Role> = {
  // Account level
  'account.manage_billing': 'owner',
  'account.manage_team': 'owner',
  'account.manage_providers': 'admin',
  'account.delete': 'owner',
  'account.view_health': 'admin',
  // Workspace (business) level
  'workspace.create': 'manager',
  'workspace.delete': 'owner',
  'workspace.manage_settings': 'manager',
  // Module level
  'module.generate': 'editor',
  'module.edit_draft': 'editor',
  'module.approve': 'manager',
  'module.publish': 'manager',
  'module.rollback': 'manager',
  'module.archive': 'admin',
  // Resource level (read)
  'resource.read': 'viewer',
};

export type Scope = 'account' | 'workspace' | 'module' | 'resource';

export interface PermissionContext {
  scope: Scope;
  /** The user's role at the requested scope (or the highest role they hold if finer scopes are introduced later). */
  role: Role;
  /** Optional: does the user own the specific resource? (resource-level override) */
  ownerId?: string;
}

const HIGHER_OR_EQUAL = (held: Role, required: Role): boolean => ROLE_RANK[held] >= ROLE_RANK[required];

/**
 * Resolve whether an action is permitted. Returns a decision object so callers
 * can surface a clear reason to the caller/API without re-implementing rules.
 */
export function can(user: { id?: string; role: Role }, action: string, ctx: PermissionContext): { allowed: boolean; reason: string } {
  // Resource-level ownership override: owners can always act on their own resource
  // for read/edit actions even if their role would not otherwise permit it.
  const ownerBypassActions = ['resource.read', 'module.edit_draft'];
  if (ctx.ownerId && user.id && ctx.ownerId === user.id && ownerBypassActions.includes(action)) {
    return { allowed: true, reason: 'owner' };
  }
  const required = CAPABILITY_MIN_ROLE[action];
  if (!required) {
    // Unknown capability: default-deny. Capability must be declared to be grantable.
    return { allowed: false, reason: `unknown_capability:${action}` };
  }
  const held = user.role ?? ctx.role;
  return HIGHER_OR_EQUAL(held, required)
    ? { allowed: true, reason: 'role' }
    : { allowed: false, reason: `insufficient_role:needs_${required}` };
}

/** Convenience boolean resolver for guards and middleware. */
export function isAllowed(user: { id?: string; role: Role }, action: string, ctx: PermissionContext): boolean {
  return can(user, action, ctx).allowed;
}