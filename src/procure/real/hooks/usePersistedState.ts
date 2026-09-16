import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';

/**
 * A useState wrapper that persists values to localStorage AND mirrors them to
 * a per-user Supabase table (`user_view_prefs`). localStorage alone isn't
 * durable — browsers set to "clear site data on close", private/incognito
 * windows, and privacy extensions all wipe it, silently resetting sort/
 * filter/hidden-column/row-height settings on every reload. The server copy
 * survives all of that; on mount it's fetched and wins over whatever (if
 * anything) localStorage had, so a user only ever has to set their view up
 * once, on any device, regardless of their browser's storage behavior.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `filter:${key}`;
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const parsed = JSON.parse(stored) as T;
        // Merge with defaults so new keys get their default values
        if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue) && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ...defaultValue, ...parsed } as T;
        }
        return parsed;
      }
    } catch {
      // ignore parse errors
    }
    return defaultValue;
  });

  // Guards against the server-hydration write immediately bouncing back to
  // the server as a no-op "update" the instant it lands.
  const skipNextServerWrite = useRef(false);

  // Pull the durable server copy once we know who's logged in — it wins over
  // local storage, since local storage is the side that unreliably gets wiped.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('user_view_prefs')
          .select('value')
          .eq('user_id', userId)
          .eq('pref_key', key)
          .maybeSingle();
        if (cancelled || data?.value == null) return;
        skipNextServerWrite.current = true;
        setStateRaw(data.value as T);
      } catch {
        // No server copy yet (or offline) — keep whatever localStorage/default gave us.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  // localStorage write — fast, synchronous-feeling, works offline.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // ignore quota errors
    }
  }, [storageKey, state]);

  // Durable backup — debounced so rapid changes (typing a filter value,
  // dragging a column width) don't hammer the DB with a write per keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (skipNextServerWrite.current) { skipNextServerWrite.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (supabase as any)
        .from('user_view_prefs')
        .upsert(
          { user_id: userId, pref_key: key, value: state, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,pref_key' },
        );
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key, state]);

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw(value);
    },
    [],
  );

  return [state, setState];
}
