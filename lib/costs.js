// What a session costs to deliver, against what it brought in.
//
// Cost never sets the price here. A quote is written against what the work is worth to the
// person who needs it, and that is a separate judgment made on a separate screen. This answers
// one question and only one: am I underwater, and by how much.
//
// So it is built to be right rather than encouraging. Every figure says where it came from, and
// a figure that cannot be worked out says so instead of counting as zero. A cost screen that
// quietly treats an unknown as nothing is a screen that reports a profit it invented.

import { sql } from './db.js';
import { decrypt } from './crypto.js';
import { SESSION_PRICE_CENTS } from './orders.js';

// The two units a cost line comes in. A bill arrives once a month; a drafting worker is billed
// by the second it runs, so the rate is a line like any other rather than a setting somewhere
// else.
export const COST_UNITS = ['month', 'draft-second'];

export function isCostUnit(value) {
  return COST_UNITS.includes(value);
}

// What a line actually costs this product, after the shared part is taken off. A tool bought
// once and used across three things carries a third of its price here.
export function lineCost(line) {
  const share = Number(line.share_percent ?? line.sharePercent ?? 100);
  const amount = Number(line.amount_cents ?? line.amountCents ?? 0) / 100;
  if (!Number.isFinite(share) || !Number.isFinite(amount)) return 0;
  return amount * (Math.max(0, Math.min(100, share)) / 100);
}

