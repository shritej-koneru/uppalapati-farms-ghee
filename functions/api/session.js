/* ---------- /api/session ----------

   The owner's sign-in. Three verbs, no more:

     GET    — am I signed in? Used by the admin page on load.
     POST   — exchange the passphrase for a signed cookie.
     DELETE — forget the cookie.

   Nothing here reveals whether a passphrase was close to correct, and nothing
   here hands back the passphrase. The digest lives in a Worker secret and the
   comparison happens inside `signIn`. */

import { json, refuse, readJson } from '../_lib/http.js';
import { isSignedIn, signIn, sessionCookieHeader, clearedCookieHeader } from '../_lib/session.js';

export async function onRequestGet({ request, env }) {
  return json({ ok: true, signedIn: await isSignedIn(request, env) });
}

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return refuse('Malformed request.');

  const result = await signIn(request, env, body.passphrase);

  if (result.throttled) {
    /* 429 with a real wait, so the owner is told to come back rather than to
       keep guessing. A wrong passphrase and an exhausted allowance are
       deliberately different: the first is the owner's own typo and must not
       lock them out of their own shop for a quarter of an hour. */
    return json(
      { ok: false, error: 'Too many attempts. Wait 15 minutes and try again.' },
      429,
      { 'retry-after': '900' },
    );
  }

  if (!result.ok) return refuse('That passphrase is not correct.', 401);

  return json(
    { ok: true, signedIn: true },
    200,
    { 'set-cookie': sessionCookieHeader(result.token) },
  );
}

export async function onRequestDelete() {
  return json(
    { ok: true, signedIn: false },
    200,
    { 'set-cookie': clearedCookieHeader() },
  );
}
