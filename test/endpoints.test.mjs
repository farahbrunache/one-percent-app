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
const admin = (await import('../api/payments.js')).default;
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
check('there is one address for the payments screen and no second one',
  r.statusCode === 404, r.statusCode);
r = makeRes();
await route(makeReq('GET', '/payments'), r);
check('the payments screen is never cached or indexed',
  r.headers['cache-control'] === 'no-store' &&
    r.headers['x-robots-tag'] === 'noindex, nofollow', r.headers);
r = makeRes();
await route(makeReq('GET', '/desk'), r);
check('the desk is served', r.statusCode === 200 && /Desk/.test(r.body || ''), r.statusCode);
check('the desk is never cached or indexed',
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

// The reference is spoken and typed, so it must avoid characters people confuse. It is also
// what the recovery form accepts, so it has to be long enough that guessing one is hopeless.
const { referenceCode, normalizeReference, looksLikeReference } = await import('../lib/orders.js');
let refOk = true;
for (let i = 0; i < 500; i += 1) {
  const ref = referenceCode((n) => Math.floor(Math.random() * n));
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(ref) || /[O0I1S5]/.test(ref)) { refOk = false; break; }
}
check('reference is ten readable characters, no lookalikes', refOk);
check('reference normalizes from loose typing', normalizeReference(' abcde fghjk ') === 'ABCDE-FGHJK', normalizeReference(' abcde fghjk '));
check('a full reference is recognized', looksLikeReference('ABCDE-FGHJK'));
check('anything shorter is not', !looksLikeReference('ABC-DEF') && !looksLikeReference('ABCD') && !looksLikeReference('') && !looksLikeReference('ABCDEFGHJ'));

console.log('status');
r = await run(status, 'GET', '/api/status');
check('rejects a link with no token', r.statusCode === 400, r.payload);
r = await run(status, 'POST', '/api/status?t=x');
check('rejects POST', r.statusCode === 405, r.payload);

console.log('recover');
r = await run(recover, 'POST', '/api/recover', { code: 'nope' });
check('rejects a code that is too short', r.statusCode === 400, r.payload);

