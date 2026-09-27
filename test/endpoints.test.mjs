// Exercises every request path that does not need a database: method rejection, input
// validation, the bearer check on the paid gate, refusing an admin request with no session,
// reading a Skills Economy address out of a publishable key, and the shape of every error.
//
// Anything reaching a query is not covered here and is checked against a real database.
// Run with: npm test
import { Readable } from 'node:stream';

function makeReq(method, url, body, headers = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []);
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json', ...headers };
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    end(text) {
      // Endpoints answer in JSON and pages answer in HTML, so keep whichever this is.
      const body = text === undefined || text === null ? '' : String(text);
      try { this.payload = body ? JSON.parse(body) : null; } catch { this.payload = body; }
      this.body = body;
      this.writableEnded = true;
    },
  };
  return res;
}

async function run(handler, method, url, body, headers) {
  const res = makeRes();
  await handler(makeReq(method, url, body, headers), res);
  return res;
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) { console.log('  ok   ' + label); }
  else { failures += 1; console.log('  FAIL ' + label + (detail ? ' -> ' + JSON.stringify(detail) : '')); }
}

process.env.NODE_ENV = 'test';
const { route } = await import('../server.js');
const submit = (await import('../api/submit.js')).default;
const status = (await import('../api/status.js')).default;
const recover = (await import('../api/recover.js')).default;
const admin = (await import('../api/admin.js')).default;
const call = (await import('../api/call.js')).default;

console.log('routing');
let r = makeRes();
await route(makeReq('GET', '/'), r);
check('the bare address is the sign-in door',
  r.statusCode === 200 && /Sign in with Skills Economy/i.test(r.body || ''), r.statusCode);
r = makeRes();
await route(makeReq('GET', '/buy'), r);
check('the payment page is served', r.statusCode === 200 &&
  r.headers['content-type'].startsWith('text/html'), r.headers);
check('every response carries the security headers',
  r.headers['x-content-type-options'] === 'nosniff' &&
    r.headers['x-frame-options'] === 'DENY' &&
    r.headers['referrer-policy'] === 'no-referrer', r.headers);
r = makeRes();
await route(makeReq('GET', '/admin'), r);
check('the payments screen is never cached or indexed',
  r.headers['cache-control'] === 'no-store' &&
    r.headers['x-robots-tag'] === 'noindex, nofollow', r.headers);
r = makeRes();
await route(makeReq('GET', '/buy.html'), r);
check('the file name sends you to the address', r.statusCode === 308 &&
  r.headers.location === '/buy', r.headers);
r = makeRes();
await route(makeReq('GET', '/../lib/crypto.js'), r);
check('a path that climbs out is nothing, not a file', r.statusCode === 404, r.statusCode);
r = makeRes();
await route(makeReq('GET', '/auth/callback?code=x&state=y'), r);
check('the sign-in return reaches the endpoint',
  r.statusCode === 302 && /problem=/.test(r.headers.location || ''), r.headers);

console.log('submit');
r = await run(submit, 'GET', '/api/submit');
check('rejects GET with 405', r.statusCode === 405, r.payload);
check('names the allowed method', r.headers.allow === 'POST', r.headers);

r = await run(submit, 'POST', '/api/submit', { method: 'paypal' });
check('rejects an unknown payment method', r.statusCode === 400, r.payload);

r = await run(submit, 'POST', '/api/submit', {});
check('rejects a missing payment method', r.statusCode === 400, r.payload);

r = await run(submit, 'POST', '/api/submit', { method: 'amazon', amount: 7, code: 'short' });
check('gift card: rejects a code that is too short', r.statusCode === 400, r.payload);

r = await run(submit, 'POST', '/api/submit', { method: 'amazon', amount: 7, code: 'A'.repeat(70) });
check('gift card: rejects a code that is too long', r.statusCode === 400, r.payload);

r = await run(submit, 'POST', '/api/submit', { method: 'amazon', amount: 3, code: 'ABCD1234EFGH' });
check('gift card: rejects less than the price', r.statusCode === 400, r.payload);

r = await run(submit, 'POST', '/api/submit', { method: 'amazon', amount: 'banana', code: 'ABCD1234EFGH' });
check('gift card: rejects a non-numeric amount', r.statusCode === 400, r.payload);

// Wise carries no code, so the only thing that can stop it before the database is the
// destination being unset. It must fail loudly rather than opening an order nobody can pay
// into.
r = await run(submit, 'POST', '/api/submit', { method: 'zelle' });
check('zelle is no longer offered', r.statusCode === 400, r.payload);

delete process.env.PAY_WISE;
r = await run(submit, 'POST', '/api/submit', { method: 'wise' });
check('wise: refuses when no destination is configured', r.statusCode === 503, r.payload);
check('wise: names the missing setting', /PAY_WISE/.test(r.payload?.error || ''), r.payload);

