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

// More orders than order scenarios: one of them is a person who bought a second session, which
// is the point of that scenario. The seeder also reports things that are not orders -- what it
// costs to run is one row of its own -- so the comparison is against the entries that are.
const scenarios = made.filter((row) => /^DEMO\d/.test(row.reference)).length;
const marked = await tagged`select count(*)::int as n from orders where is_demo`;
check('every seeded order carries the mark', marked[0].n > scenarios,
  { orders: marked[0].n, scenarios });

const lines = await tagged`select count(*)::int as n from cost_lines where is_demo`;
check('and what it costs to run is seeded too, so the cost screen has something to add up',
  lines[0].n === 3, lines[0]);

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

// ---- a quote they answered -----------------------------------------------------------------
//
// The morning screen asked two questions -- new calls, unread messages -- and an answered quote
// is neither, so somebody who had agreed to pay sat behind a screen saying nothing was waiting.
// Reported from production against a real client who asked for a change.
console.log('');
console.log('a quote they answered');

const { encrypt: seal } = await import('../lib/crypto.js');

async function quotedOrder(account, status) {
  const id = await newOrder();
  await tagged`update orders set decision = 'go', decision_at = now(),
                                 approved_as_client_at = now(),
                                 client_account_id = ${account} where id = ${id}`;
  await tagged`insert into quotes (account_id, amount_cents, scope_encrypted, status, answered_at)
               values (${account}, 50000, ${seal('Set up a way to be found.')}, ${status},
                       ${status === 'offered' ? null : new Date().toISOString()})`;
  return id;
}

const askedForChange = await quotedOrder('acct-asked-change', 'changes asked');
const agreedToPay = await quotedOrder('acct-agreed', 'agreed');
const saidNo = await quotedOrder('acct-declined', 'declined');
const stillWaiting = await quotedOrder('acct-offered', 'offered');

const clock = await askToday();
const answered = (clock.answered || []).map((r) => Number(r.id));
check('a quote they asked to change is waiting on you',
  answered.includes(askedForChange), answered);
check('so is one they agreed to', answered.includes(agreedToPay), answered);
check('one they declined is not', !answered.includes(saidNo), answered);
check('and neither is one they have not answered', !answered.includes(stillWaiting), answered);
check('the row says which answer it was',
  (clock.answered.find((r) => Number(r.id) === askedForChange) || {}).status === 'changes asked');
check('and what it was for', (clock.answered.find((r) => Number(r.id) === agreedToPay) || {}).amount === 500);

// Countering: the new quote goes out and the old one closes in the same action, so the same
// piece of work never has two live prices on it.
const quoteEndpoint = (await import('../api/desk.js')).default;
async function counter(orderIdValue, replaces) {
  const req = {
    method: 'POST', url: '/api/desk?action=quote',
    headers: { cookie: `op_session=${signSession('admin-1')}`, 'content-type': 'application/json' },
  };
  const { Readable } = await import('node:stream');
  const body = JSON.stringify({ id: orderIdValue, amount: 400, scope: 'Same work, less of it.', replaces });
  const stream = Readable.from([body]);
  Object.assign(req, { [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream) });
  let payload = null;
  const res = {
    statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; try { payload = JSON.parse(text); } catch { payload = text; } },
  };
  await quoteEndpoint(req, res);
  return { status: res.statusCode, payload };
}

const theirs = await tagged`select id, status from quotes where account_id = 'acct-asked-change'`;
const countered = await counter(askedForChange, Number(theirs[0].id));
check('countering is accepted', countered.status === 201, countered);

const after = await tagged`select id, amount_cents, status from quotes
                            where account_id = 'acct-asked-change' order by id asc`;
check('the old quote is closed', after[0].status === 'withdrawn', after.map((r) => r.status));
check('and the new one is waiting on them',
  after.length === 2 && after[1].status === 'offered' && Number(after[1].amount_cents) === 40000,
  after.map((r) => [r.status, Number(r.amount_cents)]));

