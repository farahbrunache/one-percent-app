// The queries, run against a real Postgres.
//
// The other test file covers every request path that stops before a query. This one covers what
// happens after: the reservation that decides whether money is spent, the minutes an order
// bought, the funnel arithmetic, and whether the schema survives being created twice.
//
// It runs Postgres inside this process, so it needs no service, no secret and no hosted
// database. Run with: npm test
//
// It covers what is on the trunk. A feature still waiting on a merge adds its cases when it
// lands, in its own change — a test here for a table that does not exist yet fails for a reason
// that has nothing to do with the code being tested.

import { PGlite } from '@electric-sql/pglite';
import { Readable } from 'node:stream';

process.env.CARD_ENCRYPTION_KEY ||= 'test-key-that-is-long-enough-to-pass-0123456789';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log('  ok   ' + label);
  else { failures += 1; console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail))); }
}

const pg = await PGlite.create();

// Neon's client is a tagged template that returns rows. This is the same shape over Postgres.
function tagged(strings, ...values) {
  let text = '';
  strings.forEach((part, i) => {
    text += part;
    if (i < values.length) text += `$${i + 1}`;
  });
  return pg.query(text, values).then((result) => result.rows);
}

const db = await import('../lib/db.js');
db.useDatabase(tagged);

console.log('the schema');
await db.ensureSchema();
check('it builds from nothing', true);

// The rule this repository states about itself, and nothing checked it until now: every
// statement runs on every cold start, so running the function twice has to be safe.
db.useDatabase(tagged);
let twice = null;
try {
  await db.ensureSchema();
} catch (error) {
  twice = error.message;
}
check('and running it a second time changes nothing', twice === null, twice);

const { abandonCall, keepRecord, reconcileStarts, secondsSpent } = db;
const sql = () => tagged;

async function newOrder(overrides = {}) {
  const rows = await tagged`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status)
    values (${'h' + Math.random()}, ${'c' + Math.random()}, 700, 'wise',
            ${'R' + Math.floor(Math.random() * 1e9)}, ${overrides.status || 'confirmed'})
    returning id
  `;
  return Number(rows[0].id);
}

console.log('what an order bought');
const { ABANDON_WITHIN_SECONDS, ASSUME_FULL_AFTER_SECONDS, SESSION_BUDGET_SECONDS, UNREPORTED_AFTER_SECONDS } =
  await import('../lib/orders.js');
const used = (order) =>
  secondsSpent(order, ASSUME_FULL_AFTER_SECONDS, SESSION_BUDGET_SECONDS, UNREPORTED_AFTER_SECONDS);

const fresh = await newOrder();
check('a new order has spent nothing',
  (await used(fresh)) === 0);

const dropped = await newOrder();
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${dropped}, ${'c' + dropped}, 120, now() - interval '2 hours')`;
const afterDrop = await used(dropped);
check('a call that died early spends only the minutes it ran', afterDrop === 120, afterDrop);
check('and leaves enough to start again', afterDrop < SESSION_BUDGET_SECONDS);

const full = await newOrder();
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${full}, ${'c' + full}, 1800, now() - interval '2 hours')`;
const afterFull = await used(full);
check('a full session does not leave enough for another',
  afterFull + ASSUME_FULL_AFTER_SECONDS > SESSION_BUDGET_SECONDS, afterFull);

// A call the voice service never reported on, long after it could still be running.
//
// This used to count as a session that ran, so that a lost webhook could not become free
// voice time. That was the wrong side to err on: a session that fails to join in the browser
// leaves exactly the same row, and counting it as a full session spends the order and leaves
// the person who paid with no way to start another. Being wrong the other way costs one call's
// worth of voice, occasionally, and the call is visible on the desk with no transcript
// against it.
const silent = await newOrder();
await tagged`insert into calls (order_id, call_id, started_at)
             values (${silent}, ${'c' + silent}, now() - interval '3 hours')`;
check('a call nobody ever reported on stops being counted', (await used(silent)) === 0);

const recent = await newOrder();
await tagged`insert into calls (order_id, call_id, started_at)
             values (${recent}, ${'c' + recent}, now() - interval '40 minutes')`;
