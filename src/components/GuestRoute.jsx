import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { safeReturnTo } from '@/lib/authReturnTo';

export default function GuestRoute() {
  const { isAuthenticated, isLoadingAuth, authChecked, checkUserAuth } = useAuth();
  // Same recovery as ProtectedRoute: if the startup probe failed without
  // resolving auth, check the user directly instead of rendering nothing forever.
  useEffect(() => {
    if (!authChecked && !isLoadingAuth) checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);
  if (isLoadingAuth || !authChecked) return null;
  if (isAuthenticated) {
    const target = safeReturnTo();
    return <Navigate to={target === '/' ? '/home' : target} replace />;
  }
  return <Outlet />;
}
