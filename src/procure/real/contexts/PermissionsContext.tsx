import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { UserPermission, getUserPermissions, canViewTable, canEditTable, canAccessRoute } from '@/lib/userPermissions';
import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { toast } from 'sonner';

interface PermissionsContextType {
  permissions: UserPermission[];
  loading: boolean;
  role: string;
  status: string;
  checkCanView: (tableName: string) => boolean;
  checkCanEdit: (tableName: string) => boolean;
  checkCanAccessRoute: (route: string) => boolean;
  refetch: () => void;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading, isAdmin } = useAuth();
  const profileId = profile?.id ?? null;
  const role = profile?.role || 'pending';

  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  // Only show loading=true on first-ever fetch — not on re-mounts or tab switches
  const loadedForRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(() => {
    // If admin or no user yet, no loading needed
    if (!profileId || isAdmin) return false;
    // Already loaded for this user (e.g. hot reload / StrictMode remount)
    return loadedForRef.current !== profileId;
  });

  const loadPermissions = useCallback(async (force = false, silent = false) => {
    if (!profileId || isAdmin) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    if (!force && loadedForRef.current === profileId) {
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const perms = await getUserPermissions(profileId);
      loadedForRef.current = profileId;
      setPermissions(perms);
    } catch (err) {
    } finally {
      if (!silent) setLoading(false);
    }
  }, [profileId, isAdmin]);

  // Initial load once auth resolves
  useEffect(() => {
    if (authLoading) return;
    void loadPermissions(false);
  }, [authLoading, loadPermissions]);

  // Reset on logout
  useEffect(() => {
    if (!profileId) {
      setPermissions([]);
      setLoading(false);
      loadedForRef.current = null;
    }
  }, [profileId]);

  // Background polling every 30s — silent, no loading flash
  useEffect(() => {
    if (!profileId || isAdmin) return;
    const interval = setInterval(() => {
      if (!document.hidden) void loadPermissions(true, true);
    }, 30000);
    return () => clearInterval(interval);
  }, [profileId, isAdmin, loadPermissions]);

  // Tab focus — silent refresh
  useEffect(() => {
    if (!profileId || isAdmin) return;
    const handler = () => {
      if (!document.hidden) void loadPermissions(true, true);
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [profileId, isAdmin, loadPermissions]);

  // Realtime — silent refresh + toast on permission change.
  // Saving permissions upserts many rows at once, and Supabase emits one event
  // per row. Debounce so a burst collapses into a single refresh + single toast
  // (instead of ~one per managed table).
  useEffect(() => {
    if (!profileId || isAdmin) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let sawRemoval = false; // any DELETE in the burst → show the "removed" variant

    const channel = supabase
      .channel(`permissions_ctx:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_permissions' },
        (payload) => {
          const rowUserId = (payload.new as any)?.user_id ?? (payload.old as any)?.user_id;
          if (rowUserId && rowUserId !== profileId) return;

          if (payload.eventType === 'DELETE') sawRemoval = true;

          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            const removed = sawRemoval;
            sawRemoval = false;
            void loadPermissions(true, true);
            if (removed) {
              toast.info('Your permissions have been updated', {
                description: 'Some access has been removed.',
                duration: 5000,
              });
            } else {
              toast.success('Your permissions have been updated', {
                description: 'Your access has changed. The menu will update automatically.',
                duration: 5000,
              });
            }
          }, 600);
        }
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [profileId, isAdmin, loadPermissions]);

  const checkCanView = useCallback(
    (tableName: string) => isAdmin || canViewTable(permissions, tableName, role),
    [permissions, role, isAdmin]
  );

  const checkCanEdit = useCallback(
    (tableName: string) => isAdmin || canEditTable(permissions, tableName, role),
    [permissions, role, isAdmin]
  );

  const checkCanAccessRoute = useCallback(
    (route: string) => isAdmin || canAccessRoute(permissions, route, role),
    [permissions, role, isAdmin]
  );

  return (
    <PermissionsContext.Provider value={{
      permissions,
      loading,
      role,
      status: profile?.status || 'pending',
      checkCanView,
      checkCanEdit,
      checkCanAccessRoute,
      refetch: () => loadPermissions(true, true),
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