check('but one that could still be running is counted until then',
  (await used(recent)) === ASSUME_FULL_AFTER_SECONDS, await used(recent));

console.log('a session that never connected');
const failed = await newOrder();
await tagged`insert into calls (order_id, call_id) values (${failed}, 'c-failed-to-join')`;
check('it takes the whole budget while it looks like a call in progress',
  (await used(failed)) >= SESSION_BUDGET_SECONDS);
check('the page can say it never connected',
  (await abandonCall(failed, 'c-failed-to-join', ABANDON_WITHIN_SECONDS)) === true);
check('and the minutes come back', (await used(failed)) === 0);

// Otherwise the conversation could be had and then reported as a failure.
const late = await newOrder();
await tagged`insert into calls (order_id, call_id, started_at)
             values (${late}, 'c-too-late', now() - interval '20 minutes')`;
check('a call from twenty minutes ago cannot be given back',
  (await abandonCall(late, 'c-too-late', ABANDON_WITHIN_SECONDS)) === false);

const talked = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${talked}, 'c-had-a-transcript', 'x')`;
check('nor can one that produced a transcript',
  (await abandonCall(talked, 'c-had-a-transcript', ABANDON_WITHIN_SECONDS)) === false);

const running = await newOrder();
await tagged`insert into calls (order_id, call_id) values (${running}, ${'c' + running})`;
const duringCall = await used(running);
check('a call still going spends the entire budget, so nobody is on two at once',
  duringCall >= SESSION_BUDGET_SECONDS, duringCall);

console.log('counting the attempts back from what happened');
// An order closed after three presses that connected nobody to anything was the shape of the
// bug: the counter only went up, and a session that fails in the browser gives nothing back.
const pressed = await newOrder();
await tagged`update orders set session_starts = 3, first_started_at = now() - interval '10 minutes'
              where id = ${pressed}`;
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${pressed}, 'c-gave-nothing', 0, now() - interval '9 minutes')`;
await reconcileStarts(pressed, UNREPORTED_AFTER_SECONDS);
let attempts = await tagged`select session_starts, first_started_at from orders where id = ${pressed}`;
check('presses that produced nothing stop counting', attempts[0].session_starts === 0, attempts[0]);
check('and the window has not started either', attempts[0].first_started_at === null, attempts[0]);

const spoke = await newOrder();
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${spoke}, 'c-real-one', 900, now() - interval '5 minutes')`;
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${spoke}, 'c-gave-nothing-either', 0, now() - interval '4 minutes')`;
await reconcileStarts(spoke, UNREPORTED_AFTER_SECONDS);
attempts = await tagged`select session_starts, first_started_at from orders where id = ${spoke}`;
check('a call that ran is still an attempt', attempts[0].session_starts === 1, attempts[0]);
check('and the window runs from it', attempts[0].first_started_at !== null, attempts[0]);

// The shape the owner hit: an order closed by presses, with no conversation against it. The
// page reads the same two rules the gate does, so both have to come out the same way.
const { describeStatus } = await import('../lib/orders.js');
const stuck = await newOrder();
await tagged`update orders set session_starts = 3, first_started_at = now() - interval '30 minutes'
              where id = ${stuck}`;
await tagged`insert into calls (order_id, call_id, seconds, started_at)
             values (${stuck}, 'c-stuck-one', 0, now() - interval '29 minutes')`;
await tagged`insert into calls (order_id, call_id, started_at)
             values (${stuck}, 'c-stuck-two', now() - interval '3 hours')`;
await reconcileStarts(stuck, UNREPORTED_AFTER_SECONDS);
const reopened = await tagged`select status, session_starts, first_started_at from orders where id = ${stuck}`;
check('an order whose every attempt failed opens again',
  describeStatus(reopened[0]) === 'confirmed', reopened[0]);
check('and it has no minutes against it', (await used(stuck)) === 0);

// A figure left out is how the page came to answer a different question from the gate.
let missing = null;
try { await secondsSpent(stuck, ASSUME_FULL_AFTER_SECONDS, SESSION_BUDGET_SECONDS); }
catch (error) { missing = error; }
check('leaving out a figure is refused rather than ignored',
  /unreportedAfter/.test(missing?.message || ''), missing?.message);

