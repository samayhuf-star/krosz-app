import { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const ActiveBusinessContext = createContext(null);
const STORAGE_KEY = 'launchos:active_business_id';

// Active Workspace = the active Business within the authenticated Customer
// Account. This is the SINGLE source of truth for the active workspace.
// No module knows how workspace persistence works — they call the helpers below.
export function ActiveBusinessProvider({ children }) {
  const qc = useQueryClient();
  const { data: businesses, isLoading } = useQuery({
    queryKey: ['active-business-context'],
    queryFn: async () => await base44.entities.Business.list('-created_date', 100),
  });

  const [storedId, setStoredId] = useState(() => {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });

  const list = businesses || [];

  const activeBusinessId = useMemo(() => {
    if (!list.length) return null;
    if (storedId && list.some((b) => b.id === storedId)) return storedId;
    return list[0].id;
  }, [list, storedId]);

  const activeBusiness = useMemo(
    () => list.find((b) => b.id === activeBusinessId) || null,
    [list, activeBusinessId]
  );

  useEffect(() => {
    try { if (activeBusinessId) window.localStorage.setItem(STORAGE_KEY, activeBusinessId); } catch {}
  }, [activeBusinessId]);

  // --- Workspace API (the only surface modules should use) ---

  /** Switch the active workspace (business). Persists across reloads. */
  const switchWorkspace = (id) => { setStoredId(id); };

  /**
   * Create a new workspace (business) in the authenticated account and make it
   * active. The tenant is derived from the authenticated user (or supplied by the
   * caller when an account is being provisioned). Refreshes the workspace list.
   */
  const createWorkspace = async (input, tenantId) => {
    const tid = tenantId ?? (await base44.auth.me())?.data?.tenant_id;
    if (!tid) throw new Error('No active account. Complete onboarding first.');
    const rec = await base44.entities.Business.create({
      tenant_id: tid,
      launch_stage: input.launch_stage || 'business_info',
      status: input.status || 'draft',
      ...input,
    });
    await qc.invalidateQueries({ queryKey: ['active-business-context'] });
    setStoredId(rec.id);
    return rec;
  };

  /** Force a re-fetch of the workspace list. */
  const refreshWorkspace = () => qc.invalidateQueries({ queryKey: ['active-business-context'] });

  /** Current workspace record, or null. */
  const getCurrentWorkspace = () => activeBusiness;

  const value = {
    businesses: list,
    activeBusiness,
    activeBusinessId,
    loading: isLoading,
    // Public workspace API
    switchWorkspace,
    createWorkspace,
    refreshWorkspace,
    getCurrentWorkspace,
    // Back-compat aliases (existing pages) — do not use in new code
    setActive: switchWorkspace,
    refresh: refreshWorkspace,
  };

  return <ActiveBusinessContext.Provider value={value}>{children}</ActiveBusinessContext.Provider>;
}

export function useActiveBusiness() {
  const ctx = useContext(ActiveBusinessContext);
  if (!ctx) throw new Error('useActiveBusiness must be used within ActiveBusinessProvider');
  return ctx;
}