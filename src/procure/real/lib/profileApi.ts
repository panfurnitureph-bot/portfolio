import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { callAdminOperationsApi } from '@/lib/adminOperationsApi';
import { serializeError } from '@/lib/serializeError';

type ProfileRecord = Record<string, unknown> & {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  created_at: string;
  avatar_url?: string | null;
};

const RETRYABLE_ERROR_MARKERS = [
  'timeout',
  'timed out',
  'upstream request timeout',
  'failed to fetch',
  'network',
  'fetcherror',
  '502',
  '503',
  '504',
];

/**
 * Call the admin-operations edge function with the current user's JWT.
 * Works for both self-service (get_own_profile, upsert_own_profile)
 * and admin actions.
 */
export async function callProfileApi(
  action: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return callAdminOperationsApi(action, body);
}

async function getAuthenticatedUser() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.user ?? null;
}

function isRetryableError(error: unknown): boolean {
  const message = serializeError(error).message.toLowerCase();
  return RETRYABLE_ERROR_MARKERS.some((marker) => message.includes(marker));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && isRetryableError(error);
      if (!canRetry) throw error;
      await sleep(150 * attempt);
    }
  }

  throw lastError;
}

async function fetchProfileDirectById(userId: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabase
    .from('profiles' as any)
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ProfileRecord | null) ?? null;
}

async function fetchProfileDirectByEmail(email: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabase
    .from('profiles' as any)
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ProfileRecord | null) ?? null;
}

/**
 * Fetch the current user's own profile.
 * Primary path: direct lookup by auth user id (fast path).
 * Fallback path: admin-operations edge function for RLS-bypass scenarios.
 */
export async function fetchOwnProfile() {
  const authUser = await getAuthenticatedUser();
  if (!authUser) return null;

  let directError: unknown = null;
  let edgeError: unknown = null;

  try {
    const directProfile = await withRetries(() => fetchProfileDirectById(authUser.id), 2);

    if (directProfile) {
      return directProfile;
    }
  } catch (error) {
    directError = error;
  }

  try {
    const result = await withRetries(() => callProfileApi('get_own_profile'), 2);
    const profile = (result.data as ProfileRecord | null) ?? null;

    if (profile?.id === authUser.id) {
      return profile;
    }

  } catch (error) {
    edgeError = error;
  }

  const resolvedError = edgeError ?? directError;
  if (resolvedError) {
    const serialized = serializeError(resolvedError);
    if (isRetryableError(resolvedError)) {
      throw new Error('Profile service temporarily unavailable. Please retry.');
    }
    throw new Error(serialized.message || 'Unable to load profile.');
  }

  return null;
}

/**
 * Upsert the current user's own profile during registration.
 */
export async function upsertOwnProfile(email: string, fullName: string) {
  const authUser = await getAuthenticatedUser();
  if (!authUser) {
    throw new Error('Not authenticated');
  }

  const payload = {
    id: authUser.id,
    email,
    full_name: fullName,
    role: 'pending',
    status: 'pending',
  };

  try {
    const { data, error } = await supabase
      .from('profiles' as any)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  } catch (directError) {
  }

  const result = await callProfileApi('upsert_own_profile', { email, full_name: fullName });
  return result.data ?? null;
}