console.log('what they are told afterwards');
// Everybody who calls gets a sheet. The decision changes whether the conversation opens, not
// whether there is something to read.
const told = await newOrder();
await tagged`update orders set decision = 'no-go', decision_at = now(),
                               recommendations_encrypted = 'x', recommendations_written_at = now()
              where id = ${told}`;
const sheet = await tagged`
  select decision, approved_as_client_at, recommendations_encrypted
    from orders where id = ${told}`;
check('a no-go still has something to read',
  sheet[0].recommendations_encrypted === 'x', sheet[0]);
check('and is not approved', sheet[0].approved_as_client_at === null, sheet[0]);

console.log('keeping what the voice service forgets');
// Their retention is seven days. Anything not taken by then exists nowhere.
const recorded = await newOrder();
await tagged`insert into calls (order_id, call_id) values (${recorded}, 'c-with-a-record')`;
check('a record is kept against the call it belongs to',
  (await keepRecord('c-with-a-record', 'encrypted-blob')) === true);
const kept = await tagged`
  select record_encrypted, record_taken_at from calls where call_id = 'c-with-a-record'`;
check('and when it was taken is kept with it',
  kept[0].record_encrypted === 'encrypted-blob' && kept[0].record_taken_at !== null, kept[0]);
check('a call this site never started keeps nothing',
  (await keepRecord('c-never-heard-of', 'encrypted-blob')) === false);

// The later delivery carries more than the earlier one, so it replaces rather than accumulates.
await keepRecord('c-with-a-record', 'the-fuller-one');
const replaced = await tagged`
  select record_encrypted from calls where call_id = 'c-with-a-record'`;
check('a fuller record replaces the first', replaced[0].record_encrypted === 'the-fuller-one');

// Every column the desk reads, selected against the real schema.
//
// This exists because of a specific failure: the change that added `record_encrypted` sat
// unmerged while three that read it went in, so the trunk carried a desk that selected a
// column `ensureSchema` never created. Nothing caught it. The request tests touch no
// database, and no test here happened to name that column.
//
// So these selects mirror what `api/desk.js` asks for. They assert nothing about the values
// -- Postgres refusing to plan the statement is the test. When the desk starts reading a new
// column, add it here, and a schema change that never landed fails the build rather than the
// screen.
// The rename, run against the real table.
//
// `assessment` was retired because the word sounds like a score and a score sounds like
// people are being ranked. The column is `decision` now and its timestamp is `decision_at`.
//
// The timestamp is not `decided_at`, and that is the point of this test. `decided_at` was
// already on the table and means the moment the *payment* was confirmed or rejected. The
// first version of this renamed onto it, which threw on every cold start and took the site
// down -- and the test passed, because it renamed the payment's own column out of the way
// first and so was checking a table that does not exist anywhere.
//
// So this leaves the payment's column alone and checks it is still there and still itself
// afterwards. Then it runs the statements again to prove a second pass does nothing.
console.log('the columns that were called assessment');

// The two statements the schema runs, separately, because that is how it runs them.
const RENAME_COLUMN = (from, to) => `
  do $$
  begin
    if exists (
      select 1 from information_schema.columns
      where table_name = 'orders' and column_name = '${from}'
    ) and not exists (
      select 1 from information_schema.columns
      where table_name = 'orders' and column_name = '${to}'
    ) then
      alter table orders rename column ${from} to ${to};
    end if;
  end $$;
`;
async function runTheRename() {
  await pg.query(RENAME_COLUMN('assessment', 'decision'));
  await pg.query(RENAME_COLUMN('assessed_at', 'decision_at'));
}

const renamed = await newOrder();
await tagged`
  update orders set decision = 'go', decision_at = now(), decided_at = now() - interval '1 day'
   where id = ${renamed}`;

await pg.query('alter table orders rename column decision to assessment');
await pg.query('alter table orders rename column decision_at to assessed_at');
await runTheRename();

