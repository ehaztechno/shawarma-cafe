let inMemoryToken: string | null = null;

export function setApiAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getApiAuthToken(): string | null {
  return inMemoryToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : {};

  if (!res.ok) {
    throw new ApiError(
      (data as any)?.error || `Request failed (${res.status})`,
      res.status
    );
  }

  const method = (options.method || 'GET').toUpperCase();
  if (
    typeof window !== 'undefined' &&
    method !== 'GET' &&
    (path.startsWith('/api/pos/') || path.startsWith('/api/staff'))
  ) {
    window.dispatchEvent(new CustomEvent('sc-pos-mutated'));
  }

  return data as T;
}
