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

// Two figures nothing in this database can know. The voice service prices a call and says what
// it charged; nobody says what a second of a drafting worker costs, or what the servers cost a
// month, so both are settings the owner reads off a bill and types in once.
export const COST_SETTINGS = {
  draftPerSecond: 'COST_DRAFT_PER_SECOND_USD',
  monthlyFixed: 'COST_MONTHLY_FIXED_USD',
};

function setting(name) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function costSettings() {
  return {
    draftPerSecond: setting(COST_SETTINGS.draftPerSecond),
    monthlyFixed: setting(COST_SETTINGS.monthlyFixed),
  };
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
    unknown.push(`${COST_SETTINGS.draftPerSecond} is not set, so ${draftedSeconds} seconds of `
      + 'drafting is not priced');
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

// Everything, with the orders that made it. The month is a calendar month because that is how
// the bills this is measured against arrive.
export async function costsNow() {
  const { draftPerSecond, monthlyFixed } = costSettings();

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
    unknown.push(`${COST_SETTINGS.monthlyFixed} is not set, so what the servers cost is not in `
      + 'this');
  }

  return {
    sessions: sold.length,
    sessionsIn,
    quotes: paidWork.n,
    quotesIn,
    tookIn: sessionsIn + quotesIn,
    spent,
    monthlyFixed,
    // Underwater on the sessions alone, before anything the servers cost. Null where something
    // is missing, because a figure with a hole in it is worse than no figure.
    perSession: sold.length ? spent / sold.length : null,
    sessionPrice: SESSION_PRICE_CENTS / 100,
    unknown,
    orders: orders.slice(0, 50),
  };
}
