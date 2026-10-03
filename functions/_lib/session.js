/* ---------- Owner sign-in ----------

   One passphrase, held as a SHA-256 digest in a Worker secret, and a signed
   cookie once it has been entered correctly.

   Why a passphrase rather than a full account: there is a single owner, orders
   are read far more often than they are written, and a forgotten password must
   not mean lost orders. A long passphrase the owner keeps in their password
   manager has no database row to lose and nothing to reset.

   The passphrase itself is never stored — only its digest — and never leaves the
   Worker. Comparison is done on the digests in constant time. */

import { clientIp, hashForRateLimit } from './http.js';

const COOKIE = 'ghee_orders';
const SESSION_HOURS = 8;

/* Sign-in attempts allowed per address per window. A wrong passphrase has a
   256-bit space to search, so this exists to stop someone using the endpoint as
   a cheap oracle and to slow a script, not to make guessing feasible. */
const THROTTLE_WINDOW_MINUTES = 15;
const THROTTLE_LIMIT = 8;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

const base64url = {
  encode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
};

/* Compares two hex digests without an early exit, so the time taken does not
   reveal how many leading characters matched. Both sides are fixed length. */
function sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function sessionCookieHeader(token) {
  /* Secure and HttpOnly so the cookie is unreadable from JavaScript and never
     sent over plain HTTP. SameSite=Strict keeps it off any cross-site request,
     which is the only thing that could otherwise ride the owner's session. */
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedCookieHeader() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function createSession(env) {
  const now = Date.now();
  const payload = `${now}.${now + SESSION_HOURS * 3600 * 1000}`;
  const signature = base64url.encode(await hmac(env.ORDER_SESSION_SECRET, payload));
  return `${base64url.encode(new TextEncoder().encode(payload))}.${signature}`;
}

/* Returns true when the request carries a valid, unexpired session cookie. */
export async function isSignedIn(request, env) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;

  const [encodedPayload, providedSignature] = match[1].split('.');
  if (!encodedPayload || !providedSignature) return false;

  /* Decoded first, then verified. `createSession` signs the payload string
     itself, so the signature has to be recomputed over that same string — not
     over its base64 form, which is a different byte sequence and would never
     verify. Decoding attacker-supplied base64 is not a trust step; the
     comparison below is. */
  let payload;
  try {
    payload = new TextDecoder().decode(base64url.decode(encodedPayload));
  } catch {
    return false;
  }

  const expected = base64url.encode(await hmac(env.ORDER_SESSION_SECRET, payload));
  if (!sameDigest(expected, providedSignature)) return false;

  const expiresAt = Number(payload.split('.')[1]);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

/* Signs in, if the passphrase matches and the address is not throttled.

   Returns a token on success, or an error string to hand back to the caller. A
   wrong passphrase and an unknown-visit both cost the same PBKDF2-free SHA-256,
   and both answer the same message, so this endpoint reveals nothing about which
   part was wrong. */
export async function signIn(request, env, passphrase) {
  const ipKey = await hashForRateLimit(clientIp(request), env.ORDER_SESSION_SECRET);
  const windowStart = Math.floor(Date.now() / (THROTTLE_WINDOW_MINUTES * 60 * 1000));

  if (await throttled(env, ipKey, windowStart)) {
    return { throttled: true };
  }

  /* The secret already holds a digest, so only the submitted passphrase needs
     hashing. Hashing the stored value as well would compare SHA-256(digest)
     against SHA-256(passphrase), which can never be equal and would lock the
     owner out of their own order book.

     Trimmed because a secret piped in from a file or a shell tends to pick up a
     trailing newline, and a digest that does not match by one character presents
     as "I typed the right passphrase and it says no" with nothing to act on. */
  const expected = String(env.ORDER_ADMIN_PASSPHRASE_HASH || '').trim().toLowerCase();
  const provided = await sha256(String(passphrase ?? ''));

  if (!sameDigest(expected, provided)) {
    await recordFailure(env, ipKey, windowStart);
    return { ok: false };
  }

  await clearFailures(env, ipKey);
  return { ok: true, token: await createSession(env) };
}

async function throttled(env, ipKey, windowStart) {
  /* SUM over the counter column, not COUNT(*) over rows. There is one row per
     window per address, so COUNT(*) would return 1 on the first failure and 1
     again on the hundredth — the throttle would never engage. The three-window
     lookback lets an address that just missed a boundary still be counted. */
  const row = await env.GHEE_ORDERS.prepare(
    'SELECT COALESCE(SUM(failures), 0) AS failures FROM login_attempts WHERE ip_key = ? AND window_started >= ?',
  )
    .bind(ipKey, windowStart - 2)
    .first();
  return Number(row?.failures ?? 0) >= THROTTLE_LIMIT;
}

async function recordFailure(env, ipKey, windowStart) {
  await env.GHEE_ORDERS.prepare(
    `INSERT INTO login_attempts (ip_key, window_started, failures) VALUES (?, ?, 1)
     ON CONFLICT (ip_key, window_started) DO UPDATE SET failures = failures + 1`,
  )
    .bind(ipKey, windowStart)
    .run();
  /* Old windows are dead weight once read; clearing them keeps the table from
     growing without bound on an endpoint that may never be used again. */
  await env.GHEE_ORDERS.prepare('DELETE FROM login_attempts WHERE window_started < ?')
    .bind(windowStart - 10)
    .run();
}

async function clearFailures(env, ipKey) {
  await env.GHEE_ORDERS.prepare('DELETE FROM login_attempts WHERE ip_key = ?').bind(ipKey).run();
}