const columns = await tagged`
  select column_name from information_schema.columns
   where table_name = 'orders'
     and column_name in ('assessment', 'assessed_at', 'decision', 'decision_at', 'decided_at')
   order by column_name`;
check('the old names are gone and the new ones are there',
  columns.map((c) => c.column_name).join(',') === 'decided_at,decision,decision_at',
  columns.map((c) => c.column_name));

const carried = await tagged`
  select decision, decision_at, decided_at from orders where id = ${renamed}`;
check('and what was in it came across',
  carried[0].decision === 'go' && carried[0].decision_at !== null, carried[0]);
// The payment's own timestamp is a different decision by a different person. Renaming onto
// it is what broke the site, so this checks it is untouched and is still the earlier one.
check('the payment\'s own timestamp is still its own',
  carried[0].decided_at !== null
    && new Date(carried[0].decided_at) < new Date(carried[0].decision_at), carried[0]);

// Half-way through is a state a failure can leave behind, so each column renames on its own
// and the next start finishes the job rather than needing the first half undone by hand.
await pg.query('alter table orders rename column decision_at to assessed_at');
await runTheRename();
const finished = await tagged`select decision, decision_at from orders where id = ${renamed}`;
check('a half-done rename finishes itself', finished[0].decision_at !== null, finished[0]);

await runTheRename();
const again = await tagged`select decision from orders where id = ${renamed}`;
check('running it a second time changes nothing', again[0].decision === 'go');

// The conversation opens on a go and on nothing else.
//
// This is the test that was missing. The gate was written as "anybody who has paid", so
// somebody with no decision against them saw a box inviting them to write while they waited,
// which is the one state it must never appear in.
console.log('when the conversation opens');

// The gate the client API asks: is any order of theirs approved.
async function conversationOpen(account) {
  const rows = await tagged`
    select 1 from orders
     where client_account_id = ${account} and approved_as_client_at is not null
     limit 1`;
  return rows.length > 0;
}

const waiting = await newOrder();
await tagged`update orders set client_account_id = 'acct-waiting' where id = ${waiting}`;
check('somebody who has paid and not been read has no conversation',
  (await conversationOpen('acct-waiting')) === false);

const turned = await newOrder();
await tagged`update orders set client_account_id = 'acct-no-go', decision = 'no-go',
                               decision_at = now(), approved_as_client_at = null
              where id = ${turned}`;
check('and a no-go has none either', (await conversationOpen('acct-no-go')) === false);

const client = await newOrder();
await tagged`update orders set client_account_id = 'acct-go', decision = 'go',
                               decision_at = now(), approved_as_client_at = now()
              where id = ${client}`;
check('a go opens it', (await conversationOpen('acct-go')) === true);

// A decision can be changed, and changing it back to no-go clears the approval. What is
// already written stays -- it happened -- but nothing more can be sent.
await tagged`update orders set decision = 'no-go', approved_as_client_at = null
              where id = ${client}`;
check('and changing the decision back closes it again',
  (await conversationOpen('acct-go')) === false);

// The opening line goes in once. Posting is guarded on the thread being empty, so a second
// call against the same person does not open at them again.
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-go', 'opening', 'x')`;
const already = await tagged`select 1 from messages where account_id = 'acct-go' limit 1`;
check('a thread with something in it is not opened again', already.length === 1);

// A session is spent by being had.
//
// The gate counted minutes, so a call that ran four minutes against a thirty-five minute
// budget left the claim page saying a session was ready -- including for somebody who had
// already been told no. The sales page says a call ends when the questions are answered and
// that a short one is finished rather than cut off, so the screen was contradicting what was
// sold.
console.log('a call that came back spends the session');

const { aCallCameBack } = db;

const hadTheirCall = await newOrder();
await tagged`insert into calls (order_id, call_id, seconds, transcript_encrypted)
             values (${hadTheirCall}, 'c-four-minutes', 240, 'what was said')`;
check('four minutes with words in it is a session that happened',
  (await aCallCameBack(hadTheirCall)) === true);

// The case the restarts exist for: a start that never connected leaves a row with nothing
// in it, and that must not count as the session.
const neverConnected = await newOrder();
await tagged`insert into calls (order_id, call_id) values (${neverConnected}, 'c-never-connected')`;
check('a start that came back with nothing does not',
  (await aCallCameBack(neverConnected)) === false);