const afterClock = await askToday();
check('so it is off the morning screen',
  !(afterClock.answered || []).map((r) => Number(r.id)).includes(askedForChange));

// An answer that is theirs to give cannot be closed from this end by calling it a counter.
const agreedRow = await tagged`select id from quotes where account_id = 'acct-agreed'`;
const refused = await counter(agreedToPay, Number(agreedRow[0].id));
check('an agreed quote cannot be countered away', refused.status === 409, refused);

// ---- a draft that cost money and came back with nothing --------------------------------------
//
// A job outlives the wait for it. The budget runs out on this end; the worker keeps going on
// RunPod's, and the worker is what is billed. The only draft never written down was the one
// that cost money and produced nothing, and a second press paid for a second job while the
// first was still running.
console.log('');
console.log('a draft that was paid for');

const drafts = await import('../lib/desk-drafts.js');
const { costsNow } = await import('../lib/costs.js');

const drafted = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${drafted}, ${'c-draft-' + drafted}, ${seal('Caller: I drive.')})`;

// A model that takes the job and then fails it. The job was accepted, so it was paid for, and
// it came back with nothing -- which is the draft that was never written down.
//
// Failing rather than timing out on purpose: the timeout path waits the full budget, and what
// is being checked is the record, not the clock.
let submitted = 0;
let polled = null;
globalThis.fetch = async (url) => {
  const path = String(url);
  let body;
  if (path.endsWith('/run')) {
    submitted += 1;
    body = { id: `job-${submitted}` };
  } else {
    polled = path.split('/status/')[1];
    body = { status: 'FAILED' };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

process.env.DRAFT_MODEL_A_URL = 'https://runpod.invalid/v2/fake';
process.env.DRAFT_MODEL_A_KEY = 'not-a-real-key';
process.env.DRAFT_MODEL_A_NAME = 'llama-test';

async function pressDraft() {
  const { Readable } = await import('node:stream');
  const payload = JSON.stringify({ id: drafted });
  const stream = Readable.from([payload]);
  const req = {
    method: 'POST', url: '/api/desk?action=draft',
    headers: { cookie: `op_session=${signSession('admin-1')}`, 'content-type': 'application/json' },
  };
  Object.assign(req, { [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream) });
  let out = null;
  const res = {
    statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; try { out = JSON.parse(text); } catch { out = text; } },
  };
  try {
    await drafts.writeDraft(req, res);
  } catch (error) {
    return { thrown: error };
  }
  return { out };
}

const first = await pressDraft();
check('a draft the model fails comes back as a failure', Boolean(first.thrown),
  String(first.thrown?.message || JSON.stringify(first.out)));
check('the job was submitted once', submitted === 1, submitted);
check('and the job polled is the job submitted', polled === 'job-1', polled);

const rows = await tagged`select job_id, model, finished_at, gave_up_at from drafts
                           where order_id = ${drafted}`;
check('it is written down anyway, because it cost money',
  rows.length === 1 && rows[0].job_id === 'job-1', rows);
check('with the job named, so the next press can tell what it was',
  rows[0].model === 'llama-test', rows[0]);
check('marked given up rather than finished',
  rows[0].finished_at === null && rows[0].gave_up_at !== null, rows[0]);

// ---- what a session costs to deliver ---------------------------------------------------------
//
// Cost never sets the price. This answers one question: underwater or not, and by how much. So
// what it has to get right is naming the figures it could not work out rather than counting them
// as nothing -- a screen that treats an unknown as zero reports a profit it invented.
console.log('');
console.log('what a session costs');

const costs = await import('../lib/costs.js');

check('a call record with a cost in it is read',
  costs.callCostOf(JSON.stringify({ call_cost: { combined_cost: 0.581 } })) === 0.581);
check('a record with no cost in it is unknown, not free',
  costs.callCostOf(JSON.stringify({ call_cost: {} })) === null);
check('and so is a record that is not readable',
  costs.callCostOf('not json') === null && costs.callCostOf(null) === null);

// A draft that was given up on still ran. The job outlives the wait for it, so its time is what
// it took from submitting to giving up rather than nothing.
check('a finished draft uses the seconds it reported',
  costs.draftSeconds({ seconds: 12 }) === 12);
check('a given-up draft is timed from submit to giving up',
  costs.draftSeconds({
    seconds: null,
    created_at: '2026-10-01T00:00:00Z',
    gave_up_at: '2026-10-01T00:00:45Z',
  }) === 45);
check('a draft with neither is unknown',
  costs.draftSeconds({ seconds: null, created_at: null, gave_up_at: null }) === null);

const priced = costs.costOfOrder({
  id: 1, reference: 'X', isDemo: false, paid: true,
  calls: [{ record: JSON.stringify({ call_cost: { combined_cost: 0.5 } }), hasRecord: true }],
  drafts: [{ seconds: 10 }],
}, 0.01);
check('a session adds its call and its drafting against the seven',
  priced.calls === 0.5 && priced.drafts === 0.1 && priced.spent === 0.6
  && priced.tookIn === 7 && Math.abs(priced.left - 6.4) < 1e-9, priced);
check('and nothing is unknown when both are known', priced.unknown.length === 0, priced.unknown);

const missing = costs.costOfOrder({
  id: 2, reference: 'Y', isDemo: false, paid: true,
  calls: [{ record: null, hasRecord: false }],
  drafts: [{ seconds: 30 }],
}, null);
check('a call with no record kept is named, not counted as free',
  missing.calls === 0 && missing.unknown.some((line) => /no record kept/.test(line)),
  missing.unknown);
check('and unpriced drafting says how many seconds went unpriced',
  missing.drafts === 0 && missing.draftedSeconds === 30
  && missing.unknown.some((line) => /30 seconds/.test(line)), missing.unknown);

// An order nobody paid for took in nothing, which is not the same as a free session.
const unpaid = costs.costOfOrder({
  id: 3, reference: 'Z', isDemo: false, paid: false, calls: [], drafts: [],
}, 0.01);
check('an unpaid order took in nothing', unpaid.tookIn === 0 && unpaid.left === 0, unpaid);

// Against the database, so the query and the arithmetic are checked together. The rate is a
// line now rather than a setting, because the owner edits it from a phone and the settings
// store needs a laptop.
await tagged`insert into cost_lines (name, amount_cents, share_percent, every)
             values ('Drafting worker', 1, 100, 'draft-second')`;

const costed = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted, record_encrypted)
             values (${costed}, ${'c-cost-' + costed}, ${seal('x')},
                     ${seal(JSON.stringify({ call_cost: { combined_cost: 0.581 } }))})`;
