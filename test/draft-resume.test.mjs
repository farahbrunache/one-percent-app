// A draft that timed out is still running, and pressing again picks it up.
//
// This is the case that cost real money. The budget stops the polling here; it does not stop the
// worker, and the worker is what is billed. The row carries the job's name at submit so a second
// press can reconnect -- and that could never happen, because every failure marked the row given
// up and the resume query wants a row that is not.
//
// So a cold start timed out, the row closed, pressing again submitted a second job and paid for
// it while the first was still running. Both of these are checked here.

import { check, db, failureCount, tagged } from './harness.mjs';

await db.ensureSchema();

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
process.env.DRAFT_MODEL_A_NAME = 'a-test-model';
process.env.DRAFT_MODEL_A_URL = 'https://api.runpod.ai/v2/a-test-endpoint';
process.env.DRAFT_MODEL_A_KEY = 'a-test-key';

const { signSession, encrypt } = await import('../lib/crypto.js');
const { Readable } = await import('node:stream');
const deskEndpoint = (await import('../api/desk.js')).default;

// The budget is 45 seconds and the poll is 1.5, so two timeouts would cost this test a minute and
// a half of waiting for a clock. The wait between polls is skipped and the clock is moved on by
// what was skipped, so the budget runs out in the same number of polls and none of them sleep.
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;
let skipped = 0;
Date.now = () => realNow() + skipped;
globalThis.setTimeout = (run, ms, ...rest) => {
  if (ms === 1_500) {
    skipped += ms;
    return realSetTimeout(run, 0);
  }
  return realSetTimeout(run, ms, ...rest);
};

// What the pretend worker does, swapped per case. `submits` counts jobs actually started, which
// is the figure the money follows.
let submits = 0;
let statusAnswer = () => ({ status: 'IN_QUEUE' });
const realFetch = globalThis.fetch;
globalThis.fetch = async (address, init) => {
  const url = String(address);
  if (url.endsWith('/run') && init?.method === 'POST') {
    submits += 1;
    return { ok: true, text: async () => JSON.stringify({ id: `job-${submits}` }) };
  }
  if (url.includes('/status/')) {
    const job = url.slice(url.lastIndexOf('/') + 1);
    return { ok: true, text: async () => JSON.stringify(statusAnswer(job)) };
  }
  return realFetch(address, init);
};

function fakeRes() {
  return {
    statusCode: 200, writableEnded: false, body: null,
    setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; this.body = text; },
  };
}

async function pressDraft(id) {
  const stream = Readable.from([JSON.stringify({ id, of: 'sheet' })]);
  const req = {
    method: 'POST',
    url: '/api/desk?action=draft',
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

const rows = await tagged`
  insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                      reference_code, status)
  values ('h-draft', 'c-draft', 700, 'wise', 'RDRAFT0001', 'confirmed')
  returning id`;
const order = Number(rows[0].id);
// A transcript to draft from. Invented words -- a real one is somebody's half hour.
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${order}, 'c-draft-1', ${encrypt('Agent: What do you do?\nCaller: I drive.')})`;

console.log('');
console.log('a draft that timed out is still running');

// ---- the timeout leaves the job in flight ----------------------------------------------
statusAnswer = () => ({ status: 'IN_QUEUE' });
const first = await pressDraft(order);
check('a cold start times out', first.status === 504, first);
check('and it says the job was taken and paid for',
  /queued|paid/.test(first.message || first.out?.error || ''), first.message || first.out?.error);
check('one job was submitted', submits === 1, submits);

let row = await tagged`select id, job_id, gave_up_at, finished_at from drafts where order_id = ${order}`;
check('the row is still in flight rather than given up',
  row.length === 1 && row[0].gave_up_at === null && row[0].finished_at === null, row);
check('and it still carries the job to go back to', row[0].job_id === 'job-1', row[0].job_id);

// ---- pressing again picks the same job back up ------------------------------------------
//
// The whole point. Before, this submitted a second job and paid for it while the first was
// still running.
statusAnswer = (job) => (job === 'job-1'
  ? { status: 'COMPLETED', output: { content: 'Here is what I would do. 1. Ask for a rate per job.' } }
  : { status: 'IN_QUEUE' });

const second = await pressDraft(order);
check('pressing again gets the answer', second.status === 200, second);
check('and it submitted no second job', submits === 1, submits);

row = await tagged`select id, job_id, finished_at, seconds from drafts where order_id = ${order}`;
check('one row, finished, for one job',
  row.length === 1 && row[0].finished_at !== null && row[0].job_id === 'job-1', row);

const spend = await tagged`select source, seconds from spend where kind = 'draft'`;
check('and the worker is charged once', spend.length === 1, spend);

// ---- a job the worker ended is over -----------------------------------------------------
//
// The other half: a failure that really did end the job closes the row, so the next press does
// not keep reconnecting to something that is gone.
statusAnswer = () => ({ status: 'FAILED' });
const failed = await pressDraft(order);
check('a worker that ends the job fails the press', failed.status === 502, failed);
check('and that submitted a new job, because the first was finished', submits === 2, submits);

const closed = await tagged`
  select gave_up_at from drafts where order_id = ${order} and job_id = 'job-2'
`;
check('the failed row is closed rather than left in flight',
  closed.length === 1 && closed[0].gave_up_at !== null, closed);

// ---- the allowance is not spent reconnecting ---------------------------------------------
//
// A press that reconnects to a job already paid for is not a second draft. It used to spend one
// of the ten, so a cold start that timed out three times burned three of them.
{
  const before = await tagged`select hits from rate_limits where bucket is not null`;
  statusAnswer = () => ({ status: 'IN_QUEUE' });
  await pressDraft(order);
  const mid = await tagged`select sum(hits)::int as n from rate_limits`;
  await pressDraft(order);
  const after = await tagged`select sum(hits)::int as n from rate_limits`;
  check('reconnecting to a job in flight spends nothing',
    Number(after[0].n) === Number(mid[0].n), [before.length, mid[0].n, after[0].n]);
}

globalThis.fetch = realFetch;
globalThis.setTimeout = realSetTimeout;
Date.now = realNow;
const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