export async function costLines() {
  const rows = await sql()`
    select id, name, amount_cents, share_percent, every, note, is_demo, created_at
      from cost_lines order by every asc, name asc
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    amount: Number(r.amount_cents) / 100,
    sharePercent: Number(r.share_percent),
    every: r.every,
    note: r.note,
    isDemo: Boolean(r.is_demo),
    costs: lineCost(r),
  }));
}

// What the voice service charged for one call, out of the record the sweep kept. The record is
// theirs and its shape is theirs, so this reads the one field it needs and treats anything else
// as a call whose cost is not known rather than as a call that was free.
export function callCostOf(record) {
  if (!record) return null;
  let held;
  try {
    held = JSON.parse(record);
  } catch {
    return null;
  }
  const cost = held?.call_cost?.combined_cost;
  return Number.isFinite(Number(cost)) ? Number(cost) : null;
}

// A draft is billed by the second the worker ran, which is why the seconds are kept. A draft
// that was given up on still ran: the job outlives the wait for it, so what it cost is the time
// from submitting to giving up rather than nothing.
export function draftSeconds(row) {
  // Null is not zero here, and Number(null) is. A draft with no seconds against it has to fall
  // through to being timed, or every unfinished one prices as free.
  if (row.seconds !== null && row.seconds !== undefined && Number.isFinite(Number(row.seconds))) {
    return Number(row.seconds);
  }
  const from = row.created_at ? new Date(row.created_at).getTime() : null;
  const to = row.gave_up_at ? new Date(row.gave_up_at).getTime() : null;
  if (!from || !to || to < from) return null;
  return Math.round((to - from) / 1000);
}

// One order, end to end. `unknown` names every figure that could not be worked out, so the
// screen can say which rather than printing a total that quietly left something out.
export function costOfOrder(order, perSecond) {
  const unknown = [];

  let calls = 0;
  for (const call of order.calls) {
    const cost = callCostOf(call.record);
    if (cost === null) {
      unknown.push(call.hasRecord ? 'a call record with no cost in it' : 'a call with no record kept');
      continue;
    }
    calls += cost;
  }

  let drafts = 0;
  let draftedSeconds = 0;
  for (const row of order.drafts) {
    const seconds = draftSeconds(row);
    if (seconds === null) {
      unknown.push('a draft with no time against it');
      continue;
    }
    draftedSeconds += seconds;
    if (perSecond !== null) drafts += seconds * perSecond;
  }
  if (draftedSeconds > 0 && perSecond === null) {
    unknown.push(`No line says what a second of drafting costs, so ${draftedSeconds} seconds of `
      + 'it is not priced');
  }

  const spent = calls + drafts;
  const tookIn = order.paid ? SESSION_PRICE_CENTS / 100 : 0;
  return {
    id: order.id,
    reference: order.reference,
    isDemo: order.isDemo,
    paid: order.paid,
    tookIn,
    calls,
    drafts,
    draftedSeconds,
    spent,
    left: tookIn - spent,
    unknown,
  };
}

// This calendar month, which is the window the bills arrive on. Per session says what a price
// has to clear; this says whether the thing pays for itself.
async function thisMonth(monthlyFixed, perSecond) {
  const [row] = await sql()`
    select
      (select coalesce(count(*), 0)::int from orders
        where status = 'confirmed' and created_at >= date_trunc('month', now())) as sessions,
      (select coalesce(sum(amount_cents), 0)::bigint from quotes
        where status = 'paid' and updated_at >= date_trunc('month', now())) as quote_cents,
      (select coalesce(sum(d.seconds), 0)::bigint from drafts d
        where d.created_at >= date_trunc('month', now())) as draft_seconds
  `;

  const sessions = Number(row.sessions);
  const tookIn = sessions * (SESSION_PRICE_CENTS / 100) + Number(row.quote_cents) / 100;

  // Call costs are held inside each record rather than in a column, so they are summed from the
  // orders already priced above rather than asked for again here.
  const calls = await sql()`
    select c.record_encrypted as record from calls c
     where c.record_encrypted is not null
       and c.started_at >= date_trunc('month', now())
  `;
  let callCost = 0;
  let callsWithoutCost = 0;
  for (const call of calls) {
    const cost = callCostOf(decrypt(call.record));
    if (cost === null) callsWithoutCost += 1;
    else callCost += cost;
  }

  const draftSecondsThisMonth = Number(row.draft_seconds);
  const draftCost = perSecond === null ? 0 : draftSecondsThisMonth * perSecond;
  const spent = callCost + draftCost + (monthlyFixed ?? 0);

  return {
    sessions,
    tookIn,
    callCost,
    callsWithoutCost,
    draftSeconds: draftSecondsThisMonth,
    draftCost,
    fixed: monthlyFixed,
    spent,
    left: tookIn - spent,
  };
}

// Everything, with the orders that made it. The month is a calendar month because that is how
// the bills this is measured against arrive.
export async function costsNow() {
  const lines = await costLines();
  const perSecondLine = lines.find((l) => l.every === 'draft-second');
  const draftPerSecond = perSecondLine ? perSecondLine.costs : null;
  const monthly = lines.filter((l) => l.every === 'month');
  const monthlyFixed = monthly.length
    ? monthly.reduce((sum, l) => sum + l.costs, 0)
    : null;

  const rows = await sql()`
    select o.id, o.reference_code, o.is_demo, o.status,
           coalesce(
             (select json_agg(json_build_object(
                'record', c.record_encrypted, 'hasRecord', c.record_encrypted is not null))
                from calls c where c.order_id = o.id), '[]') as calls,
           coalesce(
             (select json_agg(json_build_object(
                'seconds', d.seconds, 'created_at', d.created_at, 'gave_up_at', d.gave_up_at))
                from drafts d where d.order_id = o.id), '[]') as drafts
      from orders o
     order by o.id desc
     limit 500
  `;

  const read = (value) => (typeof value === 'string' ? JSON.parse(value) : value) || [];
  const orders = rows.map((r) => costOfOrder({
    id: Number(r.id),
    reference: r.reference_code,
    isDemo: Boolean(r.is_demo),
    paid: r.status === 'confirmed',
    calls: read(r.calls).map((c) => ({
      record: c.record ? decrypt(c.record) : null,
      hasRecord: Boolean(c.hasRecord),
    })),
    drafts: read(r.drafts),
  }, draftPerSecond));

  // Paid work beyond the seven dollars. A quote marked paid is money that arrived; anything
  // else is a price somebody is still thinking about.
  const [paidWork] = await sql()`
    select coalesce(sum(amount_cents), 0)::bigint as cents, count(*)::int as n
      from quotes where status = 'paid'
  `;

  const sold = orders.filter((o) => o.paid);
  const total = (pick) => sold.reduce((sum, o) => sum + pick(o), 0);
  const sessionsIn = total((o) => o.tookIn);
  const quotesIn = Number(paidWork.cents) / 100;
  const spent = total((o) => o.spent);

  const unknown = [...new Set(sold.flatMap((o) => o.unknown))];
  if (monthlyFixed === null) {
    unknown.push('Nothing is listed as a monthly cost, so what the servers cost is not in this');
  }

  return {
    sessions: sold.length,
    sessionsIn,
    quotes: paidWork.n,
    quotesIn,
    tookIn: sessionsIn + quotesIn,
    spent,
    monthlyFixed,
    lines,
    // The month's own arithmetic, which is the one the bills are read against. Per session is
    // what a price is set from; this is whether the thing pays for itself.
    thisMonth: await thisMonth(monthlyFixed, draftPerSecond),
    // Underwater on the sessions alone, before anything the servers cost. Null where something
    // is missing, because a figure with a hole in it is worse than no figure.
    perSession: sold.length ? spent / sold.length : null,
    sessionPrice: SESSION_PRICE_CENTS / 100,
    unknown,
    orders: orders.slice(0, 50),
  };
}
