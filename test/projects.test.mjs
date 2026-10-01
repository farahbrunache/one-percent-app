// Work the operator owes somebody.
//
// Everything else on a record is work the client owes themselves. The gap this fills is the
// other direction, and the case that matters most is money taken for work nobody is tracking.

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

const account = 'acct-work-1';
const rows = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, decision, client_account_id)
  values ('h-work', 'c-work', 700, 'wise', 'RWORK00001', 'confirmed', 'go', ${account})
  returning id`;
const order = Number(rows[0].id);
await tagged`update orders set case_id = ${await db.caseForAccount(account)} where id = ${order}`;

console.log('');
console.log('work you owe them');

// Work hangs off the case, so there is nobody to owe it to until somebody has signed in.
{
  const unlinked = await tagged`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status)
    values ('h-nowork', 'c-nowork', 700, 'wise', 'RNOWORK001', 'confirmed')
    returning id`;
  check('an order nobody has linked has nobody to owe work to',
    (await press('work-take', { id: Number(unlinked[0].id), title: 'Something' })).status === 409);
}

check('work needs a line saying what it is',
  (await press('work-take', { id: order, title: '   ' })).status === 400);
check('a date that is not a date is refused',
  (await press('work-take', { id: order, title: 'A rate card', dueAt: 'soon' })).status === 400);

check('taking work on is accepted',
  (await press('work-take', { id: order, title: 'Write the rate card', dueAt: '2026-11-01' })).status === 201);
// A quote is a price rather than a promise, so work can stand without one.
check('and work with nothing quoted for it is fine',
  (await press('work-take', { id: order, title: 'Draft the landlord message' })).status === 201);

let person = await ask(`/api/desk?action=person&id=${order}`);
const [card, draft] = person.projects;
check('both come back on the record, oldest first',
  person.projects.length === 2 && card.title === 'Write the rate card'
  && draft.title === 'Draft the landlord message', person.projects.map((w) => w.title));
check('everything starts as something to do',
  card.state === 'to do' && draft.state === 'to do');
check('and nothing is handed over yet',
  card.deliveredAt === null && draft.deliveredAt === null);

// ---- against a quote --------------------------------------------------------------------
const quoted = await tagged`
  insert into quotes (account_id, amount_cents, scope_encrypted, status)
  values (${account}, 40000, ${encrypt('Price the two bathrooms.')}, 'agreed')
  returning id`;
const quoteId = Number(quoted[0].id);

check('a quote belonging to somebody else cannot be named',
  (await press('work-take', { id: order, title: 'x', quoteId: quoteId + 9999 })).status === 404);
check('naming this person\'s quote is accepted',
  (await press('work-take', { id: order, title: 'The bathrooms', quoteId })).status === 201);

person = await ask(`/api/desk?action=person&id=${order}`);
const bathrooms = person.projects.find((w) => w.title === 'The bathrooms');
check('the work knows which quote it came from', bathrooms.quoteId === quoteId, bathrooms);

// ---- money taken for work nobody is tracking --------------------------------------------
//
// The case this whole feature exists for. A paid quote with no work against it is money taken
// for something nobody is following, and the quote says so rather than leaving it to be noticed.
const untracked = await tagged`
  insert into quotes (account_id, amount_cents, scope_encrypted, status, paid_cents, paid_at)
  values (${account}, 30000, ${encrypt('Write the three lines.')}, 'paid', 30000, now())
  returning id`;
const untrackedId = Number(untracked[0].id);

person = await ask(`/api/desk?action=person&id=${order}`);
check('a paid quote with no work against it says so',
  person.quotes.find((q) => q.id === untrackedId).untracked === true);
check('and a quote nobody has paid does not',
  person.quotes.find((q) => q.id === quoteId).untracked === false);

await press('work-take', { id: order, title: 'The three lines', quoteId: untrackedId });
person = await ask(`/api/desk?action=person&id=${order}`);
check('taking the work on clears it',
  person.quotes.find((q) => q.id === untrackedId).untracked === false);

// ---- where it got to --------------------------------------------------------------------
check('a state it does not know is refused',
  (await press('work-move', { id: order, projectId: card.id, state: 'nearly' })).status === 400);

check('moving it along is accepted',
  (await press('work-move', { id: order, projectId: card.id, state: 'doing' })).status === 200);

// Delivered stamps the date by itself: the day work is marked done is the day it was done, and a
// field for it is a field nobody fills correctly.
check('handing it over is accepted',
  (await press('work-move', { id: order, projectId: card.id, state: 'delivered', note: 'Sent as one page.' })).status === 200);
person = await ask(`/api/desk?action=person&id=${order}`);
let kept = person.projects.find((w) => w.id === card.id);
check('and it stamps the day it was handed over',
  kept.state === 'delivered' && kept.deliveredAt !== null && /one page/.test(kept.note || ''), kept);

// A thing that is not delivered has no delivery date.
await press('work-move', { id: order, projectId: card.id, state: 'doing' });
person = await ask(`/api/desk?action=person&id=${order}`);
kept = person.projects.find((w) => w.id === card.id);
check('moving it back off delivered clears the date', kept.deliveredAt === null, kept);

// ---- late -------------------------------------------------------------------------------
await tagged`update projects set due_at = now() - interval '3 days' where id = ${card.id}`;
person = await ask(`/api/desk?action=person&id=${order}`);
check('work past its date reads as late',
  person.projects.find((w) => w.id === card.id).late === true);

let today = await ask('/api/desk?action=today');
check('and it is on the first screen',
  today.owing.some((r) => Number(r.projectId) === card.id), today.owing);
check('with the words on the row, so nothing has to be opened to decide',
  today.owing.find((r) => Number(r.projectId) === card.id).title === 'Write the rate card');

// Dropped work is not late. It was agreed and then overtaken, which is ordinary, and a list that
// kept chasing it would be a list nobody trusts.
await press('work-move', { id: order, projectId: card.id, state: 'dropped' });
today = await ask('/api/desk?action=today');
check('dropped work comes off the screen',
  !today.owing.some((r) => Number(r.projectId) === card.id), today.owing);
// The money is still on the quote, so dropping work hides nothing that matters.
person = await ask(`/api/desk?action=person&id=${order}`);
check('and dropping it does not read as late on the record',
  person.projects.find((w) => w.id === card.id).late === false);

// Delivering it is the other way off.
await tagged`update projects set due_at = now() - interval '3 days' where id = ${draft.id}`;
today = await ask('/api/desk?action=today');
check('the second one is late', today.owing.some((r) => Number(r.projectId) === draft.id));
await press('work-move', { id: order, projectId: draft.id, state: 'delivered' });
today = await ask('/api/desk?action=today');
check('handing it over takes it off',
  !today.owing.some((r) => Number(r.projectId) === draft.id), today.owing);

const trail = (await ask(`/api/desk?action=person&id=${order}`)).events.map((e) => e.kind);
check('taking work on and moving it are both lines on the record',
  trail.includes('project.taken') && trail.includes('project.moved'), trail);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
