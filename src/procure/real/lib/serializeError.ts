/**
 * Safely serialize any error into a structured object.
 * Prevents [object Object] from ever reaching the UI.
 */
export interface SerializedError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  stack?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (!error) return { message: 'Unknown error' };

  if (typeof error === 'string') return { message: error };

  if (error instanceof Error) {
    const result: SerializedError = {
      message: error.message || error.name || 'Unknown error',
    };
    if (import.meta.env.DEV) {
      result.stack = error.stack;
    }
    // Supabase errors often have these properties
    const rec = error as unknown as Record<string, unknown>;
    if (rec.code) result.code = String(rec.code);
    if (rec.details) result.details = String(rec.details);
    if (rec.hint) result.hint = String(rec.hint);
    return result;
  }

  if (typeof error === 'object' && error !== null) {
    const rec = error as Record<string, unknown>;

    // Extract message from nested structures
    const message = extractNestedMessage(rec);

    const result: SerializedError = {
      message: message || 'Unknown error',
    };
    if (rec.code) result.code = String(rec.code);
    if (rec.details) result.details = String(rec.details);
    if (rec.hint) result.hint = String(rec.hint);
    return result;
  }

  return { message: String(error) };
}

function extractNestedMessage(obj: Record<string, unknown>, depth = 0): string {
  if (depth > 3) return '';

  const candidates = ['message', 'error_description', 'error', 'details', 'statusText'];
  for (const key of candidates) {
    const val = obj[key];
    if (typeof val === 'string' && val && val !== '[object Object]') {
      return val;
    }
    if (typeof val === 'object' && val !== null) {
      const nested = extractNestedMessage(val as Record<string, unknown>, depth + 1);
      if (nested) return nested;
    }
  }

  try {
    const json = JSON.stringify(obj);
    if (json && json !== '{}') return json;
  } catch {
    // ignore
  }

  return '';
}

/**
 * Get a single human-readable message from any error.
 */
export function getErrorMessage(error: unknown): string {
  return serializeError(error).message;
}