console.log('admin');
r = await run(admin, 'GET', '/api/payments?action=list');
check('list refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/payments?action=decide', { id: 1, decision: 'confirm' });
check('decide refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'GET', '/api/payments?action=history');
check('history refuses without a session', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/payments?action=nonsense', {});
check('an unknown action is refused', r.statusCode === 400, r.payload);
r = await run(admin, 'DELETE', '/api/payments');
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

r = await run(admin, 'GET', '/api/payments?action=list', undefined,
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
r = await run(client, 'GET', '/api/client?action=quotes');
check('what has been quoted refuses without a session', r.statusCode === 401, r.payload);
r = await run(client, 'GET', '/api/client?action=thread');
check('the conversation refuses without a session', r.statusCode === 401, r.payload);
// The go gate is a database question and is checked in the database tests. What this proves
// is that nobody reaches it without signing in first.
r = await run(client, 'POST', '/api/client?action=send', { body: 'x' });
check('writing in refuses without a session', r.statusCode === 401, r.payload);
r = await run(client, 'POST', '/api/client?action=nonsense', {});
check('an unknown client action is refused', r.statusCode === 400, r.payload);
r = await run(client, 'DELETE', '/api/client');
check('rejects an unsupported method', r.statusCode === 405, r.payload);

console.log('the desk');
const desk = (await import('../api/desk.js')).default;
r = await run(desk, 'GET', '/api/desk?action=queue');
check('the queue refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'GET', '/api/desk?action=person&id=1');
check('a person refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=decide', { id: 1, decision: 'go' });
check('a decision refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=milestone-record', { id: 1, milestoneId: 1, status: 'worked' });
check('recording an outcome refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=reply', { id: 1, body: 'x' });
check('replying refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=recommend', { id: 1, body: 'x' });
check('writing the sheet refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=quote', { id: 1, amount: 250, scope: 'x' });
check('writing a quote refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=quote-move', { id: 1, quoteId: 1, status: 'agreed' });
check('moving a quote refuses without a session', r.statusCode === 401, r.payload);
r = await run(client, 'GET', '/api/client?action=quotes');
check('reading your own quotes refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=introduce', { id: 1, reference: 'ABCDE-FGHJK' });
check('making an introduction refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=introduction-record', { id: 1, introductionId: 1, outcome: 'worked' });
check('recording what came of one refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'GET', '/api/desk?action=funnel');
check('the funnel refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'POST', '/api/desk?action=first-customer', { id: 1 });
check('recording the outcome refuses without a session', r.statusCode === 401, r.payload);
r = await run(desk, 'GET', '/api/desk?action=nonsense');
check('an unknown desk action is refused', r.statusCode === 400, r.payload);
check('and the refusal names the ones that exist', /queue/.test(r.payload?.error || ''), r.payload);
r = await run(desk, 'DELETE', '/api/desk');
check('the desk rejects an unsupported method', r.statusCode === 405, r.payload);

// The vocabulary is closed so that every screen can render a label for every value.
const vocab = await import('../lib/desk.js');
check('the two paths are the ones the pitches name',
  vocab.isPlanPath('reach') && vocab.isPlanPath('smallest') && !vocab.isPlanPath('other'));
check('a milestone can be recorded as stalled or ghosted',
  vocab.isMilestoneStatus('stalled') && vocab.isMilestoneStatus('ghosted'));
check('an invented status is refused', !vocab.isMilestoneStatus('abandoned'));
check('the decision is go or no-go and nothing else',
  vocab.isDecision('go') && vocab.isDecision('no-go') && !vocab.isDecision('maybe'));
// An order buys minutes, not attempts. Three attempts at the hard stop would be ninety minutes
// of paid voice against seven dollars taken.
const money = await import('../lib/orders.js');
check('an order buys less voice time than three full sessions',
  money.SESSION_BUDGET_SECONDS < 3 * money.ASSUME_FULL_AFTER_SECONDS,
  { budget: money.SESSION_BUDGET_SECONDS, three: 3 * money.ASSUME_FULL_AFTER_SECONDS });
check('and enough for one full session plus a dropped one',
  money.SESSION_BUDGET_SECONDS > money.ASSUME_FULL_AFTER_SECONDS,
  money.SESSION_BUDGET_SECONDS);
check('a missing webhook is assumed to have been a whole session',
  money.ASSUME_FULL_AFTER_SECONDS >= 30 * 60, money.ASSUME_FULL_AFTER_SECONDS);

check('the queues are the four that exist',
  vocab.isQueueState('waiting') && vocab.isQueueState('replies') && vocab.isQueueState('active')
    && vocab.isQueueState('closed') && !vocab.isQueueState('all'));
// The funnel starts where the data starts. Quora gives no address and no open rate, so a stage
// above the call would be a guess presented as a measurement.
check('the funnel starts at a call that came back', vocab.FUNNEL_STAGES[0].key === 'called',
  vocab.FUNNEL_STAGES[0]);
check('and ends at somebody paying them',
  vocab.FUNNEL_STAGES[vocab.FUNNEL_STAGES.length - 1].key === 'earning');
check('every stage has a label to render', vocab.FUNNEL_STAGES.every((s) => Boolean(s.label)));
// Six, and the two in the middle are the method rather than the bookkeeping: a list of people to
// approach, and that list being acted on. Both are facts about the person; "something worked"
// was a mark the operator made, which measured the desk instead.
check('the funnel is six rows', vocab.FUNNEL_STAGES.length === 6, vocab.FUNNEL_STAGES.length);
check('and approaching people is two of them',
  vocab.FUNNEL_STAGES.map((s) => s.key).join(',')
    === 'called,go,planned,listed,approached,earning',
  vocab.FUNNEL_STAGES.map((s) => s.key));

// No tiers. A quote is written for one person and turns nothing on, so these are the states it
// can be in and none of them is a level.
check('and none of them is a tier',
  !vocab.isQuoteStatus('basic') && !vocab.isQuoteStatus('premium') && !vocab.isQuoteStatus('tier'));

// Three of the states belong to the person it was written for, and they are the only three
// they can put it in. A control on the other screen that agreed on somebody's behalf would
// put their answer on the record in somebody else's hand.
check('a quote is answered three ways',
  vocab.QUOTE_ANSWERS.join(',') === 'agreed,declined,changes asked', vocab.QUOTE_ANSWERS);
check('and each answer is a state a quote can be in',
  vocab.QUOTE_ANSWERS.every((a) => vocab.isQuoteStatus(a)));
check('paid and withdrawn are not theirs to choose',
  !vocab.isQuoteAnswer('paid') && !vocab.isQuoteAnswer('withdrawn')
    && !vocab.isQuoteAnswer('offered'));

// A match that should not happen is never recorded, so there is no declined or unsafe outcome
// and there must never be one.
check('an introduction ends in one of three ways',
  vocab.isIntroductionOutcome('waiting') && vocab.isIntroductionOutcome('worked')
    && vocab.isIntroductionOutcome('went nowhere'));
check('and never in a judgment about the people in it',
  !vocab.isIntroductionOutcome('unsafe') && !vocab.isIntroductionOutcome('declined')
    && !vocab.isIntroductionOutcome('hold'));

check('a call is intake or a follow-up and nothing else',
  vocab.isCallKind('intake') && vocab.isCallKind('follow-up') && !vocab.isCallKind('second'));
check('a message has one of two authors',
  vocab.isMessageAuthor('operator') && vocab.isMessageAuthor('client')
    && !vocab.isMessageAuthor('system'));

console.log('the transcript coming back');
const retell = (await import('../api/retell.js')).default;
const { sign } = await import('retell-sdk');

// Retell signs every delivery with the API key. There is no shared secret to agree on, and the
// webhook settings in their dashboard are a URL and a timeout — so a check expecting a header of
// our own would refuse every real delivery. These sign a body the way Retell does and watch what
// happens, which is the only way to know this is right without a live account.
delete process.env.RETELL_SECRET_KEY;
r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } });
check('refuses when there is no key to check a signature against', r.statusCode === 503, r.payload);
check('and says which key it means', /webhook badge/.test(r.payload?.error || ''), r.payload);

process.env.RETELL_SECRET_KEY = 'key_invented_for_this_test';

r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } });
check('refuses a delivery with no signature at all', r.statusCode === 401, r.payload);

