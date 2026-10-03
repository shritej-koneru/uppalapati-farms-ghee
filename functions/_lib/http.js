/* ---------- Small request/response helpers ----------
   Shared by the order endpoint and the session endpoint so both speak the same
   JSON dialect and fail the same way. */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  /* Orders carry names, phone numbers and addresses. Nothing about a response
     should be cached by a proxy or left in a shared cache. */
  'cache-control': 'no-store',
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/* Every refusal returns the same shape, so the client has one error path and no
   reason to special-case a message. */
export function refuse(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

/* Returns parsed JSON, or null when the body is missing, not JSON, or not an
   object. Callers treat null as "malformed" rather than trusting a cast. */
export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  let body;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

/* Cloudflare sets CF-Connecting-IP on every request and overwrites any value the
   client sent, so this is the real address rather than a header a caller can
   forge. It is only used to throttle sign-in attempts. */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/* Addresses are hashed before being used as a throttle key so the orders
   database never holds anything that identifies a visitor's machine. */
export async function hashForRateLimit(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
