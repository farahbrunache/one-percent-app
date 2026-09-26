// Signing in with Skills Economy.
//
// Skills Economy runs on Clerk, and Clerk can act as the place other sites sign people in
// against — the same arrangement as any "sign in with" button. One Percent is registered
// there as its own application, with its own client id and secret, and gets back only the
// account id of whoever signed in.
//
// The two products sit on different domains, and this needs nothing from that: no shared
// session, no second domain on the Clerk instance, and none of Skills Economy's own keys.
// One Percent cannot read a Skills Economy account, change anything about it, or sign
// anybody in who has not signed themselves in.
//
// Who is an admin here is decided here, by account id in a setting. It is One Percent's own
// question — Skills Economy has its own admins and they are not the same list.

import { readSession } from './crypto.js';
import { HttpError, readCookie } from './http.js';

export const SESSION_COOKIE = 'op_session';

const DISCOVERY_TTL_MS = 60 * 60_000;

let cached = { issuer: null, at: 0, doc: null };

function required(name, what) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. ${what}`);
  return value;
}

export function publishableKey() {
  return required(
    'AUTH_PUBLISHABLE_KEY',
    'It is the Skills Economy publishable key, the one starting pk_live_, and it is public.',
  );
}

// pk_live_<base64 of "clerk.example.com$"> — the same derivation Skills Economy does.
export function issuer(key = publishableKey()) {
  const value = String(key);
  if (!value.startsWith('pk_live_') && !value.startsWith('pk_test_')) {
    throw new Error(
      'AUTH_PUBLISHABLE_KEY does not look like a publishable key. It has to start pk_live_ ' +
        'or pk_test_.',
    );
  }
  const host = Buffer.from(value.slice(8), 'base64').toString('utf8').replace(/\$+$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    throw new Error(
      `AUTH_PUBLISHABLE_KEY decodes to "${host}", which is not a host name. The key is ` +
        'probably cut short, or it is from a different service.',
    );
  }
  return `https://${host}`;
}

// Clerk publishes where its sign-in, token and account endpoints are. Reading them rather
// than writing them down means nothing here breaks when Clerk moves one.
export async function endpoints() {
  const from = issuer();
  if (cached.issuer === from && cached.doc && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return cached.doc;
  }
  const url = `${from}/.well-known/openid-configuration`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (cause) {
    throw new Error(`Could not reach ${url} to find the sign-in addresses: ${cause.message}`);
  }
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}. The sign-in addresses are unknown.`);
  }
  const body = await response.json();
  for (const field of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint']) {
    if (!body[field]) throw new Error(`${url} did not say where ${field} is.`);
  }
  cached = { issuer: from, at: Date.now(), doc: body };
  return body;
}

export function clientId() {
  return required(
    'AUTH_CLIENT_ID',
    'It is the client id of the One Percent application registered in the Skills Economy ' +
      'Clerk dashboard.',
  );
}

// A plain path with no query string, because the sign-in service matches the return address
// character for character and some refuse one carrying a query. /auth/callback is rewritten
// to this endpoint in vercel.json.
export function redirectUri(req) {
  const host = req.headers.host;
  if (!host) throw new Error('The request carries no host, so the return address is unknown.');
  return `https://${host}/auth/callback`;
}

// A client with a secret proves itself with the secret; one without proves itself with
// PKCE. Which of the two applies is the Public toggle on the application, and the presence
// of AUTH_CLIENT_SECRET is how that toggle reaches this code. Sending both is not always
// accepted, so it sends exactly one.
export function clientSecret() {
  return process.env.AUTH_CLIENT_SECRET || '';
}

export function signInUrl({ state, codeChallenge, returnTo }, discovery) {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', returnTo);
  url.searchParams.set('scope', 'openid profile');
  url.searchParams.set('state', state);
  if (!clientSecret()) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

// Trades the one-time code for a token, proving the client the same way the sign-in did.
export async function exchangeCode({ code, verifier, returnTo }, discovery) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: returnTo,
    client_id: clientId(),
  });
  const secret = clientSecret();
  if (secret) form.set('client_secret', secret);
  else form.set('code_verifier', verifier);

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Skills Economy refused the sign-in: ${body.error_description || body.error || response.status}.`,
    );
  }
  if (!body.access_token) throw new Error('Skills Economy returned no token for that sign-in.');
  return body.access_token;
}

export async function accountId(accessToken, discovery) {
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Skills Economy answered ${response.status} when asked who signed in.`);
  }
  const body = await response.json();
  const id = body.sub || body.user_id;
  if (!id) throw new Error('Skills Economy did not say which account signed in.');
  return String(id);
}

export function isAdmin(id) {
  const allowed = String(process.env.ADMIN_ACCOUNT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(String(id));
}

// Who is signed in, and are they allowed on the payments screen.
export function requireAdmin(req) {
  const id = readSession(readCookie(req, SESSION_COOKIE));
  if (!id) throw new HttpError(401, 'Sign in with Skills Economy first.');
  if (!isAdmin(id)) {
    throw new HttpError(
      403,
      'That Skills Economy account is not an admin here. Admins are listed in the ' +
        'ADMIN_ACCOUNT_IDS setting.',
    );
  }
  return id;
}
