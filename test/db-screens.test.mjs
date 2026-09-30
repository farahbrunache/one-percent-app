// The two screens the desk opens on, against a real Postgres.
//
// Split out of database.test.mjs when that file passed its size limit. These two groups are the
// ones that run through an endpoint rather than a query, so they sit together: what the first
// screen asks for, and the demo records the desk is tested with.
//
// Everything they need comes from the harness -- one database, one schema, one check().

import { check, db, failureCount, tagged } from './harness.mjs';

await db.ensureSchema();
const { caseForAccount } = db;

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
const { signSession } = await import('../lib/crypto.js');
const deskEndpoint = (await import('../api/desk.js')).default;

async function newOrder(overrides = {}) {
  const rows = await tagged`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status)
    values (${'h-' + Math.random()}, ${'c-' + Math.random()}, 700, 'wise',
            ${'R' + Math.random().toString(36).slice(2, 11).toUpperCase()},
            ${overrides.status || 'confirmed'})
    returning id`;
  return Number(rows[0].id);
}

// ---- the first screen -----------------------------------------------------------------------
//
// Two questions and nothing else: calls that came back and have not been decided on, and people
// who wrote and have not been opened. Both oldest first. Blocked comes off and comes back.
//
// Run through the endpoint rather than by restating its where clause here, for the same reason
// the queue tests are: a test holding its own copy of the condition passes while the screen
// stays wrong.
console.log('');
console.log('the first screen');

async function askToday() {
  const req = { method: 'GET', url: '/api/desk?action=today', headers: {
    cookie: `op_session=${signSession('admin-1')}`,
  } };
  let payload = null;
  const res = {
    statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; try { payload = JSON.parse(text); } catch { payload = text; } },
  };
  await deskEndpoint(req, res);
  return payload;
}

const waitingCall = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted, ended_at)
             values (${waitingCall}, ${'c-today-' + waitingCall}, 'x', now() - interval '31 hours')`;

let screen = await askToday();
check('a call that came back and has no decision is waiting',
  screen.calls.some((c) => c.id === waitingCall), screen.calls.map((c) => c.id));
check('and it says how long it has been',
  screen.calls.find((c) => c.id === waitingCall).hoursWaiting > 30);

await tagged`update orders set decision = 'go', decision_at = now() where id = ${waitingCall}`;
screen = await askToday();
check('a decided call drops off',
  !screen.calls.some((c) => c.id === waitingCall), screen.calls.map((c) => c.id));

// Somebody wrote in. Opening their record is what marks it read.
const wroteIn = await newOrder();
const wroteCase = await caseForAccount('acct-wrote-today');
await tagged`update orders set client_account_id = 'acct-wrote-today', case_id = ${wroteCase},
                               status = 'confirmed' where id = ${wroteIn}`;
await tagged`insert into messages (account_id, author, body_encrypted, created_at)
             values ('acct-wrote-today', 'client', 'x', now() - interval '5 hours')`;

screen = await askToday();
check('somebody who wrote and has not been opened is unread',
  screen.unread.some((u) => u.caseId === wroteCase), screen.unread.map((u) => u.caseId));

await tagged`update cases set messages_read_at = now() where id = ${wroteCase}`;
screen = await askToday();
check('opening it takes them off',
  !screen.unread.some((u) => u.caseId === wroteCase), screen.unread.map((u) => u.caseId));

// They write again after being read.
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-wrote-today', 'client', 'x')`;
screen = await askToday();
check('writing again puts them back', screen.unread.some((u) => u.caseId === wroteCase));

// Blocked comes off the screen.
await tagged`update cases set blocked_at = now(), blocker_encrypted = 'x' where id = ${wroteCase}`;
screen = await askToday();
check('blocked comes off', !screen.unread.some((u) => u.caseId === wroteCase));

