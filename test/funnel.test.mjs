// Two funnels from one read, and the one figure on the desk that is typed rather than counted.
//
// The rows that matter here are the cumulative ones. The method funnel already had this bug once:
// a row that was not a subset of the row above it made the rate under it meaningless, because
// somebody could appear in the lower row without appearing in the higher one. The selling rows are
// built the same way and are checked the same way.
//
// The typed row is checked for the thing a typed row gets wrong: a figure that is absent reading
// as zero, which is a claim rather than the absence of one.

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

const cookie = () => `op_session=${signSession('admin-1')}`;

async function read() {
  const res = fakeRes();
  await deskEndpoint({ method: 'GET', url: '/api/desk?action=funnel', headers: { cookie: cookie() } }, res);
  return JSON.parse(res.body);
}

async function write(payload) {
  const stream = Readable.from([JSON.stringify(payload)]);
  const req = {
    method: 'POST',
    url: '/api/desk?action=funnel-pool',
    headers: { cookie: cookie(), 'content-type': 'application/json' },
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

const row = (data, key) => data.selling.stages.find((s) => s.key === key);

console.log('');
console.log('getting to a call, and what it led to');

// ---- the typed row, before anybody types in it ------------------------------------------
let data = await read();
check('the list size is absent rather than zero', row(data, 'pool').count === null,
  row(data, 'pool'));
check('and it says it is typed', row(data, 'pool').entered === true);
check('the row under an absent one has no rate', row(data, 'called').rate === null,
  row(data, 'called'));

// ---- a call, a quote answered, work handed over -----------------------------------------
const made = await tagged`insert into cases (account_id) values ('acct-funnel') returning id`;
const caseId = Number(made[0].id);
const orders = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, case_id, client_account_id)
  values ('h-fn', 'c-fn', 700, 'wise', 'FUNNEL0001', 'confirmed', ${caseId}, 'acct-funnel')
  returning id`;
const id = Number(orders[0].id);
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${id}, 'c-fn-1', ${encrypt('Agent: What do you do?\nCaller: I paint.')})`;

data = await read();
check('one call shows in the row under the list', row(data, 'called').count === 1, data.selling);
check('nothing answered a quote yet', row(data, 'answered').count === 0);

await tagged`
  insert into quotes (account_id, amount_cents, scope_encrypted, status, answered_at)
  values ('acct-funnel', 20000, ${encrypt('a price list')}, 'agreed', now())`;
data = await read();
check('answering a quote shows', row(data, 'answered').count === 1, data.selling);
check('and the rate against the call is a hundred', row(data, 'answered').rate === 100);
check('nothing handed over yet', row(data, 'delivered').count === 0);

await tagged`
  insert into projects (case_id, title_encrypted, state, delivered_at)
  values (${caseId}, ${encrypt('the price list')}, 'done', now())`;
data = await read();
check('work handed over shows', row(data, 'delivered').count === 1, data.selling);

// ---- the rows stay subsets --------------------------------------------------------------
//
// Somebody who answered a quote and had work delivered but never called is not somebody this
// funnel reached. Counting them would put a person in a lower row who is in no row above it,
// which is what makes a rate a rate.
const other = await tagged`insert into cases (account_id) values ('acct-nocall') returning id`;
const otherCase = Number(other[0].id);
await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, case_id, client_account_id)
  values ('h-fn2', 'c-fn2', 700, 'wise', 'FUNNEL0002', 'confirmed', ${otherCase}, 'acct-nocall')`;
await tagged`
  insert into quotes (account_id, amount_cents, scope_encrypted, status, answered_at)
  values ('acct-nocall', 15000, ${encrypt('something else')}, 'agreed', now())`;
await tagged`
  insert into projects (case_id, title_encrypted, state, delivered_at)
  values (${otherCase}, ${encrypt('something else')}, 'done', now())`;

data = await read();
check('a quote answered by somebody who never called is not counted',
  row(data, 'answered').count === 1, data.selling);
check('nor is work handed over to them', row(data, 'delivered').count === 1, data.selling);

// ---- one person, two sessions -----------------------------------------------------------
const second = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status, case_id, client_account_id)
  values ('h-fn3', 'c-fn3', 700, 'wise', 'FUNNEL0003', 'confirmed', ${caseId}, 'acct-funnel')
  returning id`;
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${Number(second[0].id)}, 'c-fn-2', ${encrypt('Agent: Again.')})`;
data = await read();
check('somebody who bought twice counts once', row(data, 'called').count === 1, data.selling);

// ---- typing the list size ----------------------------------------------------------------
const set = await write({ pool: '170' });
check('the list size saves', set.status === 200 && set.out.pool === 170, set);
data = await read();
check('and it reads back on the chart', row(data, 'pool').count === 170);
check('the call row now has a rate against it', row(data, 'called').rate === 1,
  row(data, 'called'));

const bad = await write({ pool: '12 people' });
check('anything but digits is refused', bad.status === 400, bad);
check('and it says what to type',
  /digits/.test(bad.message || bad.out?.error || ''), bad.message || bad.out?.error);
data = await read();
check('the refusal changed nothing', row(data, 'pool').count === 170);

const cleared = await write({ pool: '' });
check('empty takes the row off', cleared.status === 200 && cleared.out.pool === null, cleared);
data = await read();
check('and it is absent again rather than zero', row(data, 'pool').count === null);

// ---- the method funnel is untouched ------------------------------------------------------
check('the six rows are still there', data.stages.length === 6, data.stages.length);
check('and they start at the call', data.stages[0].key === 'called', data.stages[0]);

// ---- adding one a day ---------------------------------------------------------------------
console.log('adding one');
await write({ pool: '' });
let added = await write({ add: 1 });
check('adding to an empty list starts it at one', added.out.pool === 1 && added.out.before === null, added);
await write({ pool: '170' });
added = await write({ add: 1 });
check('adding one goes up by one', added.out.pool === 171 && added.out.before === 170, added);
check('and the funnel reads the new figure', row(await read(), 'pool').count === 171);
check('undo puts the figure back', (await write({ pool: String(added.out.before) })).out.pool === 170);
check('only one at a time', (await write({ add: 5 })).status === 400);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