check('every rejection carries a message', typeof r.payload?.error === 'string' && r.payload.error.length > 20, r.payload);

// The reference is spoken and typed, so it must avoid characters people confuse.
const { referenceCode, normalizeReference } = await import('../lib/orders.js');
let refOk = true;
for (let i = 0; i < 500; i += 1) {
  const ref = referenceCode((n) => Math.floor(Math.random() * n));
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(ref) || /[O0I1S5]/.test(ref)) { refOk = false; break; }
}
check('reference is six readable characters, no lookalikes', refOk);
check('reference normalizes from loose typing', normalizeReference(' abc def ') === 'ABC-DEF', normalizeReference(' abc def '));

console.log('status');
r = await run(status, 'GET', '/api/status');
check('rejects a link with no token', r.statusCode === 400, r.payload);
r = await run(status, 'POST', '/api/status?t=x');
check('rejects POST', r.statusCode === 405, r.payload);

console.log('recover');
r = await run(recover, 'POST', '/api/recover', { code: 'nope' });
check('rejects a code that is too short', r.statusCode === 400, r.payload);

console.log('admin');
r = await run(admin, 'GET', '/api/admin?action=list');
check('list refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/admin?action=decide', { id: 1, decision: 'confirm' });
check('decide refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'GET', '/api/admin?action=history');
check('history refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/admin?action=nonsense', {});
check('an unknown action is refused', r.statusCode === 400, r.payload);
r = await run(admin, 'DELETE', '/api/admin');
check('rejects an unsupported method', r.statusCode === 405, r.payload);

console.log('signing in with Skills Economy');
// The workflow supplies this. Set it here too so the file runs on its own.
process.env.CARD_ENCRYPTION_KEY =
  process.env.CARD_ENCRYPTION_KEY || 'test-key-that-is-long-enough-to-pass-0123456789';
const auth = await import('../lib/auth.js');
const crypto = await import('../lib/crypto.js');
const authEndpoint = (await import('../api/auth.js')).default;

process.env.AUTH_PUBLISHABLE_KEY = 'pk_live_' + Buffer.from('clerk.example.com$').toString('base64');
check('finds Skills Economy inside the publishable key',
  auth.issuer() === 'https://clerk.example.com', auth.issuer());
try {
  auth.issuer('not-a-key');
  check('refuses something that is not a publishable key', false);
} catch (error) {
  check('refuses something that is not a publishable key', /pk_live_/.test(error.message));
}

const signed = crypto.signSession('user_abc');
check('a signed session names the account back', crypto.readSession(signed) === 'user_abc');
check('an altered session is refused', crypto.readSession(signed.slice(0, -1) + 'x') === null);
check('an expired session is refused', crypto.readSession(crypto.signSession('user_abc', -1)) === null);
check('no session at all is refused', crypto.readSession('') === null);

process.env.ADMIN_ACCOUNT_IDS = 'user_abc, user_def';
check('an account on the admin list is an admin', auth.isAdmin('user_abc'));
check('an account not on it is not', !auth.isAdmin('user_zzz'));
process.env.ADMIN_ACCOUNT_IDS = '';
check('nobody is an admin when the list is empty', !auth.isAdmin('user_abc'));

// Which proof the sign-in carries follows the application's Public toggle, and the secret
// being set is how that toggle reaches the code.
process.env.AUTH_CLIENT_ID = 'client_test';
const fakeDiscovery = { authorization_endpoint: 'https://clerk.example.com/oauth/authorize' };
delete process.env.AUTH_CLIENT_SECRET;
let url = new URL(auth.signInUrl(
  { state: 's', codeChallenge: 'c', returnTo: 'https://app.example.net/auth/callback' },
  fakeDiscovery));
check('a client with no secret proves itself with PKCE',
  url.searchParams.get('code_challenge') === 'c' &&
    url.searchParams.get('code_challenge_method') === 'S256', url.search);
process.env.AUTH_CLIENT_SECRET = 'secret';
url = new URL(auth.signInUrl(
  { state: 's', codeChallenge: 'c', returnTo: 'https://app.example.net/auth/callback' },
  fakeDiscovery));
check('a client with a secret sends no PKCE challenge',
  !url.searchParams.has('code_challenge') && !url.searchParams.has('code_challenge_method'),
  url.search);
check('the return address and state always travel',
  url.searchParams.get('redirect_uri') === 'https://app.example.net/auth/callback' &&
    url.searchParams.get('state') === 's' &&
    url.searchParams.get('scope') === 'openid profile', url.search);
delete process.env.AUTH_CLIENT_SECRET;

r = await run(admin, 'GET', '/api/admin?action=list', undefined,
  { cookie: `op_session=${encodeURIComponent(signed)}` });
check('a signed-in account that is not an admin is refused', r.statusCode === 403, r.payload);
check('and the refusal names the account, so it can be added',
  /user_abc/.test(r.payload?.error || '') && /ADMIN_ACCOUNT_IDS/.test(r.payload?.error || ''),
  r.payload);

r = await run(authEndpoint, 'GET', '/api/auth?action=callback&code=x&state=y');
check('a sign-in with no handshake goes back with a reason',
  r.statusCode === 302 && /problem=/.test(r.headers.location || ''), r.headers);
r = await run(authEndpoint, 'GET', '/api/auth?action=callback&code=x&state=wrong', undefined,
  { cookie: 'op_signin=' + encodeURIComponent('right.verifier.' + Buffer.from('/admin').toString('base64url')) });
check('a sign-in whose state does not match goes back with a reason',
  r.statusCode === 302 && /did\+not\+match|did%20not%20match/.test(r.headers.location || ''), r.headers);
r = await run(authEndpoint, 'POST', '/api/auth?action=nonsense', {});
check('an unknown sign-in action is refused', r.statusCode === 400, r.payload);

console.log('the client area');
const client = (await import('../api/client.js')).default;
r = await run(client, 'GET', '/api/client?action=mine');
check('refuses to say anything without a session', r.statusCode === 401, r.payload);
r = await run(client, 'POST', '/api/client?action=link', { t: 'x' });
check('refuses to link without a session', r.statusCode === 401, r.payload);
r = await run(client, 'POST', '/api/client?action=nonsense', {});
check('an unknown client action is refused', r.statusCode === 400, r.payload);
r = await run(client, 'DELETE', '/api/client');
check('rejects an unsupported method', r.statusCode === 405, r.payload);
r = await run(admin, 'POST', '/api/admin?action=approve-client', { id: 1 });
check('approving a client refuses without a session', r.statusCode === 401, r.payload);

console.log('the transcript coming back');
const retell = (await import('../api/retell.js')).default;
delete process.env.RETELL_WEBHOOK_SECRET;
r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } });
check('refuses while the shared secret is unset', r.statusCode === 503 &&
  /RETELL_WEBHOOK_SECRET/.test(r.payload?.error || ''), r.payload);

