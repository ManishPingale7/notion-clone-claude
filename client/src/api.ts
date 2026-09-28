// Thin fetch wrapper. Every request carries this tab's client id so the server
// can skip echoing realtime events back to the tab that caused them.

export const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { 'X-Client-Id': clientId }, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(res.status, (data && data.error) || res.statusText || 'Request failed');
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  upload: async (file: File): Promise<{ url: string; name: string; size: number; mime: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', '/api/uploads', fd);
  },
};
