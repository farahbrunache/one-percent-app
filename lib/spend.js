// Writing down money that was spent, once, where it will outlive the row it was spent on.
//
// Every line names its source, and the source is unique. A sweep that keeps the same call
// record twice, or a backfill run on every cold start, adds nothing the second time -- which is
// the only way a ledger stays right when the thing writing to it runs again.

import { sql } from './db.js';
import { decrypt } from './crypto.js';
import { callCostOf, draftSeconds, isSeededRecord } from './costs.js';

// `at` is when the money was spent rather than when this noticed, because the cost screen reads
// by date and a backfill would otherwise pile a year of spending onto today.
export async function recordSpend({ kind, source, amountCents, seconds, wasDemo, orderId, at }) {
  await sql()`
    insert into spend (kind, source, amount_cents, seconds, was_demo, order_id, at)
    values (${kind}, ${source}, ${amountCents ?? null}, ${seconds ?? null},
            ${Boolean(wasDemo)}, ${orderId ?? null}, ${at || new Date().toISOString()})
    on conflict (source) do nothing
  `;
}

// A figure that settles rather than happening.
//
// Every other line here is a fact: a call ended, a draft ran, and what it cost does not change
// afterwards, which is why those are written once and a repeat adds nothing. A day of billing is
// not that. Runpod runs about an hour behind and today's number keeps growing until the day is
// over, so the row for today has to be allowed to move.
//
// Still keyed by source, so a day is one row however many times it is read.
export async function recordMeteredSpend({ kind, source, amountCents, wasDemo, at }) {
  await sql()`
    insert into spend (kind, source, amount_cents, was_demo, at)
    values (${kind}, ${source}, ${amountCents}, ${Boolean(wasDemo)}, ${at})
    on conflict (source) do update set amount_cents = excluded.amount_cents
  `;
}

// One call's charge, written the moment its record lands. Takes the call back out of the
// database rather than the record it was handed, because what is handed over is encrypted and
// the cost is inside it.
//
// A record kept twice writes one line: the line names the call it came from.
export async function noteCallSpend(callId) {
  const [kept] = await sql()`
    select c.id, c.record_encrypted, c.started_at, o.id as order_id, o.is_demo
      from calls c join orders o on o.id = c.order_id
     where c.call_id = ${callId}
  `;
  if (!kept?.record_encrypted) return;
  let held;
  try {
    held = decrypt(kept.record_encrypted);
  } catch {
    return;
  }
  if (isSeededRecord(held)) return;
  const cost = callCostOf(held);
  if (cost === null) return;
  await recordSpend({
    kind: 'call',
    source: `call:${kept.id}`,
    amountCents: Math.round(cost * 100),
    wasDemo: kept.is_demo,
    orderId: Number(kept.order_id),
    at: kept.started_at,
  });
}

// Everything already charged for before there was a ledger, and anything a failed write missed
// since. Runs on every cold start and does nothing after the first, because each line carries
// the id of what it came from.
//
// A seeded call's figures were invented, so it is left out: nobody was charged, and a ledger
// that carries made-up money is worse than one missing some.
export async function backfillSpend() {
  const calls = await sql()`
    select c.id, c.record_encrypted, c.started_at, o.id as order_id, o.is_demo
      from calls c join orders o on o.id = c.order_id
     where c.record_encrypted is not null
       and not exists (select 1 from spend s where s.source = 'call:' || c.id)
  `;
  for (const call of calls) {
    let held;
    try {
      held = decrypt(call.record_encrypted);
    } catch {
      continue;
    }
    if (isSeededRecord(held)) continue;
    const cost = callCostOf(held);
    if (cost === null) continue;
    await recordSpend({
      kind: 'call',
      source: `call:${call.id}`,
      amountCents: Math.round(cost * 100),
      wasDemo: call.is_demo,
      orderId: Number(call.order_id),
      at: call.started_at,
    });
  }

  const drafts = await sql()`
    select d.id, d.seconds, d.created_at, d.gave_up_at, o.id as order_id, o.is_demo
      from drafts d join orders o on o.id = d.order_id
     where not exists (select 1 from spend s where s.source = 'draft:' || d.id)
  `;
  for (const row of drafts) {
    const seconds = draftSeconds(row);
    if (seconds === null) continue;
    await recordSpend({
      kind: 'draft',
      source: `draft:${row.id}`,
      seconds,
      wasDemo: row.is_demo,
      orderId: Number(row.order_id),
      at: row.created_at,
    });
  }
}
