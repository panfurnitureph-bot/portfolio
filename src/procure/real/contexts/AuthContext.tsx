import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { externalSupabase as supabase, otpPending } from '@/integrations/supabase/externalClient';
import { fetchOwnProfile } from '@/lib/profileApi';
import { getAal, type AalLevel, MFA_REVERIFY_DAYS } from '@/lib/mfa';
import { serializeError } from '@/lib/serializeError';
import { toast } from 'sonner';
import type { Session, User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  country?: string | null;
  countries?: string[] | null;
  factories?: string[] | null;
  created_at: string;
  avatar_url?: string | null;
  last_mfa_verified_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean; // true while either authLoading or profileLoading
  authLoading: boolean;
  profileLoading: boolean;
  authError: Error | null;
  profileError: Error | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isPending: boolean;
  isRejected: boolean;
  isApproved: boolean;
  // ── TOTP MFA (aal2) — additional step after the existing email-OTP 2FA ──
  aalLoading: boolean;        // true until the session's AAL has been resolved
  needsMfaEnroll: boolean;    // session is aal1 with NO verified factor → must enroll
  needsMfaVerify: boolean;    // session is aal1 WITH a verified factor → must verify
  refreshMfa: () => Promise<void>;
  account: Profile | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryProfile: () => Promise<void>;
}

interface LoadProfileOptions {
  force?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [aal, setAal] = useState<{ current: AalLevel; next: AalLevel }>({ current: null, next: null });
  const [aalLoading, setAalLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);

  const profileRequestRef = useRef<Promise<void> | null>(null);
  const profileRequestUserRef = useRef<string | null>(null);
  // Ref keeps profile in sync so onAuthStateChange (fixed dep array) never sees a stale closure.
  const profileRef = useRef<Profile | null>(null);
  // Track whether signOut() is in progress so we can distinguish user-initiated
  // SIGNED_OUT from a spurious one caused by a 429 token-refresh rate limit.
  const isSigningOutRef = useRef(false);
  // Timestamp (ms) of the last SIGNED_IN / TOKEN_REFRESHED — used to detect
  // if SIGNED_OUT fires suspiciously soon after a successful login.
  const lastSessionAtRef = useRef(0);