await tagged`insert into drafts (order_id, slot, model, job_id, seconds, finished_at)
             values (${costed}, 'A', 'm', 'j-cost', 20, now())`;

const now = await costsNow();
const mine = now.orders.find((o) => o.id === costed);
check('the screen prices a real order from the database',
  Math.abs(mine.spent - (0.581 + 0.2)) < 1e-9, mine);
check('it says nothing is listed monthly rather than counting it as nothing',
  now.monthlyFixed === null
  && now.unknown.some((line) => /Nothing is listed as a monthly cost/.test(line)), now.unknown);

// A share is the whole point of the list: one tool bought once, used across three things,
// carries a third of its price here.
check('a line shared three ways carries a third of its price',
  Math.abs(costs.lineCost({ amount_cents: 10000, share_percent: 33 }) - 33) < 1e-9);
check('a line with no share carries all of it',
  costs.lineCost({ amount_cents: 2500, share_percent: 100 }) === 25);

await tagged`insert into cost_lines (name, amount_cents, share_percent, every)
             values ('Render', 2500, 100, 'month'), ('Claude Code', 10000, 33, 'month')`;
const withLines = await costsNow();
check('the monthly total adds the shares rather than the full prices',
  Math.abs(withLines.monthlyFixed - (25 + 33)) < 1e-9, withLines.monthlyFixed);
