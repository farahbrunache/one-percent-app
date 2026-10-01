// The things to do under a milestone, and the date they come back on.
//
// Its own file: db-screens.test.mjs is near its size limit, and this is one subject. Everything
// runs through the endpoint rather than against the tables, because the chain a request has to
// walk -- order, plan in force, milestone, action -- is the part worth checking, and a test
// that writes the rows itself proves nothing about it.

import { check, db, failureCount, tagged } from './harness.mjs';

await db.ensureSchema();

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
const { signSession } = await import('../lib/crypto.js');
const { Readable } = await import('node:stream');
const deskEndpoint = (await import('../api/desk.js')).default;
const { nextDueAt } = await import('../lib/desk.js');

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

console.log('');
console.log('actions, outcomes and a cadence');

// A person far enough along to have a plan: an order, a case against an account, a go, and a
// path. Everything an action hangs off.
const account = 'acct-actions-1';
const rows = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, decision, client_account_id)
  values ('h-actions', 'c-actions', 700, 'wise', 'RACTIONS01', 'confirmed', 'go', ${account})
  returning id`;
const order = Number(rows[0].id);
const caseId = await db.caseForAccount(account);
await tagged`update orders set case_id = ${caseId} where id = ${order}`;

check('a path can be set', (await press('plan', { id: order, path: 'smallest' })).status === 200);
check('and a milestone under it',
  (await press('milestone-add', { id: order, title: 'Set a rate per job' })).status === 201);

let person = await ask(`/api/desk?action=person&id=${order}`);
const step = person.milestones[0];
check('a milestone with nothing under it comes back with an empty list, not undefined',
  Array.isArray(step.actions) && step.actions.length === 0, step.actions);

// ---- adding one ------------------------------------------------------------------------
check('an action needs words', (await press('action-add', {
  id: order, milestoneId: step.id, title: '   ',
})).status === 400);
check('and a cadence it knows', (await press('action-add', {
  id: order, milestoneId: step.id, title: 'Ask the garage', cadence: 'daily',
})).status === 400);
check('a milestone under somebody else is not reachable', (await press('action-add', {
  id: order, milestoneId: step.id + 9999, title: 'Ask the garage',
})).status === 404);

check('adding one is accepted', (await press('action-add', {
  id: order, milestoneId: step.id, title: 'Ask the garage what they paid', cadence: 'weekly',
})).status === 201);
check('and one with no reminder on it', (await press('action-add', {
  id: order, milestoneId: step.id, title: 'Write the rate on a card',
})).status === 201);

person = await ask(`/api/desk?action=person&id=${order}`);
const [first, second] = person.milestones[0].actions;
check('both come back under the milestone, in the order they were added',
  person.milestones[0].actions.length === 2
  && first.title === 'Ask the garage what they paid'
  && second.title === 'Write the rate on a card', person.milestones[0].actions);
check('the one with a cadence carries a date and a label',
  first.cadence === 'weekly' && first.nextAt !== null
  && first.cadenceLabel === 'Every week', first);
check('and it is not due yet, because a week has not passed',
  first.due === false, [first.due, first.nextAt]);
// None is a real answer, not an absence. A row with no date never reaches the morning screen.
check('the one with no reminder has no date at all',
  second.cadence === 'none' && second.nextAt === null && second.due === false, second);

// ---- the morning screen ------------------------------------------------------------------
check('nothing is due yet', (await ask('/api/desk?action=today')).due.length === 0);

await tagged`update action_items set next_at = now() - interval '2 days' where id = ${first.id}`;
const today = await ask('/api/desk?action=today');
check('a date that has passed puts it on the first screen',
  today.due.length === 1 && Number(today.due[0].actionId) === first.id, today.due);
check('with the words, the step it is under, and how often it comes back',
  today.due[0].title === 'Ask the garage what they paid'
  && today.due[0].milestone === 'Set a rate per job'
  && today.due[0].cadenceLabel === 'Every week', today.due[0]);

person = await ask(`/api/desk?action=person&id=${order}`);
check('and the record says it is due rather than making the screen work it out',
  person.milestones[0].actions[0].due === true);

// ---- asked, still going --------------------------------------------------------------------
const pushed = await press('action-push', { id: order, actionId: first.id });
check('pushing it is accepted', pushed.status === 200, pushed);
check('the new date is a full cycle from today, not from the date it was due',
  Math.abs(new Date(pushed.out.nextAt).getTime() - new Date(nextDueAt('weekly')).getTime())
    < 60_000, pushed.out.nextAt);
check('so it comes off the first screen', (await ask('/api/desk?action=today')).due.length === 0);
check('an action with no reminder has no date to push',
  (await press('action-push', { id: order, actionId: second.id })).status === 409);

// ---- closing it out ------------------------------------------------------------------------
check('a status it does not know is refused',
  (await press('action-record', { id: order, actionId: first.id, status: 'finished' })).status === 400);

check('closing it out is accepted', (await press('action-record', {
  id: order, actionId: first.id, status: 'done', outcome: 'They paid 400 for the last one.',
})).status === 200);

person = await ask(`/api/desk?action=person&id=${order}`);
const closed = person.milestones[0].actions.find((a) => a.id === first.id);
check('the words are kept beside the status',
  closed.status === 'done' && closed.outcome === 'They paid 400 for the last one.'
  && closed.closedAt !== null, closed);
// A closed item has nothing left to ask about, so its date goes. This is what keeps the
// morning screen from carrying work that is finished.
check('and its date is gone', closed.nextAt === null && closed.due === false, closed);
check('a closed one cannot be pushed',
  (await press('action-push', { id: order, actionId: first.id })).status === 409);

// Dropped is not failure. Most of what gets written down stops being the right thing before
// anybody gets to it, and a list that only lets somebody finish is a list they stop writing in.
check('dropping one is accepted', (await press('action-record', {
  id: order, actionId: second.id, status: 'dropped', outcome: 'Carrying a card is not how they work.',
})).status === 200);

// Reopening puts it back on its cadence, because somebody saying they are back on something is
// ordinary and a list that cannot take it back is a list people work around.
check('reopening it is accepted', (await press('action-record', {
  id: order, actionId: first.id, status: 'open',
})).status === 200);
person = await ask(`/api/desk?action=person&id=${order}`);
const reopened = person.milestones[0].actions.find((a) => a.id === first.id);
check('and it is back on its cadence with a fresh date',
  reopened.status === 'open' && reopened.nextAt !== null && reopened.closedAt === null,
  reopened);

// ---- the trail -----------------------------------------------------------------------------
const trail = person.events.map((e) => e.kind);
check('every one of those is a line on the record',
  trail.includes('action.added') && trail.includes('action.recorded')
  && trail.includes('action.asked'), trail);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
