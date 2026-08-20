import { Link, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Globe, Home, FolderOpen, ChevronRight } from 'lucide-react';
import { isAppAdmin } from '@/lib/adminAccess';

export default function PageNotFound() {
  const location = useLocation();
  const { data: auth, isFetched } = useQuery({
    queryKey: ['p404-user'],
    queryFn: async () => {
      try {
        const user = await base44.auth.me();
        return { user, isAuthenticated: true };
      } catch {
        return { user: null, isAuthenticated: false };
      }
    },
  });

  const isAdmin = isFetched && auth?.isAuthenticated && isAppAdmin(auth?.user);
  const path = location.pathname;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
          <Globe size={22} />
        </div>
        <p className="text-6xl font-light tracking-tight text-slate-300">404</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">This page doesn’t exist</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We couldn’t find <span className="font-medium text-slate-800">{path}</span> in the Krosz app. It may have moved or been removed.
        </p>

        <div className="mt-8 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Link to="/" className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700">
            <Home size={16} /> Go home
          </Link>
          {auth?.isAuthenticated ? (
            <Link to="/applications" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <FolderOpen size={16} /> My applications
            </Link>
          ) : (
            <Link to="/apply" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <ChevronRight size={16} /> Start a visa application
            </Link>
          )}
        </div>

        {isAdmin && (
          <p className="mt-8 text-xs leading-5 text-slate-400">
            Admin tip: this route isn’t part of the Krosz surface. If you expected it, add it in the builder.
          </p>
        )}
      </div>
    </div>
  );
}