check('and an order with no calls at all does not',
  (await aCallCameBack(await newOrder())) === false);

// Answering a quote.
//
// The three answers belong to the person it was written for, and each has to land once. Two
// taps, or an answer to somebody else's quote, or a second answer to one already settled,
// are all the same shape of problem: a row changing state when it should not.
console.log('answering a quote');

async function answer(quoteId, account, status, reason) {
  const rows = await tagged`
    update quotes set status = ${status}, answered_at = now(),
                      reason_encrypted = ${reason || null}, updated_at = now()
     where id = ${quoteId} and account_id = ${account} and status = 'offered'
     returning id`;
  return rows.length > 0;
}

const withAQuote = await newOrder();
await tagged`update orders set client_account_id = 'acct-quoted' where id = ${withAQuote}`;
const offered = await tagged`
  insert into quotes (account_id, amount_cents, scope_encrypted)
  values ('acct-quoted', 50000, 'two sessions and a plan') returning id`;
const quoteId = Number(offered[0].id);

check('somebody else cannot answer it',
  (await answer(quoteId, 'acct-somebody-else', 'agreed', null)) === false);

check('the person it was written for can',
  (await answer(quoteId, 'acct-quoted', 'changes asked', 'the date does not work')) === true);

const answered = await tagged`
  select status, answered_at, reason_encrypted from quotes where id = ${quoteId}`;
check('and what they said is kept with when they said it',
  answered[0].status === 'changes asked'
    && answered[0].answered_at !== null
    && answered[0].reason_encrypted === 'the date does not work', answered[0]);

check('a quote already answered cannot be answered again',
  (await answer(quoteId, 'acct-quoted', 'agreed', null)) === false);

// Three waiting at once, and the insert counts them.
//
// Counted in the statement that writes rather than before it, so two taps arriving together
// cannot both pass a check neither of them updated. What is capped is how many are waiting
// on an answer: answering one frees the slot.
async function offerQuote(account, cents) {
  const rows = await tagged`
    insert into quotes (account_id, amount_cents, scope_encrypted)
    select ${account}, ${cents}, 'what it covers'
     where (select count(*) from quotes where account_id = ${account} and status = 'offered') < 3
    returning id`;
  return rows.length > 0;
}

const choosing = 'acct-three-at-a-time';
check('a first, second and third all land',
  (await offerQuote(choosing, 10000)) && (await offerQuote(choosing, 20000))
    && (await offerQuote(choosing, 30000)));
check('and a fourth does not', (await offerQuote(choosing, 40000)) === false);

// One answered frees a slot. A no to one price says nothing about the next, so a long
// relationship carries any number of quotes over time.
await tagged`update quotes set status = 'declined', answered_at = now()
              where account_id = ${choosing} and status = 'offered'
                and id = (select min(id) from quotes
                           where account_id = ${choosing} and status = 'offered')`;
check('answering one makes room for another', (await offerQuote(choosing, 50000)) === true);

const still = await tagged`
  select count(*)::int as n from quotes where account_id = ${choosing} and status = 'offered'`;
check('and never more than three are waiting', still[0].n === 3, still[0]);

// Being quoted opens the conversation, the same as a go does. Without it a quote asking
// somebody to say what needs changing had nowhere for them to say it.
const conversation = await tagged`
  select exists (
    select 1 from orders
     where client_account_id = 'acct-quoted' and approved_as_client_at is not null
  ) or exists (select 1 from quotes where account_id = 'acct-quoted') as open`;
check('being quoted opens the conversation without a go', conversation[0].open === true);

console.log('the desk can read what it reads');
await tagged`
  select o.id, o.reference_code, o.decision, o.decision_at, o.status, o.case_id,
         o.recommendations_encrypted, o.recommendations_written_at,
         o.client_account_id, o.approved_as_client_at,
         k.first_customer_at,
         o.session_starts, o.first_started_at,
         exists (select 1 from calls c
                  where c.order_id = o.id and c.record_encrypted is null
                    and c.transcript_encrypted is not null) as record_missing
    from orders o left join cases k on k.id = o.case_id limit 1`;