// A blocker with a date on it returns when the date passes.
await tagged`update cases set blocked_until = now() - interval '1 hour' where id = ${wroteCase}`;
screen = await askToday();
check('a blocker past its date comes back', screen.unread.some((u) => u.caseId === wroteCase));
check('and it says it was blocked',
  screen.unread.find((u) => u.caseId === wroteCase).wasBlocked === true);

// A blocker with no date returns once it has sat longer than the window.
await tagged`update cases set blocked_until = null, blocked_at = now() - interval '2 days'
              where id = ${wroteCase}`;
screen = await askToday();
check('a blocker inside the window stays off', !screen.unread.some((u) => u.caseId === wroteCase));

await tagged`update cases set blocked_at = now() - interval '30 days' where id = ${wroteCase}`;
screen = await askToday();
check('a blocker that sat too long comes back on its own',
  screen.unread.some((u) => u.caseId === wroteCase));

// ---- demo records, and the refusal that makes them safe -------------------------------------
//
// They live on production beside the real ones because there is no second instance. The flag is
// what makes that safe, and the delete refuses anything without it rather than filtering to the
// ones that have it. A filter that is wrong once deletes somebody's transcript.
console.log('');
console.log('demo records');

const { seedDemo, clearDemo } = await import('../lib/demo.js');

// A real record, made the ordinary way, with everything a demo delete could reach.
const realOrder = await newOrder();
const realCase = await caseForAccount('acct-real-person');
await tagged`update orders set client_account_id = 'acct-real-person', case_id = ${realCase}
              where id = ${realOrder}`;
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-real-person', 'client', 'x')`;
await tagged`insert into quotes (account_id, amount_cents, scope_encrypted)
             values ('acct-real-person', 1000, 'x')`;
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${realOrder}, 'c-real-person', 'x')`;

const made = await seedDemo();
check('seeding makes a row for every path the desk has', made.length >= 7, made.length);

// More orders than scenarios: one of them is a person who bought a second session, which is
// the point of that scenario.
const marked = await tagged`select count(*)::int as n from orders where is_demo`;
check('every seeded order carries the mark', marked[0].n > made.length, marked[0]);

const unmarked = await tagged`
  select count(*)::int as n from orders where id = ${realOrder} and is_demo = false`;
check('a real order is not marked', unmarked[0].n === 1);

// The first screen sees them, which is the point of having them at all.
screen = await askToday();
check('a seeded call past the target is on the first screen',
  screen.calls.some((c) => c.hoursWaiting > 24), screen.calls.map((c) => c.hoursWaiting));
check('and a seeded message is unread on it', screen.unread.length > 0);

const cleared = await clearDemo();
check('clearing removes every demo order', cleared.orders === marked[0].n, [cleared, marked[0]]);

const leftMarked = await tagged`select count(*)::int as n from orders where is_demo`;
check('and none are left', leftMarked[0].n === 0, leftMarked[0]);

// The property that matters. Everything real is untouched.
const realLeft = await tagged`select count(*)::int as n from orders where id = ${realOrder}`;
check('the real order survives', realLeft[0].n === 1, realLeft[0]);
const realCaseLeft = await tagged`select count(*)::int as n from cases where id = ${realCase}`;
check('the real case survives', realCaseLeft[0].n === 1);
const realSaid = await tagged`
  select count(*)::int as n from messages where account_id = 'acct-real-person'`;
check('their messages survive', realSaid[0].n === 1, realSaid[0]);
const realQuoted = await tagged`
  select count(*)::int as n from quotes where account_id = 'acct-real-person'`;
check('their quotes survive', realQuoted[0].n === 1);
const realCalls = await tagged`
  select count(*)::int as n from calls where order_id = ${realOrder}`;
check('their call survives', realCalls[0].n === 1);

// Seeding twice does not collide on a reference or an account.
const secondRun = await seedDemo();
check("seeding twice works", secondRun.length === made.length, secondRun.length);
await clearDemo();

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