r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } },
  { 'x-retell-signature': 'v=1,d=deadbeef' });
check('refuses a signature that does not check out', r.statusCode === 401, r.payload);

r = await run(retell, 'POST', '/api/retell', { call: { call_id: 'c1' } },
  { 'x-retell-signature': 'not-even-the-right-shape' });
check('refuses a signature that is not the right shape', r.statusCode === 401, r.payload);

// A real one, signed the way Retell signs it. It gets past the check and on to the database,
// which is not reachable here — so a 500 is this test passing the part it can test.
const realBody = JSON.stringify({ call: { call_id: 'c1' } });
const realSignature = await sign(realBody, process.env.RETELL_SECRET_KEY);
r = await run(retell, 'POST', '/api/retell', JSON.parse(realBody),
  { 'x-retell-signature': realSignature });
check('lets a genuine delivery through to be filed', r.statusCode !== 401, r.payload);

// Signed with a different key, which is what a forgery looks like.
const wrongKeySignature = await sign(realBody, 'a-different-key');
r = await run(retell, 'POST', '/api/retell', JSON.parse(realBody),
  { 'x-retell-signature': wrongKeySignature });
check('refuses one signed with the wrong key', r.statusCode === 401, r.payload);

r = await run(retell, 'POST', '/api/retell', { nothing: true },
  { 'x-retell-signature': await sign(JSON.stringify({ nothing: true }), process.env.RETELL_SECRET_KEY) });