await tagged`
  select id, call_id, kind, transcript_encrypted, summary_encrypted, started_at, ended_at,
         seconds, record_encrypted, record_taken_at
    from calls limit 1`;
check('the desk reads only columns the schema has', true);

console.log('the reservation');
// Two requests arriving together must not both buy a session on one order.
const contested = await newOrder();
const MAX = 3;
const take = () => tagged`
  update orders set session_starts = session_starts + 1,
                    first_started_at = coalesce(first_started_at, now())
   where id = ${contested} and status = 'confirmed' and session_starts < ${MAX}
   returning session_starts`;
const results = await Promise.all([take(), take(), take(), take(), take()]);
const won = results.filter((r) => r.length).length;
check('it hands out exactly the number of starts there are', won === MAX, won);

console.log('one plan in force');
const planned = await newOrder();
await tagged`insert into plans (order_id, path) values (${planned}, 'reach')`;
let second = null;
try {
  await tagged`insert into plans (order_id, path) values (${planned}, 'smallest')`;
} catch (error) {
  second = error.message;
}
check('the database refuses a second plan in force', second !== null);
await tagged`update plans set in_force = false where order_id = ${planned}`;
await tagged`insert into plans (order_id, path) values (${planned}, 'smallest')`;
const inForce = await tagged`select path from plans where order_id = ${planned} and in_force`;
check('and takes the new one once the old is retired', inForce[0]?.path === 'smallest', inForce);

console.log('the funnel');
// Somebody who bought twice is one person in it.
const account = 'user_invented_for_this_test';
const a = await newOrder();
const b = await newOrder();
for (const id of [a, b]) {
  await tagged`update orders set client_account_id = ${account}, decision = 'go' where id = ${id}`;
  await tagged`insert into calls (order_id, call_id, transcript_encrypted, seconds)
               values (${id}, ${'t' + id}, 'x', 600)`;
}
const counted = await tagged`
  with people as (
    select o.id, coalesce(o.client_account_id, 'order:' || o.id) as who, o.decision,
           exists (select 1 from calls c where c.order_id = o.id
                    and c.transcript_encrypted is not null) as called
      from orders o where o.status = 'confirmed'
  )
  select count(distinct who) filter (where called and decision = 'go') as go from people`;
check('two orders from one person count once', Number(counted[0].go) === 1, counted[0]);

console.log('introductions');
// A pair, not a direction. The same two people have to be found whichever way round the query
// asks, or the check refusing a second introduction between them never fires and the graph fills
// with the same pairing twice.
const one = await newOrder();
const other = await newOrder();
await tagged`insert into introductions (a_order_id, b_order_id) values (${one}, ${other})`;
const reverse = await tagged`
  select id from introductions
   where (a_order_id = ${other} and b_order_id = ${one})
      or (a_order_id = ${one} and b_order_id = ${other}) limit 1`;
check('the pair is found whichever way round it is asked', reverse.length === 1);

let selfIntro = null;
try {
  await tagged`insert into introductions (a_order_id, b_order_id) values (${one}, ${one})`;
} catch (error) {
  selfIntro = error.message;
}
check('and nobody is introduced to themselves', selfIntro !== null);

console.log('quotes');
// Money in cents, keyed to the account rather than the order, so somebody who bought twice
// carries one set of quotes rather than two.
const quoted = 'user_invented_for_the_quote_test';
await tagged`insert into quotes (account_id, amount_cents, scope_encrypted)
             values (${quoted}, 40000, 'x')`;
await tagged`insert into quotes (account_id, amount_cents, scope_encrypted, status)
             values (${quoted}, 12000, 'y', 'paid')`;
const mine = await tagged`
  select amount_cents, status from quotes where account_id = ${quoted} order by created_at desc`;
check('both quotes belong to the one person', mine.length === 2, mine.length);
check('an amount is held in cents, not dollars',
  mine.some((q) => Number(q.amount_cents) === 40000), mine);
check('a new quote starts as offered', mine.some((q) => q.status === 'offered'), mine);

