import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { safeReturnTo } from '@/lib/authReturnTo';

export default function GuestRoute() {
  const { isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  if (isLoadingAuth || !authChecked) return null;
  if (isAuthenticated) {
    const target = safeReturnTo();
    return <Navigate to={target === '/' ? '/home' : target} replace />;
  }
  return <Outlet />;
}
