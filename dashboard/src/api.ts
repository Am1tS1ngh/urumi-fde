const SESSION_KEY = 'gateway.session';

export const session = {
  get: () => localStorage.getItem(SESSION_KEY),
  set: (token: string) => localStorage.setItem(SESSION_KEY, token),
  clear: () => localStorage.removeItem(SESSION_KEY),
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Calls the gateway's REST API with the current session. A 401 signs the user out. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && token) {
    session.clear();
    window.dispatchEvent(new Event('session-ended'));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
    throw new ApiError(message ?? response.statusText, response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