  const loadProfile = useCallback(async (authUser: User, options: LoadProfileOptions = {}) => {
    const { force = false } = options;

    if (!force && profileRequestRef.current && profileRequestUserRef.current === authUser.id) {
      await profileRequestRef.current;
      return;
    }

    const run = (async () => {
      setProfileLoading(true);
      setProfileError(null);

      try {
        const p = await fetchOwnProfile();

        if (p) {
          profileRef.current = p as Profile;
          setProfile(p as Profile);
          localStorage.setItem('account', JSON.stringify(p));
        } else {
          const err = new Error(
            `Profile not found for user ${authUser.email || authUser.id}. ` +
              'Your login session exists, but your profile record is not linked correctly.',
          );
          profileRef.current = null;
          setProfile(null);
          setProfileError(err);
        }
      } catch (err) {
        const serialized = serializeError(err);
        profileRef.current = null;
        setProfile(null);
        setProfileError(err instanceof Error ? err : new Error(serialized.message));
      } finally {
        setProfileLoading(false);
      }
    })();

    profileRequestRef.current = run;
    profileRequestUserRef.current = authUser.id;

    try {
      await run;
    } finally {
      if (profileRequestRef.current === run) {
        profileRequestRef.current = null;
        profileRequestUserRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      // Ignore SIGNED_IN while OTP 2FA is in-flight — the session from
      // signInWithPassword is immediately revoked; only verifyOtp's session is real.
      if (otpPending && event === 'SIGNED_IN') return;

      setSession(newSession);
      setUser(newSession?.user ?? null);
      setAuthError(null);

      if (newSession?.user) {
        // Hard domain gate: reject any session for a non-company account
        // immediately (covers a direct signInWithPassword that skips the OTP flow).
        const gateEmail = (newSession.user.email ?? '').toLowerCase();
        if (gateEmail.split('@')[1] !== 'northwindparts.example') {
          isSigningOutRef.current = true;
          await supabase.auth.signOut();
          profileRef.current = null;
          setProfile(null);
          setUser(null);
          setSession(null);
          setProfileLoading(false);
          setAuthLoading(false);
          return;
        }

        // Record timestamp for spurious-SIGNED_OUT detection below.
        lastSessionAtRef.current = Date.now();

        // Skip profile reload if already loaded — TOKEN_REFRESHED and SIGNED_IN
        // both fire on tab focus/alt-tab; re-loading causes profileLoading flash.
        // Use profileRef (not `profile`) — `profile` is a stale closure here.
        if (profileRef.current && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
          setAuthLoading(false);
          return;
        }
        // Set profileLoading=true synchronously to prevent a render cycle where
        // profileLoading=false + profile=null (from the prior SIGNED_OUT) makes
        // ProtectedRoute show ProfileErrorScreen before loadProfile even starts.
        setProfileLoading(true);
        setTimeout(() => {
          if (mounted) {
            void loadProfile(newSession.user);
          }
        }, 0);
      } else {
        // If SIGNED_OUT fired within 20 seconds of a valid session AND was NOT
        // triggered by the user calling signOut(), it is likely a spurious
        // sign-out caused by a 429 rate-limit on the token-refresh endpoint
        // (Supabase clears the session and fires SIGNED_OUT on refresh failure).
        // Store a warning in localStorage so Login.tsx can show the user a
        // helpful "sync your clock" message instead of a silent redirect.
        if (!isSigningOutRef.current && lastSessionAtRef.current > 0) {
          const msSinceSession = Date.now() - lastSessionAtRef.current;
          if (msSinceSession < 20_000) {
            localStorage.setItem('session_interrupt_warning', '1');
          }
        }
        profileRef.current = null;
        setProfile(null);
        setProfileError(null);
        setProfileLoading(false);
        localStorage.removeItem('account');
      }

      setAuthLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (!mounted) return;

      if (error) {
        setAuthError(error);
        setAuthLoading(false);
        setProfileLoading(false);
        return;
      }

      // Same domain gate for a session restored from storage on reload.
      const initEmail = (initialSession?.user?.email ?? '').toLowerCase();
      if (initialSession?.user && initEmail.split('@')[1] !== 'northwindparts.example') {
        isSigningOutRef.current = true;
        void supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setProfileLoading(false);
        setAuthLoading(false);
        return;
      }

      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        void loadProfile(initialSession.user);
      } else {
        setProfileLoading(false);
      }

      setAuthLoading(false);

    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Real-time subscription to profile changes (role/status updates)
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`profiles:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        async (payload) => {
          await loadProfile(user, { force: true });
          
          // Show toast if role changed
          if (payload.old && payload.new) {
            const oldRole = (payload.old as any).role;
            const newRole = (payload.new as any).role;
            if (oldRole !== newRole) {
              toast.info('Your role has been updated', {
                description: `You are now a ${newRole}`,
                duration: 5000,
              });
            }
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [user, loadProfile]);

  const signOut = async () => {
    isSigningOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } finally {
      isSigningOutRef.current = false;
    }
    setUser(null);
    setSession(null);
    profileRef.current = null;
    setProfile(null);
    setProfileError(null);
    profileRequestRef.current = null;
    profileRequestUserRef.current = null;
    localStorage.removeItem('account');
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user, { force: true });
  };

  const retryProfile = async () => {
    if (user) await loadProfile(user, { force: true });
  };

  const loading = authLoading || profileLoading;
  const isApproved =
    (profile?.status === 'approved' || profile?.status === 'active') &&
    !!profile?.role &&
    profile.role !== 'pending';
  const isPending = !!profile && (profile.status === 'pending' || profile.role === 'pending');
  const isRejected = profile?.status === 'rejected';
  const isAuthenticated = !!user && !!profile && isApproved;
  const isAdmin = profile?.role === 'admin';
  const isManager = profile?.role === 'manager' || profile?.role === 'purchasing' || isAdmin;

  // ── TOTP MFA (aal2) resolution ──
  // Recompute the session's assurance level whenever the user changes (i.e. after
  // the real post-email-OTP session is established) and expose a manual refresh
  // the enroll/verify pages call right after upgrading to aal2.
  // Key off user.id, NOT the user object — TOKEN_REFRESHED (fires on every
  // alt-tab/focus) swaps the user object with an identical id, and re-running
  // this flips aalLoading → ProtectedRoute unmounts the whole page tree
  // ("Checking security…" flash + all in-page state lost).
  const userId = user?.id ?? null;
  const refreshMfa = useCallback(async () => {
    if (!userId) {
      setAal({ current: null, next: null });
      setAalLoading(false);
      return;
    }
    setAalLoading(true);
    const next = await getAal();
    setAal(next);
    setAalLoading(false);
  }, [userId]);

  useEffect(() => {
    void refreshMfa();
  }, [refreshMfa]);

  // aal1 + no verified factor (next stays aal1) → enroll; aal1 + verified factor
  // (next is aal2) → verify.
  const needsMfaEnroll = !!user && !aalLoading && aal.current === 'aal1' && aal.next !== 'aal2';
  // aal2 alone isn't enough to skip verify forever — Supabase never expires it
  // within a live session, so also force a re-verify every MFA_REVERIFY_DAYS
  // days based on our own last_mfa_verified_at stamp.
  const lastVerified = profile?.last_mfa_verified_at ? new Date(profile.last_mfa_verified_at).getTime() : null;
  const mfaStale = lastVerified === null || Date.now() - lastVerified > MFA_REVERIFY_DAYS * 24 * 60 * 60 * 1000;
  const needsMfaVerify =
    !!user && !aalLoading &&
    ((aal.current === 'aal1' && aal.next === 'aal2') || (aal.current === 'aal2' && mfaStale));

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        authLoading,
        profileLoading,
        authError,
        profileError,
        isAuthenticated,
        isAdmin,
        isManager,
        isPending,
        isRejected,
        isApproved,
        aalLoading,
        needsMfaEnroll,
        needsMfaVerify,
        refreshMfa,
        account: profile,
        signOut,
        refreshProfile,
        retryProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
