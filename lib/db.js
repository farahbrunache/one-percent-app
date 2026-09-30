// Database access for the checkout. One table for orders, one for rate limiting.
//
// Nothing here stores a name, an address, a phone number or anything else that identifies a
// person. An order is a gift card and a claim token, and that is all it ever is.

import { neon } from '@neondatabase/serverless';
import { keyedHash } from './crypto.js';

let cachedSql = null;

export function sql() {
  if (!cachedSql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. It is the Neon connection string, and it goes in the ' +
          'service settings in the Render dashboard.',
      );
    }
    cachedSql = neon(url);
  }
  return cachedSql;
}

// The seam the tests use. They run against a real Postgres inside the test process rather than a
// hosted one, so every query in this repository is exercised as Postgres actually parses it
// instead of being argued about in a pull request.
//
// Nothing in the app calls this. Production reaches sql() and gets Neon, and no setting or
// environment can route it anywhere else — the only way here is to import this and call it.
export function useDatabase(tagged) {
  cachedSql = tagged;
  ready = false;
}

// Called by every endpoint before its first query. Creating the tables on demand means there
// is no migration step for somebody working from a phone to run.
let ready = false;
export async function ensureSchema() {
  if (ready) return;
  const q = sql();
  await q`
    create table if not exists orders (
      id                    bigserial primary key,
      claim_token_hash      text        not null unique,
      card_code_hash        text        not null,
      card_amount_cents     integer     not null,
      card_code_encrypted   text,
      status                text        not null default 'pending',
      reject_reason         text,
      created_at            timestamptz not null default now(),
      decided_at            timestamptz
    )
  `;
  // Added when payment stopped being gift cards only. A transfer carries no code, so the
  // reference is what the sender puts in the note and what the owner matches against.
  await q`alter table if exists orders add column if not exists payment_method text`;
  await q`alter table if exists orders add column if not exists reference_code text`;
  await q`alter table if exists orders alter column card_code_hash drop not null`;
  await q`create unique index if not exists orders_reference_code_idx on orders (reference_code)`;

  // A session that drops must not burn what somebody paid for, so a confirmed order opens a
  // small number of times inside a short window rather than exactly once.
  await q`alter table if exists orders add column if not exists session_starts integer not null default 0`;
  await q`alter table if exists orders add column if not exists first_started_at timestamptz`;

  // Who the session belongs to, once they have signed in and shown their claim link, and
  // whether the owner has read the call and taken them on. Two separate facts: somebody can
  // be linked and not yet approved, which is most of the time between the call and the
  // review, and the screen has to be able to say so rather than guess.
  await q`alter table if exists orders add column if not exists client_account_id text`;
  await q`alter table if exists orders add column if not exists approved_as_client_at timestamptz`;

  // What the caller is told after their call, and it is the same kind of thing whichever way the
  // decision went. Everybody gets recommendations. Nobody gets a verdict.
  //
  // Encrypted, because it names what somebody said about their own trade and what they are
  // short of. Written by the operator, read by one person.
  await q`alter table if exists orders add column if not exists recommendations_encrypted text`;
  await q`alter table if exists orders add column if not exists recommendations_written_at timestamptz`;
  await q`create index if not exists orders_client_account_idx on orders (client_account_id)`;

  await q`update orders set payment_method = 'amazon' where payment_method is null and card_code_hash is not null`;

  // From the access-code era, when a session was opened by speaking six digits down a phone
  // line. Guarded, because this whole function runs on every cold start and a plain update
  // reading a column it has already dropped fails every time after the first.
  await q`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'orders' and column_name = 'access_code_uses'
      ) then
        update orders set session_starts = access_code_uses where session_starts = 0;
        update orders set first_started_at = access_code_first_used_at where first_started_at is null;
      end if;
    end $$;
  `;
  await q`alter table if exists orders drop column if exists access_code_uses`;
  await q`alter table if exists orders drop column if exists access_code_first_used_at`;
  await q`alter table if exists orders drop column if exists access_code_used_at`;
  await q`alter table if exists orders drop column if exists card_brand`;
  await q`create index if not exists orders_status_idx on orders (status, created_at desc)`;
  await q`create unique index if not exists orders_card_code_hash_idx on orders (card_code_hash)`;
  // Reading a call and deciding is not the same act as confirming the payment, and the two
  // can disagree: a paid session whose call says this is not the right help is a confirmed
  // order with a no-go on it. `approved_as_client_at` keeps meaning exactly what it meant —
  // the moment of a go — so nothing that already reads it has to change.
  // Named `decision`, because that is what it holds: go or no-go, made by somebody who read
  // the call. It was `assessment`, and that word was retired -- an assessment sounds like a
  // score and a score sounds like people are being ranked, and nobody here is ranked.
  //
  // Renamed rather than left alone because the internal name is what the next person writing
  // a screen copies. It never reached a caller, and the way it would have is somebody seeing
  // the column and typing the word into a heading.
  //
  // The timestamp is `decision_at` rather than `decided_at`, because `decided_at` was taken.
  // It is on the table above and it means the moment the *payment* was confirmed or
  // rejected, which is a different decision by a different person about a different thing.
  //
  // Renaming onto it threw on every cold start, which took the site down, and on a database
  // where the rename had never run it would have been worse than a failure -- the desk would
  // have read the payment's timestamp and shown it as the moment somebody's call was
  // decided, with nothing to say anything was wrong.
  //
  // Each column is renamed in its own guarded statement rather than both in one, so a
  // database left half-way through by a failure finishes the job on the next start instead
  // of needing the first half undone by hand.
  await q`
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
      end if;
    end $$;
  `;
  await q`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'orders' and column_name = 'assessed_at'
      ) and not exists (
        select 1 from information_schema.columns
        where table_name = 'orders' and column_name = 'decision_at'
      ) then
        alter table orders rename column assessed_at to decision_at;
      end if;
    end $$;
  `;
  await q`alter table if exists orders add column if not exists decision text`;
  await q`alter table if exists orders add column if not exists decision_at timestamptz`;

  // A case is a person. An order is interest.
  //
  // Somebody pays seven dollars with no account, no name, no email address and no phone
  // number, and that is deliberate: the barrier is low on purpose, and asking for nothing up
  // front is part of what says this is not a scam. So an order carries a payment, a reference
  // code, a call and the sheet written from that call, and it never becomes anything else.
  //
  // A case is created when somebody signs in and links an order -- one rule, no exceptions, so
  // no order number is ever a case number. It is not gated on a go, for two reasons. A quote
  // to a no-go already opens the conversation, because writing somebody a quote is choosing to
  // work with them the same way a go is, and a case gated on a go would leave a quoted no-go
  // with nowhere to keep their conversation or their answer to a quote. And a go can be
  // changed -- the record screen says so -- which would make a case stop existing when a
  // judgment did. A sign-in cannot be revised.
  //
  // A no-go who never returns costs nothing: no case row, no account, no contact details held.
  // That is the honest end of most orders.
  //
  // One case per account, so anything already keyed to an account -- quotes, the conversation
  // -- is already case-scoped and needs no second key.
  await q`
    create table if not exists cases (
      id                bigserial   primary key,
      account_id        text        not null unique,
      first_customer_at timestamptz,
      created_at        timestamptz not null default now()
    )
  `;
  await q`alter table if exists cases add column if not exists first_customer_at timestamptz`;
  await q`alter table if exists orders add column if not exists case_id bigint references cases (id)`;
  await q`create index if not exists orders_case_idx on orders (case_id)`;

  // The record of what happened to somebody, newest first. A reversal is another line rather
  // than an edit, so the trail stays true even when the current state changes.
  //
  // The detail is encrypted because it is written about a person by somebody who just read
  // half an hour of their life.
  await q`
    create table if not exists case_events (
      id               bigserial   primary key,
      order_id         bigint      not null references orders (id) on delete cascade,
      kind             text        not null,
      detail_encrypted text,
      created_at       timestamptz not null default now()
    )
  `;
  await q`create index if not exists case_events_order_idx on case_events (order_id, created_at desc)`;
  await q`alter table if exists case_events add column if not exists case_id bigint references cases (id)`;
  await q`create index if not exists case_events_case_idx on case_events (case_id, created_at desc)`;

  // Which of the two paths is in force. A change writes a new row and retires the old one, so
  // the path somebody was on in March is still readable in June.
  await q`
    create table if not exists plans (
      id         bigserial   primary key,
      order_id   bigint      not null references orders (id) on delete cascade,
      path       text        not null,
      in_force   boolean     not null default true,
      created_at timestamptz not null default now()
    )
  `;
  await q`create index if not exists plans_order_idx on plans (order_id, created_at desc)`;
  await q`alter table if exists plans add column if not exists case_id bigint references cases (id)`;
  await q`create index if not exists plans_case_idx on plans (case_id, created_at desc)`;
  // One plan in force per person, enforced by the database rather than by remembering to.
  // Per order while nobody has signed in, and per case once somebody has -- two orders under
  // one person are one relationship and cannot be walking two paths at once.
  await q`create unique index if not exists plans_in_force_idx on plans (order_id) where in_force`;

  // The steps under a plan. The title and the outcome are both somebody's situation in plain
  // words, so both are encrypted.
  await q`
    create table if not exists milestones (
      id                bigserial   primary key,
      plan_id           bigint      not null references plans (id) on delete cascade,
      position          integer     not null,
      title_encrypted   text        not null,
      status            text        not null default 'planned',
      outcome_encrypted text,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now()
    )
  `;
  await q`create index if not exists milestones_plan_idx on milestones (plan_id, position)`;

  // The end of the method, and the bottom row of the only funnel this product can measure.
  // METHOD.md says the relationship ends when somebody has their first paying customer; until
  // now there was nowhere to write that down, so the one outcome that matters most was the one
  // thing the database could not answer.
  await q`alter table if exists orders add column if not exists first_customer_at timestamptz`;

  // A figure written for one person, against what the work actually is. Real money — dollars
  // somebody pays for consultation — and described as such everywhere it appears.
  //
  // There are no tiers, so a quote carries no level and unlocks nothing. It records that two
  // people agreed a number for a piece of work, and its job is to still be readable months
  // later by both of them. Never make it gate a feature: that would turn a price into a
  // permission.
  //
  // It is keyed to the account rather than an order for the same reason the conversation is —
  // one person, one running relationship, however many sessions they bought.
  await q`
    create table if not exists quotes (
      id              bigserial   primary key,
      account_id      text        not null,
      amount_cents    integer     not null,
      scope_encrypted text        not null,
      status          text        not null default 'offered',
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    )
  `;
  await q`create index if not exists quotes_account_idx on quotes (account_id, created_at desc)`;
  // What the person quoted said back, and when. The status alone said what state the quote
  // reached without saying who moved it there or why, so a quote that went nowhere and one
  // that was turned down for a reason looked the same afterwards.
  await q`alter table if exists quotes add column if not exists answered_at timestamptz`;
  await q`alter table if exists quotes add column if not exists reason_encrypted text`;

  // Who was introduced to whom, and what came of it. The rolodex, not a canvas: the question it
  // answers is which two people met and whether it produced anything.
  //
  // Every row is something that happened. A match that should not happen is not recorded,
  // because nothing occurred — there is no declined state, no hold, and no field anywhere saying
  // two people should not meet. That was decided and is not to be added back.
  await q`
    create table if not exists introductions (
      id                bigserial   primary key,
      a_order_id        bigint      not null references orders (id) on delete cascade,
      b_order_id        bigint      not null references orders (id) on delete cascade,
      reason_encrypted  text,
      outcome           text        not null default 'waiting',
      outcome_encrypted text,
      made_at           timestamptz not null default now(),
      updated_at        timestamptz not null default now(),
      check (a_order_id <> b_order_id)
    )
  `;
  await q`create index if not exists introductions_a_idx on introductions (a_order_id, made_at desc)`;
  await q`create index if not exists introductions_b_idx on introductions (b_order_id, made_at desc)`;
  await q`alter table if exists introductions add column if not exists a_case_id bigint references cases (id)`;
  await q`alter table if exists introductions add column if not exists b_case_id bigint references cases (id)`;
  await q`create index if not exists introductions_a_case_idx on introductions (a_case_id, made_at desc)`;
  await q`create index if not exists introductions_b_case_idx on introductions (b_case_id, made_at desc)`;

  // A call is its own thing, not five columns on an order.
  //
  // An order can carry more than one: a session that drops and is restarted is two attempts at
  // the same conversation, and until now the second overwrote the first. And a person who comes
  // back later for another call is having a different kind of call — one inside a relationship
  // that already exists, against a plan that already exists — which is not readable at all when
  // a call is a column.
  await q`
    create table if not exists calls (
      id                   bigserial   primary key,
      order_id             bigint      not null references orders (id) on delete cascade,
      kind                 text        not null default 'intake',
      call_id              text        unique,
      transcript_encrypted text,
      summary_encrypted    text,
      started_at           timestamptz not null default now(),
      ended_at             timestamptz,
      seconds              integer
    )
  `;
  await q`create index if not exists calls_order_idx on calls (order_id, started_at desc)`;
  await q`create index if not exists calls_transcript_idx on calls (order_id) where transcript_encrypted is not null`;

  // Move what is already on the orders table across, then take the columns away. Guarded on
  // the column still existing, because this function runs on every cold start and a plain
  // select of a dropped column fails every time after the first.
  //
  // The copy is its own statement before the drops. If it throws, the drops never run and
  // nothing is lost.
  await q`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'orders' and column_name = 'transcript_encrypted'
      ) then
        insert into calls (order_id, kind, call_id, transcript_encrypted, summary_encrypted,
                           started_at, ended_at, seconds)
        select o.id, 'intake', o.call_id, o.transcript_encrypted, o.call_summary_encrypted,
               coalesce(o.first_started_at, o.created_at), o.call_ended_at, o.call_seconds
          from orders o
         where o.call_id is not null
           and not exists (select 1 from calls c where c.call_id = o.call_id);
      end if;
    end $$;
  `;
  await q`alter table if exists orders drop column if exists call_id`;
  await q`alter table if exists orders drop column if exists transcript_encrypted`;
  await q`alter table if exists orders drop column if exists call_summary_encrypted`;
  await q`alter table if exists orders drop column if exists call_ended_at`;
  await q`alter table if exists orders drop column if exists call_seconds`;

  // The conversation, and it opens on a go and only on a go.
  //
  // It was removed once and brought back, and the reason it was removed is the reason it is
  // gated now rather than gone: a box anybody who pays seven dollars can write into is a way
  // to reach one person, and the first people through it are the ones the seven dollars
  // exists to filter. Somebody undecided used to see it, which is exactly that.
  //
  // On a go it is the opposite. The decision has been made by somebody who read the call, the
  // sheet is written, and what happens next is real work: following the recommendations
  // through, and a quote when there is paid work in it. That conversation has to happen
  // somewhere.
  //
  // A thread belongs to an account rather than to an order, because it is one conversation
  // with one person however many sessions they buy over time. An order with no account linked
  // to it has no thread and cannot have one: there is nobody at the other end yet.
  await q`
    create table if not exists messages (
      id             bigserial   primary key,
      account_id     text        not null,
      author         text        not null,
      body_encrypted text        not null,
      created_at     timestamptz not null default now()
    )
  `;
  await q`create index if not exists messages_account_idx on messages (account_id, created_at)`;

  await q`
    create table if not exists rate_limits (
      bucket       text        primary key,
      hits         integer     not null default 0,
      window_start timestamptz not null default now()
    )
  `;

  // Choices the operator makes from a screen, as opposed to settings, which are credentials
  // and addresses and live in the secrets store. The difference is not stylistic: a value
  // that can be written from a browser can be written by anything that gets a session, so a
  // key never lives here and this table never holds one.
  await q`
    create table if not exists settings (
      name       text        primary key,
      value      text        not null,
      changed_at timestamptz not null default now()
    )
  `;

  // What each draft cost. The text is not kept: it goes to the box the operator writes the
  // sheet in, and what they file is theirs. What is worth keeping is the arithmetic, because
  // the cost of drafting cannot be read off a pricing page.
  await q`
    create table if not exists drafts (
      id                bigserial   primary key,
      order_id          bigint      not null references orders (id) on delete cascade,
      slot              text        not null,
      model             text        not null,
      prompt_tokens     integer,
      completion_tokens integer,
      seconds           integer,
      created_at        timestamptz not null default now()
    )
  `;
  await q`create index if not exists drafts_order_idx on drafts (order_id, created_at)`;

  // Everything the voice service holds about a call, kept here because there it does not last.
  //
  // Their retention is seven days. After that the record is gone -- what the agent was
  // configured to do that day, what the call cost, how long each turn took, why it ended. The
  // transcript alone is what the work runs on, but it is not enough to answer a question about
  // a call afterwards, and it is nothing like enough to compare one call against another.
  //
  // Encrypted like the transcript, and for the same reason: it holds somebody's trade, their
  // rate, and half an hour of their life.
  await q`alter table if exists calls add column if not exists record_encrypted text`;
  await q`alter table if exists calls add column if not exists record_taken_at timestamptz`;

  // Cases, for the orders that were already linked to an account before cases existed. Every
  // statement here narrows on a null, so the first cold start does the work and every one
  // after it matches nothing -- which is the rule this file lives by, since all of it runs
  // again on every cold start.
  await q`
    insert into cases (account_id)
    select distinct client_account_id from orders where client_account_id is not null
    on conflict (account_id) do nothing
  `;
  await q`
    update orders o set case_id = c.id from cases c
     where o.client_account_id = c.account_id and o.case_id is null
  `;
  await q`
    update case_events e set case_id = o.case_id from orders o
     where e.order_id = o.id and e.case_id is null and o.case_id is not null
  `;
  await q`
    update plans p set case_id = o.case_id from orders o
     where p.order_id = o.id and p.case_id is null and o.case_id is not null
  `;
  await q`
    update introductions i set a_case_id = o.case_id from orders o
     where i.a_order_id = o.id and i.a_case_id is null and o.case_id is not null
  `;
  await q`
    update introductions i set b_case_id = o.case_id from orders o
     where i.b_order_id = o.id and i.b_case_id is null and o.case_id is not null
  `;
  await q`
    update cases c set first_customer_at = x.at
      from (select case_id, max(first_customer_at) as at from orders
             where case_id is not null and first_customer_at is not null
             group by case_id) x
     where c.id = x.case_id and c.first_customer_at is null
  `;

  // Two orders under one person could each have carried a plan in force. One person walks one
  // path, so the newest wins and the rest are retired -- which also has to happen before the
  // index below, or creating it fails and takes the site down on a cold start.
  await q`
    update plans set in_force = false
     where in_force and case_id is not null
       and id <> (select p2.id from plans p2
                   where p2.case_id = plans.case_id and p2.in_force
                   order by p2.created_at desc, p2.id desc limit 1)
  `;
  await q`
    create unique index if not exists plans_in_force_case_idx
      on plans (case_id) where in_force and case_id is not null
  `;

  // The first paying customer is the end of the method, and it belongs to the person rather
  // than to whichever order they happened to buy first. It moved to cases above; the column
  // it moved from has no readers left, so it goes.
  await q`alter table if exists orders drop column if exists first_customer_at`;

  ready = true;
}

