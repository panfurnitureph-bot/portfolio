/* Replaces `@/integrations/supabase/externalClient` (and `client`) for the copied Northwind Motor Parts code:
   the same PostgREST-style query builder the Pan demo uses, bound to the console demo database, plus a
   signed-in demo user for `supabase.auth` and a realtime channel stub that reports SUBSCRIBED. */
import { createFakeSupabase } from '../../pan/db/fake-supabase'
import { procureDb } from '../db/store'
import { DEMO_SESSION, DEMO_USER } from '../demo-user'

const base = createFakeSupabase(procureDb)

type Cb = (event: string, session: typeof DEMO_SESSION | null) => void
const auth = {
  async getSession() { return { data: { session: DEMO_SESSION }, error: null } },
  async getUser() { return { data: { user: DEMO_USER }, error: null } },
  onAuthStateChange(cb: Cb) {
    setTimeout(() => cb('SIGNED_IN', DEMO_SESSION), 0)
    return { data: { subscription: { unsubscribe() { /* demo */ } } } }
  },
  async signOut() { return { error: null } },
  async setSession() { return { data: { session: DEMO_SESSION }, error: null } },
  async signInWithPassword() { return { data: { session: DEMO_SESSION, user: DEMO_USER }, error: null } },
  async signInWithOtp() { return { data: {}, error: null } },
  async verifyOtp() { return { data: { session: DEMO_SESSION, user: DEMO_USER }, error: null } },
  async updateUser() { return { data: { user: DEMO_USER }, error: null } },
  mfa: {
    async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null } },
    async listFactors() { return { data: { totp: [{ id: 'demo-factor', status: 'verified', friendly_name: 'Demo' }], all: [{ id: 'demo-factor', status: 'verified', factor_type: 'totp' }] }, error: null } },
    async enroll() { return { data: { id: 'demo-factor', totp: { qr_code: '', secret: 'DEMO', uri: '' } }, error: null } },
    async challenge() { return { data: { id: 'demo-challenge' }, error: null } },
    async verify() { return { data: {}, error: null } },
    async unenroll() { return { data: {}, error: null } },
  },
}

/* Realtime stub: `.channel().on().subscribe(cb)` reports SUBSCRIBED so the sidebar's "Live" dot is green. */
function channel() {
  const ch = {
    on: () => ch,
    subscribe: (cb?: (status: string) => void) => { setTimeout(() => cb?.('SUBSCRIBED'), 0); return ch },
    unsubscribe: async () => 'ok',
    track: async () => 'ok',
    untrack: async () => 'ok',
    send: async () => 'ok',
    presenceState: () => ({}),
  }
  return ch
}

export const externalSupabase = { ...base, auth, channel, removeChannel: async () => 'ok', removeAllChannels: async () => [] }
export const supabase = externalSupabase
export const EXTERNAL_PROJECT_URL = 'https://demo.northwindparts.example'
export const EXTERNAL_ANON_KEY = 'demo'
export let otpPending = false
export function setOtpPending(v: boolean) { otpPending = v }
