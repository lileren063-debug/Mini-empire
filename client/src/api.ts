/** Thin API client. The server is authoritative; this only sends intents. */
const TOKEN_KEY = 'mini-empire-token';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = (() => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
})();
let onUnauthorized: () => void = () => undefined;

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: session lasts until reload */ }
}
export const getToken = () => token;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

function idemKey() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Every mutation carries an idempotency key so network retries never double-charge.
  if (method !== 'GET') headers['idempotency-key'] = idemKey();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Server time offset so countdowns use the server's clock, not the device clock. */
let offset = 0;
export function syncServerTime(serverTime: number) { offset = serverTime - Date.now(); }
export const serverNow = () => Date.now() + offset;