process.env.RETELL_WEBHOOK_SECRET = 'a-webhook-secret-long-enough';
r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } });
check('refuses a delivery with no secret on it', r.statusCode === 401, r.payload);
r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } },
  { 'x-retell-secret': 'not-the-secret-but-long-enough' });
check('refuses a delivery with the wrong secret', r.statusCode === 401, r.payload);
r = await run(retell, 'POST', '/api/retell', { nothing: true },
  { 'x-retell-secret': 'a-webhook-secret-long-enough' });
check('refuses a delivery that names no call', r.statusCode === 400 &&
  /names no call/.test(r.payload?.error || ''), r.payload);
r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1', metadata: {} } },
  { 'x-retell-secret': 'a-webhook-secret-long-enough' });
check('refuses a call that carries no order', r.statusCode === 400 &&
  /nothing to file it against/.test(r.payload?.error || ''), r.payload);
r = await run(retell, 'GET', '/api/retell');
check('rejects GET', r.statusCode === 405, r.payload);
r = await run(retell, 'POST', '/api/retell?k=a-webhook-secret-long-enough',
  { call: { call_id: 'c1', metadata: { order_id: '1' } } });
check('the secret is not accepted from the address', r.statusCode === 401, r.payload);

console.log('who the rate limit counts');
const { callerKey } = await import('../lib/crypto.js');
const forged = { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } };
const plain = { headers: { 'x-forwarded-for': '10.0.0.1' } };
check('a caller cannot choose their own bucket by prepending an address',
  callerKey(forged) === callerKey(plain));
check('two real callers still get different buckets',
  callerKey({ headers: { 'x-forwarded-for': '10.0.0.2' } }) !== callerKey(plain));

console.log('where sign-in comes back to');
r = await run(authEndpoint, 'GET', '/api/auth?action=callback&code=x&state=y&to=' +
  encodeURIComponent('/\\evil.example'));
check('a backslash address cannot send the browser away',
  r.statusCode === 302 && !/evil\.example/.test(r.headers.location || ''), r.headers);

r = await run(admin, 'GET', '/api/admin?action=transcript&id=1');
check('a transcript refuses without a session', r.statusCode === 401, r.payload);

console.log('starting a session');
r = await run(call, 'GET', '/api/call');
check('rejects GET', r.statusCode === 405, r.payload);

r = await run(call, 'POST', '/api/call', {});
check('rejects a request with no claim token', r.statusCode === 400, r.payload);

delete process.env.RETELL_SECRET_KEY;
delete process.env.RETELL_AGENT_ID;
r = await run(call, 'POST', '/api/call', { t: 'something' });
check('refuses when the voice service is not configured', r.statusCode === 503, r.payload);
check('names what is missing',
  /RETELL_SECRET_KEY/.test(r.payload?.error || ''), r.payload);

console.log('');
if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all passed');