// The case an account owns, made on first sight. This is the only place a case is created:
// linking an order to an account is what turns interest into a person.
export async function caseForAccount(accountId) {
  const rows = await sql()`
    insert into cases (account_id) values (${accountId})
    on conflict (account_id) do update set account_id = excluded.account_id
    returning id
  `;
  return Number(rows[0].id);
}

// A setting the operator owns. Absent means nothing has been chosen, which is not an error:
// the reader decides what no choice means.
export async function readChoice(name) {
  const rows = await sql()`select value from settings where name = ${name}`;
  return rows.length ? rows[0].value : null;
}

export async function writeChoice(name, value) {
  await sql()`
    insert into settings (name, value, changed_at) values (${name}, ${value}, now())
    on conflict (name) do update set value = excluded.value, changed_at = now()
  `;
}

// A fixed-window counter. Coarse on purpose: it is here to stop a script, not to be fair.
// Returns true when the request is allowed.
export async function underLimit(name, callerHash, max, windowSeconds) {
  const q = sql();
  const bucket = keyedHash(`${name}:${callerHash}`);
  const rows = await q`
    insert into rate_limits (bucket, hits, window_start)
    values (${bucket}, 1, now())
    on conflict (bucket) do update set
      hits = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then 1
        else rate_limits.hits + 1
      end,
      window_start = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then now()
        else rate_limits.window_start
      end
    returning hits
  `;
  return Number(rows[0]?.hits ?? 0) <= max;
}

