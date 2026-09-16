import { externalSupabase as supabase, EXTERNAL_PROJECT_URL } from '@/integrations/supabase/externalClient';

// The admin-operations edge function lives on the EXTERNAL project (where the
// data + auth.users actually are). It used to be hosted on the
// VITE_SUPABASE_URL project, but that project is in a different org we can't
// deploy to. Pointing to the external project keeps the function and its
// service-role target on the same Supabase project.
const ADMIN_FUNCTION_URL = `${EXTERNAL_PROJECT_URL}/functions/v1/admin-operations`;

type AdminPayload = Record<string, unknown>;
type AdminResult = {
  error?: unknown;
  [key: string]: unknown;
};

function extractErrorMessage(err: unknown, depth = 0): string {
  if (depth > 4) return '';

  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  if (err instanceof Error) return err.message || err.name;

  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    const candidates = [record.message, record.error_description, record.error, record.details];

    for (const candidate of candidates) {
      const message = extractErrorMessage(candidate, depth + 1);
      if (message && message !== '[object Object]') return message;
    }

    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return String(err ?? '');
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    return session.access_token;
  }

  // Do NOT call refreshSession() here — it fires SIGNED_OUT if the refresh token
  // is invalid or the request fails, which kicks the user to the login page.
  // getSession() already refreshes the token internally when needed.
  throw new Error('Not authenticated');
}

async function requestAdminOperation(
  payload: AdminPayload,
  accessToken: string
): Promise<{ response: Response; result: AdminResult | null }> {
  const response = await fetch(ADMIN_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  if (!rawBody) {
    return { response, result: null };
  }

  try {
    return {
      response,
      result: JSON.parse(rawBody) as AdminResult,
    };
  } catch {
    return {
      response,
      result: { error: rawBody },
    };
  }
}

function shouldRetryRequest(response: Response, result: AdminResult | null): boolean {
  if ([502, 503, 504].includes(response.status)) return true;

  if (response.status !== 401) return false;

  const errorMessage = extractErrorMessage(result?.error ?? result).toLowerCase();
  return (
    errorMessage.includes('invalid token') ||
    errorMessage.includes('invalid authentication token') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('jwt')
  );
}

export async function callAdminOperationsApi(
  action: string,
  body: AdminPayload = {}
): Promise<AdminResult> {
  const payload: AdminPayload = { action, ...body };

  const initialToken = await getAccessToken();
  let { response, result } = await requestAdminOperation(payload, initialToken);

  if (shouldRetryRequest(response, result)) {
    if (response.status === 401) {
      // Use getSession() not refreshSession() — refreshSession() fires SIGNED_OUT on failure.
      const { data: { session: refreshed } } = await supabase.auth.getSession();
      if (refreshed?.access_token) {
        ({ response, result } = await requestAdminOperation(payload, refreshed.access_token));
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 400));
      ({ response, result } = await requestAdminOperation(payload, initialToken));
    }
  }

  if (!response.ok) {
    const resolvedError = extractErrorMessage(result?.error ?? result);
    const fallbackError = `Admin API error: ${response.status}`;
    const message = resolvedError || fallbackError;

    throw new Error(message);
  }

  return (result ?? {}) as AdminResult;
}
