/* Replaces `@/contexts/AuthContext`: same exports (AuthProvider, useAuth, Profile) with the demo
   admin already signed in, MFA satisfied, profile loaded. */
import { createContext, useContext, type ReactNode } from 'react'
import { toast } from 'sonner'
import { DEMO_PROFILE, DEMO_SESSION, DEMO_USER } from '../demo-user'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: string
  status: string
  country?: string | null
  countries?: string[] | null
  factories?: string[] | null
  created_at: string
  avatar_url?: string | null
  last_mfa_verified_at?: string | null
}

type AuthContextType = {
  user: typeof DEMO_USER | null
  session: typeof DEMO_SESSION | null
  profile: Profile | null
  loading: boolean
  authLoading: boolean
  profileLoading: boolean
  authError: Error | null
  profileError: Error | null
  isAuthenticated: boolean
  isAdmin: boolean
  isManager: boolean
  isPending: boolean
  isRejected: boolean
  isApproved: boolean
  aalLoading: boolean
  needsMfaEnroll: boolean
  needsMfaVerify: boolean
  refreshMfa: () => Promise<void>
  account: Profile | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  retryProfile: () => Promise<void>
}

const value: AuthContextType = {
  user: DEMO_USER,
  session: DEMO_SESSION,
  profile: DEMO_PROFILE,
  loading: false,
  authLoading: false,
  profileLoading: false,
  authError: null,
  profileError: null,
  isAuthenticated: true,
  isAdmin: true,
  isManager: false,
  isPending: false,
  isRejected: false,
  isApproved: true,
  aalLoading: false,
  needsMfaEnroll: false,
  needsMfaVerify: false,
  refreshMfa: async () => { /* demo */ },
  account: DEMO_PROFILE,
  signOut: async () => { toast.info('Demo account — sign out is disabled here.') },
  refreshProfile: async () => { /* demo */ },
  retryProfile: async () => { /* demo */ },
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth must be used within an AuthProvider')
  return c
}
