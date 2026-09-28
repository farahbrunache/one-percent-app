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
await tagged`update orders set decision = 'no-go', decided_at = now(),
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
// people are being ranked. The column is `decision` now, and the statement that gets there
// runs on every cold start, so it has to be safe on a database that already has the new
// name and on one that still has the old.
//
// This puts the old name back, runs the statement, and checks the data came through. Then
// it runs it again to prove a second pass does nothing.
console.log('the column that was called assessment');

const RENAME = `
  do $$
  begin
    if exists (
      select 1 from information_schema.columns
      where table_name = 'orders' and column_name = 'assessment'
    ) and not exists (
      select 1 from information_schema.columns
      where table_name = 'orders' and column_name = 'decision'
    ) then
      alter table orders rename column assessment to decision;
      alter table orders rename column assessed_at to decided_at;
    end if;
  end $$;
`;

const renamed = await newOrder();
await tagged`update orders set decision = 'go', decided_at = now() where id = ${renamed}`;

await pg.query('alter table orders rename column decision to assessment');
await pg.query('alter table orders rename column decided_at to assessed_at');
await pg.query(RENAME);

const columns = await tagged`
  select column_name from information_schema.columns
   where table_name = 'orders'
     and column_name in ('assessment', 'assessed_at', 'decision', 'decided_at')
   order by column_name`;
check('the old names are gone and the new ones are there',
  columns.map((c) => c.column_name).join(',') === 'decided_at,decision',
  columns.map((c) => c.column_name));

const carried = await tagged`select decision, decided_at from orders where id = ${renamed}`;
check('and what was in it came across',
  carried[0].decision === 'go' && carried[0].decided_at !== null, carried[0]);

await pg.query(RENAME);
const again = await tagged`select decision from orders where id = ${renamed}`;
check('running it a second time changes nothing', again[0].decision === 'go');

console.log('the desk can read what it reads');
await tagged`
  select o.id, o.reference_code, o.decision, o.decided_at, o.status,
         o.recommendations_encrypted, o.recommendations_written_at,
         o.client_account_id, o.approved_as_client_at, o.first_customer_at,
         o.session_starts, o.first_started_at,
         exists (select 1 from calls c
                  where c.order_id = o.id and c.record_encrypted is null
                    and c.transcript_encrypted is not null) as record_missing
    from orders o limit 1`;
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

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