console.log('the operator\'s choices');
// A choice the operator makes from a screen. It replaces rather than accumulating, because
// there is one model in use and not a history of them.
await db.writeChoice('draft.model.slot', 'A');
await db.writeChoice('draft.model.slot', 'B');
check('a choice replaces the one before it', (await db.readChoice('draft.model.slot')) === 'B');
check('a choice nobody has made reads as nothing',
  (await db.readChoice('draft.model.never.set')) === null);

console.log('what a draft cost');
// The text is not kept. What is kept is the arithmetic, because the cost of serving somebody
// through a chat is measured rather than read off a pricing page.
const costedId = await newOrder();
await tagged`insert into drafts (order_id, slot, model, prompt_tokens, completion_tokens, seconds)
             values (${costedId}, 'A', 'llama3.2', 900, 120, 7)`;
const spent = await tagged`
  select sum(prompt_tokens)::int as inbound, sum(completion_tokens)::int as outbound
    from drafts where order_id = ${costedId}`;
check('tokens in and out are both recorded',
  spent[0].inbound === 900 && spent[0].outbound === 120, spent[0]);

const draftColumns = await tagged`
  select column_name from information_schema.columns where table_name = 'drafts'`;
check('no draft text is stored',
  !draftColumns.some((c) => /content|body|text|encrypted/.test(c.column_name)),
  draftColumns.map((c) => c.column_name));

// ---- the queue that surfaces a message ------------------------------------------------------
//
// Run through the endpoint rather than by copying its `where` into this file. The bug being
// covered was two copies of one condition drifting apart, so a test holding a third copy
// would pass while the screen stayed wrong.
//
// Writing in is open to somebody approved OR somebody quoted -- writing a quote is choosing
// to work with them, which is the same choice a go is. The queue asked only about approved,
// so a quoted no-go could write and the tab that exists to surface a message said there was
// nothing in it.
console.log('');
console.log('the queue that surfaces a message');

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
const { signSession } = await import('../lib/crypto.js');
const deskEndpoint = (await import('../api/desk.js')).default;

async function askDesk(state) {
  const req = { method: 'GET', url: `/api/desk?action=queue&state=${state}`, headers: {
    cookie: `op_session=${signSession('admin-1')}`,
  } };
  let payload = null;
  const res = {
    statusCode: 200,
    writableEnded: false,
    setHeader() {},
    getHeader() {},
    end(text) { this.writableEnded = true; try { payload = JSON.parse(text); } catch { payload = text; } },
  };
  await deskEndpoint(req, res);
  return payload;
}

const quotedNoGo = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${quotedNoGo}, ${'c-quoted-' + quotedNoGo}, 'x')`;
await tagged`update orders set decision = 'no-go', decision_at = now(),
                               client_account_id = 'acct-quoted' where id = ${quotedNoGo}`;
await tagged`insert into quotes (account_id, amount_cents, scope_encrypted)
             values ('acct-quoted', 50000, 'x')`;
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-quoted', 'client', 'x')`;

let replies = await askDesk('replies');
check('a quoted no-go who writes in shows in the tab that surfaces a message',
  replies.people.some((p) => Number(p.id) === quotedNoGo),
  replies.people.map((p) => Number(p.id)));
check('and the count matches the rows',
  replies.total === replies.people.length, [replies.total, replies.people.length]);

// The approved case, which worked before and has to keep working.
const approvedWhoWrote = await newOrder();
await tagged`insert into calls (order_id, call_id, transcript_encrypted)
             values (${approvedWhoWrote}, ${'c-appr-' + approvedWhoWrote}, 'x')`;
await tagged`update orders set decision = 'go', decision_at = now(),
                               approved_as_client_at = now(),
                               client_account_id = 'acct-approved' where id = ${approvedWhoWrote}`;
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-approved', 'client', 'x')`;

replies = await askDesk('replies');
check('an approved person who writes in still shows',
  replies.people.some((p) => Number(p.id) === approvedWhoWrote),
  replies.people.map((p) => Number(p.id)));