// Seven days back from now rather than a calendar month, which is mostly empty on the fourth
// and mostly over on the twenty-eighth.
check('the window is seven days wide',
  withLines.lastSeven.days === 7 && typeof withLines.lastSeven.left === 'number',
  withLines.lastSeven);
check('a monthly bill is spread across those seven days rather than landed whole',
  Math.abs(withLines.lastSeven.fixedShare - (withLines.monthlyFixed * 7) / 30) < 1e-9,
  [withLines.lastSeven.fixedShare, withLines.monthlyFixed]);

// A demo row costs real money and brings in none. Pressing draft bills the worker whoever the
// row belongs to; nobody paid seven dollars for a row the owner made to test with.
const demoOrder = await newOrder();
await tagged`update orders set is_demo = true where id = ${demoOrder}`;
await tagged`insert into calls (order_id, call_id, transcript_encrypted, record_encrypted)
             values (${demoOrder}, ${'c-demo-' + demoOrder}, ${seal('x')},
                     ${seal(JSON.stringify({ call_cost: { combined_cost: 0.4 } }))})`;

const withDemo = await costsNow();
const demoRow = withDemo.orders.find((o) => o.id === demoOrder);
// The row shows its seven, because the screen has to look like a session to be worth testing
// against. What it counts is nothing, because nobody sent that seven.
check('a demo session shows its seven and counts none of it',
  demoRow.tookIn === 7 && demoRow.counted === 0, demoRow);

// A seeded record's figures were made up. Counting one would put money on the screen that was
// never spent, which is the same failure as counting an unknown as zero, pointing the other way.
check('an invented call cost is not a cost',
  costs.callCostOf(JSON.stringify({ demo: true, call_cost: { combined_cost: 0.58 } })) === null);
check('and a real one still is',
  costs.callCostOf(JSON.stringify({ call_cost: { combined_cost: 0.58 } })) === 0.58);
check('an invented record is known to be one',
  costs.isSeededRecord(JSON.stringify({ demo: true })) === true
  && costs.isSeededRecord(JSON.stringify({ call_cost: {} })) === false);
check('and what it cost is counted against the project',
  Math.abs(withDemo.demoSpent - 0.4) < 1e-9 && withDemo.demoSessions === 1,
  { demoSpent: withDemo.demoSpent, demoSessions: withDemo.demoSessions });
// One window says where this week landed. Eight say whether it is this week or every week.
const pattern = await costsNow();
check('eight weeks come back, newest first',
  pattern.weeks.length === 8 && pattern.weeks[0].endedDaysAgo === 0
  && pattern.weeks[7].endedDaysAgo === 49, pattern.weeks.map((w) => w.endedDaysAgo));
check('the newest week matches the seven-day window it repeats',
  Math.abs(pattern.weeks[0].tookIn - pattern.lastSeven.tookIn) < 1e-9,
  [pattern.weeks[0].tookIn, pattern.lastSeven.tookIn]);
check('a monthly bill lands on every week, because it was owed in every one',
  pattern.weeks.every((w) => Math.abs(w.fixedShare - pattern.weeks[0].fixedShare) < 1e-9),
  pattern.weeks.map((w) => w.fixedShare));
check('and a week with nothing in it is still short by what the bills cost',
  pattern.weeks[7].tookIn === 0 && pattern.weeks[7].left < 0, pattern.weeks[7]);

check('it is not in what serving clients cost',
  Math.abs(withDemo.spent - withLines.spent) < 1e-9,
  [withDemo.spent, withLines.spent]);
check('and the seven dollars is what a session took in', now.sessionPrice === 7);