// Minutes already spent against an order. A call still running counts as the whole budget, and
// a call that started long enough ago to have finished but was never heard about counts as a
// full session — a webhook that goes missing must not turn into free voice time.
// Whether a call against this order came back with words in it.
//
// A session is spent by being had, not by using up its minutes. The sales page says a call
// ends when the questions are answered and that a short call is a finished one rather than a
// cut-off one, so a conversation that ran four minutes and produced a transcript is the
// product, delivered. Counting only minutes left somebody who had their call able to start
// another on the same seven dollars -- including somebody who had already been told no.
//
// A transcript is what tells the two cases apart. A start that never connected, or dropped
// before anybody spoke, leaves a row with nothing in it, and that is the case the restarts
// exist for.
export async function aCallCameBack(orderId) {
  const rows = await sql()`
    select 1 from calls
     where order_id = ${orderId} and transcript_encrypted is not null
     limit 1
  `;
  return rows.length > 0;
}

export async function secondsSpent(orderId, assumeFullAfter, budget, unreportedAfter) {
  // Refused rather than defaulted. A missing figure here becomes a comparison against null,
  // which is neither true nor false, so the rule it belongs to quietly stops applying and the
  // answer looks reasonable while being wrong. That is what happened when one caller was
  // updated and another was not.
  for (const [name, value] of [
    ['assumeFullAfter', assumeFullAfter],
    ['budget', budget],
    ['unreportedAfter', unreportedAfter],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`secondsSpent needs ${name} as a number, and was given ${value}.`);
    }
  }

  const rows = await sql()`
    select coalesce(sum(
      case
        when seconds is not null then seconds
        -- Checked before the two guesses below, because those describe a call that may still
        -- be running and this one describes a call that cannot be.
        when started_at < now() - ${unreportedAfter} * interval '1 second' then 0
        when started_at < now() - ${assumeFullAfter} * interval '1 second' then ${assumeFullAfter}
        else ${budget}
      end
    ), 0)::int as used
      from calls where order_id = ${orderId}
  `;
  return Number(rows[0]?.used || 0);
}

