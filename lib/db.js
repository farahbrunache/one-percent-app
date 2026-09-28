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
  await q`alter table if exists orders add column if not exists assessment text`;
  await q`alter table if exists orders add column if not exists assessed_at timestamptz`;

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
  // One plan in force per person, enforced by the database rather than by remembering to.
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

  // The conversation, which is the channel the work actually runs through — a call is what
  // somebody buys to get here, not how they are reached afterwards.
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

  // What each draft cost. The text is not kept: it goes to the operator's reply box, and if
  // they send it, it is a message like any other. What is worth keeping is the arithmetic,
  // because the cost of serving somebody through a chat cannot be read off a pricing page.
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

  ready = true;
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
export async function secondsSpent(orderId, assumeFullAfter, budget) {
  const rows = await sql()`
    select coalesce(sum(
      case
        when seconds is not null then seconds
        when started_at < now() - ${assumeFullAfter} * interval '1 second' then ${assumeFullAfter}
        else ${budget}
      end
    ), 0)::int as used
      from calls where order_id = ${orderId}
  `;
  return Number(rows[0]?.used || 0);
}

export async function findByClaimTokenHash(hash) {
  const rows = await sql()`
    select id, card_amount_cents, payment_method, reference_code, status, reject_reason,
           session_starts, first_started_at, created_at, decided_at, client_account_id
      from orders
     where claim_token_hash = ${hash}
     limit 1
  `;
  return rows[0] || null;
}