// Marking a session as the owner's own, in a block of its own: this file has a lot of
// top-level names by now and a new group should not have to know all of them.
{
  // Marking a session as the owner's own. A seeded row is invented end to end; one the owner
  // buys and calls through bills the voice service for real, and that bill is the project's.
  const bought = await newOrder();
  await tagged`insert into calls (order_id, call_id, transcript_encrypted, record_encrypted)
               values (${bought}, ${'c-mine-' + bought}, ${seal('x')},
                       ${seal(JSON.stringify({ call_cost: { combined_cost: 0.9 } }))})`;

  async function pressMine(orderIdValue) {
    const { Readable } = await import('node:stream');
    const stream = Readable.from([JSON.stringify({ id: orderIdValue })]);
    const req = {
      method: 'POST', url: '/api/desk?action=mine',
      headers: { cookie: `op_session=${signSession('admin-1')}`, 'content-type': 'application/json' },
    };
    Object.assign(req, { [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream) });
    const res = {
      statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
      end() { this.writableEnded = true; },
    };
    try {
      await deskEndpoint(req, res);
      return res.statusCode;
    } catch (error) {
      return error.status;
    }
  }

  const before = (await costsNow()).orders.find((o) => o.id === bought);
  check('before marking, a real session counts its seven',
    before.counted === 7 && before.isDemo === false, before);

  check('marking it is accepted', (await pressMine(bought)) === 200);

  const nowMine = await costsNow();
  const marked = nowMine.orders.find((o) => o.id === bought);
  check('after marking, the seven shows and counts nothing',
    marked.tookIn === 7 && marked.counted === 0 && marked.isDemo === true, marked);
  check('and the real call it made still costs what it cost',
    Math.abs(marked.calls - 0.9) < 1e-9, marked.calls);
  check('counted against the project rather than against a client',
    nowMine.demoSpent >= 0.9, nowMine.demoSpent);

  check('marking it twice is refused', (await pressMine(bought)) === 409);
}

// The gap, and the floor under a price. Both arithmetic: a quote is written against what the
// work is worth to the person who needs it, and nothing here claims to know that.
{
  const closes = costs.whatClosesTheGap(
    { left: -50, sessions: 4, servingClients: 2, days: 30 }, 7, 90);
  check('the gap is stated in sessions, one quote, and money a month',
    closes.short === 50 && closes.oneQuote === 50 && closes.sessions === 8
    && Math.abs(closes.perMonth - 50) < 1e-9, closes);
  check('a session counts for what is left of the seven after serving somebody',
    Math.abs(closes.perSessionLeft - 6.5) < 1e-9, closes.perSessionLeft);
  check('with nothing served, the sessions figure is left out rather than guessed',
    costs.whatClosesTheGap({ left: -50, sessions: 0, servingClients: 0, days: 30 }, 7, 90)
      .sessions === null);
  check('and being ahead closes no gap',
    costs.whatClosesTheGap({ left: 10, sessions: 4, servingClients: 2, days: 30 }, 7, 90) === null);

  // The floor is what they cost, plus their share of running the thing, less what their seven
  // already covered. Never the price.
  const floor = costs.breakEvenFor(
    { spent: 2, counted: 7 }, 13);
  check('break-even is what is left after the session covered part of it',
    floor.breakEven === 8 && floor.theirs === 2 && floor.share === 13, floor);
  check('and it never goes below nothing',
    costs.breakEvenFor({ spent: 0.5, counted: 7 }, 0).breakEven === 0);

  // Against the database, so the query and the arithmetic are checked together.
  const quoted = await newOrder();
  await tagged`insert into calls (order_id, call_id, transcript_encrypted, record_encrypted)
               values (${quoted}, ${'c-floor-' + quoted}, ${seal('x')},
                       ${seal(JSON.stringify({ call_cost: { combined_cost: 0.5 } }))})`;
  await tagged`insert into cost_lines (name, amount_cents, share_percent, every, order_id)
               values ('Extra research', 4000, 100, 'month', ${quoted})`;

  const real = await costs.breakEvenForOrder(quoted);
  check('a line attached to one person is part of their floor',
    Math.abs(real.theirs - (0.5 + 40)) < 1e-9, real);
  check('and the screen knows whether the monthly figure is there at all',
    real.monthlyKnown === true, real);
}

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
