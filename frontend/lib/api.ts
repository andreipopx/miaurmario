const API_BASE_PATH = '/api/v1';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

/** Why a request never reached the API. Translated via `errors.api.network_<code>`. */
export type NetworkErrorCode = 'offline' | 'unreachable' | 'cancelled';

class NetworkError extends Error {
  code: NetworkErrorCode;

  // `message` stays English and internal (logs, Sentry): what the user sees comes
  // from the message catalogue, keyed by `code`.
  constructor(code: NetworkErrorCode = 'unreachable') {
    super(`network_${code}`);
    this.code = code;
    this.name = 'NetworkError';
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE_PATH}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (!navigator.onLine) {
      throw new NetworkError('offline');
    }
    throw new NetworkError('unreachable');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // The backend sends a machine `code` plus an English `message`. The message is
    // for logs and non-browser clients only; the UI renders `errors.api.<code>`.
    const message = (typeof data.detail === 'string' ? data.detail : data.detail?.message)
      || data.error?.message
      || 'Request failed';
    throw new ApiError(message, response.status, data);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string, options?: FetchOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchApi<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchApi<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchApi<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, options?: FetchOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'DELETE' }),
};

const handledErrors = new WeakSet<object>();

/** The machine code in an API error body: `{detail: {code}}` or `{detail: {error_code}}`. */
export function getApiErrorCode(error: unknown): string | null {
  if (error instanceof NetworkError) return `network_${error.code}`;
  if (!(error instanceof ApiError)) return null;
  const detail = (error.data as { detail?: unknown } | undefined)?.detail;
  if (!detail || typeof detail !== 'object') return null;
  const { code, error_code: errorCode } = detail as { code?: unknown; error_code?: unknown };
  if (typeof code === 'string' && code) return code;
  if (typeof errorCode === 'string' && errorCode) return errorCode;
  return null;
}

// The UI is Spanish-first and the backend is not localized, so error copy lives in
// messages/{es,en}.json under `errors.api.<code>`. <ApiErrorMessages> (rendered by
// <Providers>) registers the lookup so non-React code can translate too.
type ApiErrorCatalogue = { translate: (code: string) => string | null; generic: string };

let catalogue: ApiErrorCatalogue = { translate: () => null, generic: '' };

export function setApiErrorCatalogue(next: ApiErrorCatalogue | null) {
  catalogue = next ?? { translate: () => null, generic: '' };
}

/** Translated copy for a thrown error, or null when we have nothing better than a fallback. */
export function resolveErrorMessage(error: unknown): string | null {
  const code = getApiErrorCode(error);
  return code ? catalogue.translate(code) : null;
}

/** Last-resort translated copy ("Algo ha salido mal"). */
export function getGenericErrorMessage(): string {
  return catalogue.generic;
}

/**
 * What to show the user for a failed request: the translated message for the
 * backend's error code, else the caller's own translated `fallback`. The
 * backend's English `message` is deliberately never rendered.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') handledErrors.add(error);
  return resolveErrorMessage(error) ?? fallback;
}

export function isErrorHandled(error: unknown): boolean {
  return error !== null && typeof error === 'object' && handledErrors.has(error);
}

export { ApiError, NetworkError };
