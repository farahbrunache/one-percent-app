// Exercises every request path that does not need a database: method rejection, input
// validation, the bearer check on the paid gate, refusing an admin request with no cookie,
// and the shape of every error.
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
    end(text) { this.payload = text ? JSON.parse(text) : null; this.writableEnded = true; },
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

const submit = (await import('../api/submit.js')).default;
const status = (await import('../api/status.js')).default;
const recover = (await import('../api/recover.js')).default;
const admin = (await import('../api/admin.js')).default;
const call = (await import('../api/call.js')).default;

console.log('submit');
let r = await run(submit, 'GET', '/api/submit');
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
check('list refuses without a cookie', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/admin?action=decide', { id: 1, decision: 'confirm' });
check('decide refuses without a cookie', r.statusCode === 401, r.payload);
r = await run(admin, 'POST', '/api/admin?action=nonsense', {});
check('an unknown action is refused', r.statusCode === 400, r.payload);
r = await run(admin, 'DELETE', '/api/admin');
check('rejects an unsupported method', r.statusCode === 405, r.payload);

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
