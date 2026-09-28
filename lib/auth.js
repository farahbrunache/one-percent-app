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
// to this endpoint in server.js.
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

  async function post(useBasic) {
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    const sent = new URLSearchParams(form);
    if (useBasic) {
      // The other of the two ways a confidential client may prove itself: the pair in an
      // Authorization header rather than in the body. Which one a provider accepts is not
      // something this side can know, and both are standard.
      sent.delete('client_secret');
      headers.authorization =
        'Basic ' + Buffer.from(`${clientId()}:${secret}`).toString('base64');
    }
    const answer = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers,
      body: sent.toString(),
    });
    return { answer, payload: await answer.json().catch(() => ({})) };
  }

  let { answer: response, payload: body } = await post(false);

  // A refusal naming the client, from a confidential sign-in, is the one case worth a second
  // attempt: it is what a provider says when the credentials were sent the way it does not
  // take. Anything else is a real refusal and is not retried.
  if (!response.ok && secret && body.error === 'invalid_client') {
    ({ answer: response, payload: body } = await post(true));
  }

  if (!response.ok) {
    // Which of the two ways it asked is the thing the refusal never says, and it is the thing
    // that is usually wrong: a Public application refuses a secret, and a confidential one
    // refuses a sign-in that carries none. Saying it turns an opaque OAuth error into a
    // setting somebody can go and look at.
    const asked = secret
      ? 'It asked as a confidential client, because AUTH_CLIENT_SECRET is set, and tried ' +
        'the secret both in the body and in the Authorization header. If the application ' +
        'is marked Public, clear that setting: a public client proves itself with PKCE and ' +
        'is refused for sending a secret at all. If it is not Public, then AUTH_CLIENT_ID ' +
        'or AUTH_CLIENT_SECRET does not match what the application holds.'
      : 'It asked as a public client with PKCE, because AUTH_CLIENT_SECRET is not set. If ' +
        'the application is not marked Public, that setting is what is missing.';
    throw new Error(
      `Skills Economy refused the sign-in: ${body.error_description || body.error || response.status}. ${asked}`,
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

// Who is signed in, whoever they are. The client area needs the account and nothing else —
// whether that account is a client is a question about the orders, not about the sign-in.
export function accountOrNull(req) {
  return readSession(readCookie(req, SESSION_COOKIE));
}

export function requireAccount(req) {
  const id = accountOrNull(req);
  if (!id) throw new HttpError(401, 'Sign in with Skills Economy first.');
  return id;
}

// Who is signed in, and are they allowed on the payments screen.
export function requireAdmin(req) {
  const id = readSession(readCookie(req, SESSION_COOKIE));
  if (!id) throw new HttpError(401, 'Sign in with Skills Economy first.');
  if (!isAdmin(id)) {
    // Naming the account is what makes this fixable. Whoever reads this signed in as that
    // account a moment ago, so it is their own id and nothing is revealed by saying it —
    // and without it, setting ADMIN_ACCOUNT_IDS means matching two strings by eye.
    throw new HttpError(
      403,
      `Signed in as ${id}, which is not an admin here. Put that id in the ` +
        'ADMIN_ACCOUNT_IDS setting and deploy again — a changed setting does not reach ' +
        'the running code until there is a new deployment.',
    );
  }
  return id;
}
