import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

const Ctx = createContext(null);
const KEY = 'launchos:advanced_mode';

// Two experiences share one app:
//  • Customer (default) — Apple-like, minimal, hides platform complexity.
//  • Advanced / Expert — the full technical dashboard (admins & experts only).
// A non-admin user can never enable Advanced mode; the flag is forced false.
export function UserModeProvider({ children }) {
  const { user } = useAuth();
  const role = user?.role || user?.data?.role;
  const canToggle = role === 'admin';

  const [advanced, setAdvanced] = useState(() => {
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  const advancedMode = canToggle ? advanced : false;

  useEffect(() => {
    try { window.localStorage.setItem(KEY, advancedMode ? '1' : '0'); } catch {}
  }, [advancedMode]);

  const value = {
    advancedMode,
    setAdvancedMode: (v) => setAdvanced(!!v),
    canToggle,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserMode() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUserMode must be used within UserModeProvider');
  return ctx;
}