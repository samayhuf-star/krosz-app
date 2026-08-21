import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminAccess';

function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      <span className="sr-only">Checking access…</span>
    </div>
  );
}

export default function RoleRoute({ roles = [], children = null }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  const location = useLocation();

  if (isLoadingAuth || !authChecked) return <Loading />;
  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  if (roles.length > 0) {
    const allowed = roles.includes('admin') ? isAppAdmin(user) : roles.includes(user?.role);
    if (!allowed) return <Navigate to="/home" replace />;
  }
  return children || <Outlet />;
}