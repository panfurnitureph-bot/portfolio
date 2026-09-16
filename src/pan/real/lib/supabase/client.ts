/* Browser Supabase client shim — in the demo it is the same in-memory fake used by the "server" code,
   plus a no-op realtime channel API so components that subscribe to table changes still mount. */
import { createFakeSupabase } from '../../../db/fake-supabase'

type Chan = { on: (...a: unknown[]) => Chan; subscribe: (...a: unknown[]) => Chan; unsubscribe: () => void; send?: (...a: unknown[]) => void }
function chan(): Chan { const c: Chan = { on: () => c, subscribe: () => c, unsubscribe: () => {}, send: () => {} }; return c }

export function createBrowserSupabase(..._a: unknown[]) {
  void _a
  const fake = createFakeSupabase()
  return {
    ...fake,
    channel: (..._x: unknown[]) => { void _x; return chan() },
    removeChannel: (..._x: unknown[]) => { void _x },
    removeAllChannels: () => {},
    auth: { ...fake.auth, async getSession() { return { data: { session: null }, error: null } }, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

/* Pan (2026-09-05) waits for the realtime socket to carry the user token before subscribing; the demo has no socket, so resolve immediately. */
export function realtimeReady() { return Promise.resolve(createBrowserSupabase()) }