// Counts the attempts back from what they produced.
//
// The order's attempt counter is written when a session starts and given back when the voice
// service refuses, but nothing gives it back when the browser fails to join -- and a counter
// that only goes up closes the order after three presses that never connected anybody to
// anything. That is what happened: an order with no conversation against it reporting that
// its sessions had been used.
//
// So the counter is derived rather than accumulated. What counts as an attempt is a call that
// exists, was not given back at zero, and is recent enough to be real. Everything else was a
// button press, and a button press is not a session.
//
// The window clock is reset with it. It exists so an order is not held open forever, and it
// should start when a session does, not when somebody first pressed a button that failed.
export async function reconcileStarts(orderId, unreportedAfter) {
  await sql()`
    update orders o set
      session_starts = coalesce(counted.attempts, 0),
      first_started_at = counted.began
    from (
      select
        count(*)::int as attempts,
        min(started_at) as began
      from calls
       where order_id = ${orderId}
         and (seconds is null or seconds > 0)
         and started_at > now() - ${unreportedAfter} * interval '1 second'
    ) as counted
    where o.id = ${orderId}
  `;
}

// Keeps what the voice service holds, before their seven days run out.
//
// Called when a call ends and again when it is analyzed, because the later event carries more,
// and from the desk, so a call made before this existed can still be caught in time.
//
// It never fails the caller. A webhook that cannot reach the voice service has still delivered
// a transcript, and refusing it would make the service retry a delivery that already landed.
export async function keepRecord(callId, record) {
  const rows = await sql()`
    update calls set record_encrypted = ${record}, record_taken_at = now()
      where call_id = ${callId}
    returning id
  `;
  return rows.length > 0;
}

// The page saying the session never connected. Only a call that started moments ago, and only
// one nothing has been written against: a call with a transcript happened, whatever the page
// believes, and a call from an hour ago is not one somebody is failing to join right now.
export async function abandonCall(orderId, callId, withinSeconds) {
  const rows = await sql()`
    update calls set seconds = 0, ended_at = now()
      where order_id = ${orderId}
        and call_id = ${callId}
        and seconds is null
        and transcript_encrypted is null
        and started_at > now() - ${withinSeconds} * interval '1 second'
    returning id
  `;
  return rows.length > 0;
}

export async function findByClaimTokenHash(hash) {
  const rows = await sql()`
    select id, card_amount_cents, payment_method, reference_code, status, reject_reason,
           session_starts, first_started_at, created_at, decided_at, client_account_id,
           recommendations_written_at
      from orders
     where claim_token_hash = ${hash}
     limit 1
  `;
  return rows[0] || null;
}
