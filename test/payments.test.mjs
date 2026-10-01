// What a quote was actually paid, when it was due, and why it differs from what was quoted.
//
// `status = 'paid'` said money arrived and nothing else. The cases that matter are the three it
// could not tell apart: paid in full, paid short, and agreed but never arrived.
//
// This is real money. Every figure here is dollars somebody charged a client.

import { check, db, failureCount, tagged } from './harness.mjs';

await db.ensureSchema();

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
const { signSession, encrypt } = await import('../lib/crypto.js');
const { Readable } = await import('node:stream');
const deskEndpoint = (await import('../api/desk.js')).default;

function fakeRes() {
  return {
    statusCode: 200, writableEnded: false, body: null,
    setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; this.body = text; },
  };
}

async function press(action, payload) {
  const stream = Readable.from([JSON.stringify(payload)]);
  const req = {
    method: 'POST',
    url: `/api/desk?action=${action}`,
    headers: { cookie: `op_session=${signSession('admin-1')}`, 'content-type': 'application/json' },
  };
  Object.assign(req, { [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream) });
  const res = fakeRes();
  try {
    await deskEndpoint(req, res);
    return { status: res.statusCode, out: res.body ? JSON.parse(res.body) : null };
  } catch (error) {
    return { status: error.status || 500, message: error.message };
  }
}

async function ask(url) {
  const req = { method: 'GET', url, headers: { cookie: `op_session=${signSession('admin-1')}` } };
  const res = fakeRes();
  await deskEndpoint(req, res);
  return JSON.parse(res.body);
}

const account = 'acct-payments-1';
const rows = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, decision, client_account_id)
  values ('h-pay', 'c-pay', 700, 'wise', 'RPAY000001', 'confirmed', 'go', ${account})
  returning id`;
const order = Number(rows[0].id);
await tagged`update orders set case_id = ${await db.caseForAccount(account)} where id = ${order}`;

async function newQuote(cents, status = 'agreed') {
  const made = await tagged`
    insert into quotes (account_id, amount_cents, scope_encrypted, status, answered_at)
    values (${account}, ${cents}, ${encrypt('Price the two bathrooms.')}, ${status}, now())
    returning id`;
  return Number(made[0].id);
}

console.log('');
console.log('what a quote was actually paid');

const full = await newQuote(40000);

// ---- when it is due -------------------------------------------------------------------------
check('a quote belonging to somebody else is not reachable',
  (await press('quote-due', { id: order, quoteId: full + 9999, dueAt: '2026-11-01' })).status === 404);
check('a date that is not a date is refused',
  (await press('quote-due', { id: order, quoteId: full, dueAt: 'next tuesday' })).status === 400);
check('setting a date is accepted',
  (await press('quote-due', { id: order, quoteId: full, dueAt: '2026-11-01' })).status === 200);
// Plenty of paid work has no date on it, and a date invented to make a row look complete is a
// deadline nobody agreed to.
check('and clearing it is a real answer rather than an error',
  (await press('quote-due', { id: order, quoteId: full, dueAt: '' })).out.dueAt === null);

// ---- paid in full ---------------------------------------------------------------------------
check('an amount is needed', (await press('quote-paid', { id: order, quoteId: full })).status === 400);
check('paying it in full is accepted',
  (await press('quote-paid', { id: order, quoteId: full, amount: 400 })).status === 200);

let person = await ask(`/api/desk?action=person&id=${order}`);
let quote = person.quotes.find((q) => q.id === full);
check('the record carries what arrived and when',
  quote.paid === 400 && quote.paidAt !== null && quote.status === 'paid', quote);
check('and nothing is owed on it', quote.late === false);

// ---- paid short -----------------------------------------------------------------------------
const short = await newQuote(40000);
// A discount is a decision and it is the kind nobody remembers making, so the row carries the
// reason or it is refused.
const refused = await press('quote-paid', { id: order, quoteId: short, amount: 300 });
check('less than quoted without a reason is refused', refused.status === 400, refused);
// The refusal names the figure, so nobody has to go and look it up to understand the message.
const said = refused.message || refused.out?.error || '';
check('and the refusal says what was quoted', /400\.00/.test(said), said);

const settled = await press('quote-paid', {
  id: order, quoteId: short, amount: 300, discount: 'Took 100 off because he paid the same week.',
});
check('with a reason it is accepted', settled.status === 200, settled);
check('and it says how far short it came', settled.out.shortBy === 10000, settled.out);

person = await ask(`/api/desk?action=person&id=${order}`);
quote = person.quotes.find((q) => q.id === short);
check('the record keeps what arrived, not what was quoted',
  quote.paid === 300 && quote.amount === 400, [quote.paid, quote.amount]);
check('and the reason stays beside it',
  /paid the same week/.test(quote.discount || ''), quote.discount);

// Paying more than quoted is not a decision that needs defending.
const over = await newQuote(10000);
check('more than quoted needs no reason',
  (await press('quote-paid', { id: order, quoteId: over, amount: 150 })).status === 200);

// ---- owed -----------------------------------------------------------------------------------
const owed = await newQuote(25000);
await tagged`update quotes set due_at = now() - interval '3 days' where id = ${owed}`;

person = await ask(`/api/desk?action=person&id=${order}`);
quote = person.quotes.find((q) => q.id === owed);
check('an agreed quote past its date reads as owed', quote.late === true, quote);

const today = await ask('/api/desk?action=today');
check('and it is on the first screen',
  today.late.some((r) => Number(r.quoteId) === owed), today.late);
check('with what is owed and when it was due, so nothing has to be opened to find out',
  today.late.find((r) => Number(r.quoteId) === owed).amount === 250
  && today.late.find((r) => Number(r.quoteId) === owed).dueAt !== null, today.late);

// A quote nobody has agreed to is not money owed. Nothing is late until somebody said yes.
const offered = await newQuote(50000, 'offered');
await tagged`update quotes set due_at = now() - interval '3 days' where id = ${offered}`;
const after = await ask('/api/desk?action=today');
check('a quote nobody agreed to is never owed',
  !after.late.some((r) => Number(r.quoteId) === offered), after.late);

// Paying it takes it off the screen, which is the only thing that should.
await press('quote-paid', { id: order, quoteId: owed, amount: 250 });
const paid = await ask('/api/desk?action=today');
check('paying it takes it off', !paid.late.some((r) => Number(r.quoteId) === owed), paid.late);

const trail = (await ask(`/api/desk?action=person&id=${order}`)).events.map((e) => e.kind);
check('dating and paying are both lines on the record',
  trail.includes('quote.due') && trail.includes('quote.paid'), trail);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