check('refuses a delivery that names no call', r.statusCode === 400 &&
  /names no call/.test(r.payload?.error || ''), r.payload);

r = await run(retell, 'GET', '/api/retell');
check('rejects GET', r.statusCode === 405, r.payload);

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

// Which of the two ways a confidential client proves itself is the provider's choice, not
// ours, and the refusal for getting it wrong names the client rather than the method. So the
// exchange tries the body first and the header second, and only for that one refusal.
process.env.AUTH_CLIENT_ID = 'client_test';
process.env.AUTH_CLIENT_SECRET = 'secret';
const tokenUrl = 'https://clerk.example.com/oauth/token';

function stubToken(answers) {
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    const sent = new URLSearchParams(init.body);
    seen.push({ auth: init.headers.authorization || null, secret: sent.get('client_secret') });
    const next = answers.shift();
    return {
      ok: next.ok !== false,
      status: next.ok === false ? 401 : 200,
      json: async () => next.body,
    };
  };
  return seen;
}

let seen = stubToken([
  { ok: false, body: { error: 'invalid_client' } },
  { body: { access_token: 'tok' } },
]);
let token = await auth.exchangeCode(
  { code: 'c', verifier: 'v', returnTo: 'https://app.example.net/auth/callback' },
  { token_endpoint: tokenUrl });
check('a refusal naming the client is tried the other way', token === 'tok', token);
check('the first attempt puts the secret in the body',
  seen[0].secret === 'secret' && seen[0].auth === null, seen[0]);
check('the second puts the pair in the header instead',
  seen[1].secret === null && seen[1].auth === 'Basic ' + Buffer.from('client_test:secret').toString('base64'),
  seen[1]);

seen = stubToken([{ ok: false, body: { error: 'invalid_grant' } }]);
let refused = null;
try {
  await auth.exchangeCode(
    { code: 'c', verifier: 'v', returnTo: 'https://app.example.net/auth/callback' },
    { token_endpoint: tokenUrl });
} catch (error) { refused = error; }
check('any other refusal is not retried', seen.length === 1, seen.length);
check('and it says which way it asked',
  /confidential client/.test(refused?.message || ''), refused?.message);
delete process.env.AUTH_CLIENT_SECRET;

// Paging a conversation. Every one of these was a way the old unpaged list went wrong, or a
// way a hand-rolled pager goes wrong: a number past the end showing an empty screen, a number
// below one, junk in the address, and the question of where somebody lands when they ask for
// nothing at all.
console.log('');
console.log('paging a conversation');
const { pageOf, MESSAGES_PER_PAGE } = await import('../lib/desk.js');

check('asking for nothing lands on the newest page',
  pageOf(null, MESSAGES_PER_PAGE * 3).page === 3, pageOf(null, MESSAGES_PER_PAGE * 3));
check('an empty conversation is still page one',
  pageOf(null, 0).page === 1 && pageOf(null, 0).last === 1, pageOf(null, 0));
check('one short of a second page is one page',
  pageOf(null, MESSAGES_PER_PAGE).last === 1, pageOf(null, MESSAGES_PER_PAGE));
check('one over fills a second page',
  pageOf(null, MESSAGES_PER_PAGE + 1).last === 2, pageOf(null, MESSAGES_PER_PAGE + 1));
check('a page past the end clamps to the last one',
  pageOf('99', MESSAGES_PER_PAGE * 2).page === 2, pageOf('99', MESSAGES_PER_PAGE * 2));
check('a page below one clamps to one',
  pageOf('-4', MESSAGES_PER_PAGE * 2).page === 1, pageOf('-4', MESSAGES_PER_PAGE * 2));
check('junk in the address is not a page number',
  pageOf('pear', MESSAGES_PER_PAGE * 2).page === 2, pageOf('pear', MESSAGES_PER_PAGE * 2));
check('a page in range is the page asked for',
  pageOf('1', MESSAGES_PER_PAGE * 3).page === 1, pageOf('1', MESSAGES_PER_PAGE * 3));

console.log('');
if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all passed');
