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

  // What the session produced. Retell holds the recording and the transcript, and a dashboard
  // somewhere else is not a place the work can be done from — the owner reads this on a phone
  // and starts the next conversation from it. Encrypted at rest with everything else: a
  // transcript is somebody's trade, their rate and what is standing in their way.
  await q`alter table if exists orders add column if not exists call_id text`;
  await q`alter table if exists orders add column if not exists transcript_encrypted text`;
  await q`alter table if exists orders add column if not exists call_summary_encrypted text`;
  await q`alter table if exists orders add column if not exists call_ended_at timestamptz`;
  await q`alter table if exists orders add column if not exists call_seconds integer`;
  await q`create index if not exists orders_call_id_idx on orders (call_id)`;

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
  await q`
    create table if not exists rate_limits (
      bucket       text        primary key,
      hits         integer     not null default 0,
      window_start timestamptz not null default now()
    )
  `;
  ready = true;
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

export async function findByClaimTokenHash(hash) {
  const rows = await sql()`
    select id, card_amount_cents, payment_method, reference_code, status, reject_reason,
           session_starts, first_started_at, created_at, decided_at
      from orders
     where claim_token_hash = ${hash}
     limit 1
  `;
  return rows[0] || null;
}
