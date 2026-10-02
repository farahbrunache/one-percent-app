// Signing in and out, against Skills Economy.
//
// Three steps, and the middle one is not ours: send somebody to Skills Economy, take the
// one-time code it hands back, trade that for an account id, and remember the id in a
// signed cookie. No password is typed here and none is stored.

import {
  NAME_COOKIE,
  SESSION_COOKIE,
  endpoints,
  exchangeCode,
  redirectUri,
  signInUrl,
  whoSignedIn,
} from '../lib/auth.js';
import { callerKey, encrypt, randomToken, sha256Base64Url, signSession } from '../lib/crypto.js';
import { ensureSchema, sql } from '../lib/db.js';
import { underLimit } from '../lib/settings.js';
import { HttpError, handle, readCookie, redirect, send, setCookie } from '../lib/http.js';

const HANDSHAKE_COOKIE = 'op_signin';
const HANDSHAKE_MINUTES = 10;

// Lax rather than Strict: the browser arrives back here from Skills Economy, and a Strict
// cookie is not sent on that hop, which would lose the handshake every time.
const ACROSS_THE_RETURN = 'Lax';

// Only ever a path on this site. Checking for a leading slash is not enough: a browser reads
// `/\evil.com` as an authority and leaves, and this redirect fires after the session cookie
// is set, which is exactly when being sent somewhere else is worth something to somebody.
const A_PATH_HERE = /^\/[A-Za-z0-9/_\-.]*(\?[A-Za-z0-9/_\-.=&%]*)?$/;

function landing(req) {
  const asked = new URL(req.url, 'https://placeholder.invalid').searchParams.get('to') || '/admin';
  return asked.startsWith('//') || !A_PATH_HERE.test(asked) ? '/admin' : asked;
}

async function start(req, res) {
  const discovery = await endpoints();
  const state = randomToken(16);
  const verifier = randomToken(32);
  setCookie(
    res,
    HANDSHAKE_COOKIE,
    `${state}.${verifier}.${Buffer.from(landing(req), 'utf8').toString('base64url')}`,
    HANDSHAKE_MINUTES * 60,
    ACROSS_THE_RETURN,
  );
  redirect(
    res,
    signInUrl(
      { state, codeChallenge: sha256Base64Url(verifier), returnTo: redirectUri(req) },
      discovery,
    ),
  );
}

async function callback(req, res) {
  const query = new URL(req.url, 'https://placeholder.invalid').searchParams;
  const handshake = String(readCookie(req, HANDSHAKE_COOKIE) || '').split('.');
  setCookie(res, HANDSHAKE_COOKIE, '', 0, ACROSS_THE_RETURN);

  const failed = (message) =>
    redirect(res, `/admin?problem=${encodeURIComponent(message)}`);

  if (query.get('error')) {
    return failed(
      `Skills Economy did not sign you in: ${query.get('error_description') || query.get('error')}.`,
    );
  }
  if (handshake.length !== 3) {
    return failed('That sign-in took too long, or started somewhere else. Try again.');
  }
  const [state, verifier, encodedLanding] = handshake;
  if (!state || query.get('state') !== state) {
    return failed('That sign-in did not match the one this browser started. Try again.');
  }
  const code = query.get('code');
  if (!code) return failed('Skills Economy sent no sign-in code back.');

  try {
    const discovery = await endpoints();
    const token = await exchangeCode({ code, verifier, returnTo: redirectUri(req) }, discovery);
    const { id, name } = await whoSignedIn(token, discovery);
    setCookie(res, SESSION_COOKIE, signSession(id), 12 * 3600, ACROSS_THE_RETURN);
    setCookie(res, NAME_COOKIE, name ? encrypt(name) : '', name ? 12 * 3600 : 0, ACROSS_THE_RETURN);
    // A name changed on Skills Economy reaches the desk on the next sign-in. Only a case that
    // already exists is touched: signing in alone makes nobody a client.
    // A failure here costs a name on the desk, never the sign-in, so it's logged and passed.
    if (name) {
      try {
        await ensureSchema();
        await sql()`update cases set name_encrypted = ${encrypt(name)} where account_id = ${id}`;
      } catch (error) {
        console.error('[one-percent] the name from that sign-in was not saved:', error.message);
      }
    }
  } catch (error) {
    return failed(error.message);
  }
  redirect(res, Buffer.from(encodedLanding, 'base64url').toString('utf8') || '/admin');
}

export default handle(['GET', 'POST'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');

  if (req.method === 'GET' && action === 'start') {
    await ensureSchema();
    if (!(await underLimit('signin', callerKey(req), 20, 900))) {
      throw new HttpError(429, 'Too many sign-in attempts. Wait fifteen minutes.');
    }
    return start(req, res);
  }
  if (req.method === 'GET' && action === 'callback') return callback(req, res);
  if (req.method === 'POST' && action === 'signout') {
    setCookie(res, SESSION_COOKIE, '', 0, ACROSS_THE_RETURN);
    setCookie(res, NAME_COOKIE, '', 0, ACROSS_THE_RETURN);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(400, 'Use action=start, action=callback or action=signout.');
});
