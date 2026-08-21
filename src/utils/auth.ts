/**
 * Base44 authentication compatibility adapter for the legacy Adiology UI.
 * Keeps the existing UI contract while Base44 becomes the identity source of truth.
 */
import { base44 } from '../api/base44Client';

export interface User {
  id: string;
  email: string;
  username?: string;
  name?: string;
  full_name?: string;
  avatar?: string;
  role?: string;
  subscription_plan?: string;
  subscription_status?: string;
  google_ads_default_account?: string | null;
  tenant_id?: string;
  workspace_id?: string;
  company_name?: string;
  job_title?: string;
  industry?: string;
  company_size?: string;
  phone?: string;
  website?: string;
  country?: string;
  bio?: string;
  created?: string;
  updated?: string;
  email_confirmed_at?: string | null;
  card_validated?: boolean;
  selected_plan?: string | null;
  [key: string]: any;
}

const CACHE_KEY = 'user';

function normalizeUser(raw: any): User | null {
  if (!raw) return null;
  const data = raw.data || {};
  return {
    ...data,
    id: raw.id,
    email: raw.email || data.email || '',
    name: raw.name || data.name || data.full_name || '',
    full_name: raw.name || data.full_name || data.name || '',
    avatar: raw.avatar_url || data.avatar || data.avatar_url,
    role: raw.role || data.role || 'user',
    subscription_plan: data.subscription_plan || data.plan || 'free',
    subscription_status: data.subscription_status || data.status || 'active',
    tenant_id: data.tenant_id || raw.tenant_id,
    workspace_id: data.workspace_id || raw.workspace_id,
    card_validated: Boolean(data.card_validated),
    selected_plan: data.selected_plan || null,
    email_confirmed_at: raw.email_verified === false ? null : (data.email_confirmed_at || new Date().toISOString()),
    created: raw.created_date || data.created_at,
    updated: raw.updated_date || data.updated_at,
  };
}

function cacheUser(user: User | null) {
  if (typeof window === 'undefined') return;
  if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHE_KEY);
}

async function ensureWorkspaceContext(user: User | null): Promise<User | null> {
  if (!user) return null;
  try {
    const res: any = await base44.functions.invoke('adiologyWorkspace', { action: 'bootstrap' });
    const ctx = res?.data || res;
    if (ctx?.initialized && ctx?.workspace) {
      const enriched: User = {
        ...user,
        tenant_id: ctx.tenant_id || user.tenant_id,
        workspace_id: ctx.workspace.id,
      };
      cacheUser(enriched);
      if (typeof window !== 'undefined') {
        localStorage.setItem('adiology_workspace_context', JSON.stringify({
          tenant_id: enriched.tenant_id,
          workspace_id: enriched.workspace_id,
          organization_id: ctx.orchestration?.organization_id,
          project_id: ctx.orchestration?.project_id,
          application_id: ctx.orchestration?.application_id,
          role: ctx.membership?.role || 'member',
          plan: ctx.entitlement?.plan_key || enriched.subscription_plan || 'free',
        }));
      }
      return enriched;
    }
  } catch (error) {
    console.error('Workspace bootstrap failed:', error);
  }
  return user;
}

export async function signUpWithEmail(email: string, password: string, _passwordConfirm?: string, name?: string, isLifetimeDeal?: boolean) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    await base44.auth.register({ email: normalizedEmail, password, name: name || undefined });
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('base44_pending_signup_email', normalizedEmail);
      sessionStorage.setItem('base44_pending_signup_password', password);
    }
    return {
      data: null,
      error: null,
      needsEmailVerification: true,
      message: 'Enter the verification code sent to your email.',
      skipPayment: Boolean(isLifetimeDeal),
      isLifetimeDeal: Boolean(isLifetimeDeal),
    };
  } catch (err: any) {
    return { data: null, error: { message: err?.message || 'Registration failed' } };
  }
}