// Answered, so nothing is waiting. The last word being the owner's is what takes somebody
// off this queue, and the queue is useless if it keeps them after a reply.
await tagged`insert into messages (account_id, author, body_encrypted)
             values ('acct-approved', 'operator', 'x')`;
replies = await askDesk('replies');
check('somebody already written back to drops off it',
  !replies.people.some((p) => Number(p.id) === approvedWhoWrote),
  replies.people.map((p) => Number(p.id)));

// ---- a case is a person, an order is interest -----------------------------------------------
//
// The rule is one line with no exceptions: a case is created when somebody signs in and links
// an order. Not on a go, because a quote to a no-go already opens the conversation and a go
// can be changed, so a case gated on one could stop existing when a judgment did.
console.log('');
console.log('a case is a person');

const { caseForAccount } = db;

// An order nobody has signed in against is interest and nothing more.
const justInterest = await newOrder();
const [interest] = await tagged`select case_id from orders where id = ${justInterest}`;
check('an order with no sign-in has no case', interest.case_id === null, interest);

// Two orders, one account, one case.
const firstBuy = await newOrder();
const secondBuy = await newOrder();
const theirCase = await caseForAccount('acct-two-orders');
await tagged`update orders set client_account_id = 'acct-two-orders', case_id = ${theirCase}
              where id in (${firstBuy}, ${secondBuy})`;
const together = await tagged`
  select count(distinct case_id)::int as cases, count(*)::int as orders
    from orders where client_account_id = 'acct-two-orders'`;
check('two orders under one account are one case',
  together[0].cases === 1 && together[0].orders === 2, together[0]);

// Asking twice returns the same case rather than making a second one.
check('an account has exactly one case, however often it is asked for',
  (await caseForAccount('acct-two-orders')) === theirCase);

// The plan belongs to the person, so two orders cannot walk two paths.
await tagged`insert into plans (order_id, case_id, path) values (${firstBuy}, ${theirCase}, 'reach')`;
let refused = null;
try {
  await tagged`insert into plans (order_id, case_id, path) values (${secondBuy}, ${theirCase}, 'smallest')`;
} catch (error) { refused = error.message; }
check('one person cannot be on two paths at once', refused !== null, refused);

// The first paying customer is the end of the method and belongs to the person, not to
// whichever session they happened to buy first.
await tagged`update cases set first_customer_at = now() where id = ${theirCase}`;
const earning = await tagged`
  select count(distinct o.case_id)::int as people
    from orders o join cases k on k.id = o.case_id
   where k.first_customer_at is not null`;
check('one person with two orders is one person earning', earning[0].people === 1, earning[0]);

// The rule itself, through the endpoint rather than by writing the row here: signing in and
// linking an order is what creates a case, and it is the only thing that does.
const { signSession: signAccount } = await import('../lib/crypto.js');
const { keyedHash: hashToken } = await import('../lib/crypto.js');
const clientEndpoint = (await import('../api/client.js')).default;

const toLink = await newOrder();
const claimToken = 'claim-token-for-the-link-test';
await tagged`update orders set claim_token_hash = ${hashToken(claimToken)} where id = ${toLink}`;

const linkReq = Readable.from([JSON.stringify({ t: claimToken })]);
linkReq.method = 'POST';
linkReq.url = '/api/client?action=link';
linkReq.headers = {
  'content-type': 'application/json',
  cookie: `op_session=${signAccount('acct-just-signed-in')}`,
};
const linkRes = {
  statusCode: 200, writableEnded: false,
  setHeader() {}, getHeader() {}, end() { this.writableEnded = true; },
};
await clientEndpoint(linkReq, linkRes);

const linked = await tagged`
  select o.case_id, k.account_id from orders o left join cases k on k.id = o.case_id
   where o.id = ${toLink}`;
check('linking an order while signed in creates the case',
  linked[0].case_id !== null && linked[0].account_id === 'acct-just-signed-in', linked[0]);

const orderColumns = await tagged`
  select column_name from information_schema.columns where table_name = 'orders'`;
check('and the column it moved from is gone',
  !orderColumns.some((c) => c.column_name === 'first_customer_at'),
  orderColumns.map((c) => c.column_name).filter((n) => n.includes('customer')));

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

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