export async function verifySignupOtp(email: string, otpCode: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    await base44.auth.verifyOtp({ email: normalizedEmail, otpCode: otpCode.trim() });
    const password = typeof window !== 'undefined' ? sessionStorage.getItem('base44_pending_signup_password') : null;
    if (password) {
      await base44.auth.loginViaEmailPassword(normalizedEmail, password);
    }
    const raw = await base44.auth.me();
    let user = normalizeUser(raw);
    user = await ensureWorkspaceContext(user);
    cacheUser(user);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('base44_pending_signup_email');
      sessionStorage.removeItem('base44_pending_signup_password');
    }
    return { data: user, user, error: null };
  } catch (err: any) {
    return { data: null, user: null, error: { message: err?.message || 'Invalid or expired verification code' } };
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const session = await base44.auth.loginViaEmailPassword(email.trim().toLowerCase(), password);
    const raw = await base44.auth.me();
    let user = normalizeUser(raw);
    if (!user) return { data: null, error: { message: 'Unable to load account' } };
    user = await ensureWorkspaceContext(user);
    cacheUser(user);
    return { data: { user, session }, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err?.message || 'Invalid email or password' } };
  }
}

export async function signOut() {
  try {
    await base44.auth.logout();
    cacheUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('test_admin_mode');
      sessionStorage.removeItem('test_admin_user');
    }
    return { error: null };
  } catch (err: any) {
    cacheUser(null);
    return { error: { message: err?.message || 'Failed to sign out' } };
  }
}

export function getCurrentUser(): User | null {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

export async function getCurrentUserAsync(): Promise<User | null> {
  try {
    let user = normalizeUser(await base44.auth.me());
    if (user && !user.tenant_id) user = await ensureWorkspaceContext(user);
    cacheUser(user);
    return user;
  } catch {
    cacheUser(null);
    return null;
  }
}

export const getCurrentUserProfile = getCurrentUserAsync;
export async function getCurrentAuthUser() {
  const user = await getCurrentUserAsync();
  return user ? { id: user.id, email: user.email } : null;
}

export function isAuthenticated() { return getCurrentUser() !== null; }
export async function isAuthenticatedAsync() { return (await getCurrentUserAsync()) !== null; }
export function isSuperAdmin() { const r = getCurrentUser()?.role; return r === 'admin' || r === 'superadmin' || r === 'super_admin'; }

// Legacy screens still gate requests on a truthy token. This sentinel is never
// authoritative and is not a credential; Base44 SDK/cookies carry real auth.
export async function getSessionToken(): Promise<string | null> {
  return (await isAuthenticatedAsync()) ? 'base44-session' : null;
}
export function getSessionTokenSync(): string | null {
  return isAuthenticated() ? 'base44-session' : null;
}
export async function getSession() { const user = await getCurrentUserAsync(); return user ? { user } : null; }

export async function resetPassword(email: string) {
  try {
    await base44.auth.resetPasswordRequest(email.trim().toLowerCase());
    return { error: null };
  } catch (err: any) {
    return { error: { message: err?.message || 'Unable to send password reset email' } };
  }
}
export async function updatePassword(newPassword: string, token?: string) {
  try {
    if (!token) return { error: { message: 'Password reset token is missing or expired.' } };
    await base44.auth.resetPassword({ resetToken: token, newPassword });
    return { error: null };
  } catch (err: any) {
    return { error: { message: err?.message || 'Unable to update password' } };
  }
}
export async function resendVerificationEmail(email: string) {
  try { await base44.auth.resendOtp(email.trim().toLowerCase()); return { error: null }; }
  catch (err: any) { return { error: { message: err?.message || 'Failed to resend verification code' } }; }
}
export function clearProfileCache() { cacheUser(null); }
export async function createUserProfile(userId: string, email: string, fullName: string): Promise<User> {
  const user: User = { id: userId, email, name: fullName, full_name: fullName, role: 'user', subscription_plan: 'free', subscription_status: 'active' };
  cacheUser(user); return user;
}
export function setLegacyUser(_user: any) {}
export function setLegacyAuth(_auth: any) {}

// Compatibility exports referenced by obsolete/unbundled modules.
export const pb: any = null;
