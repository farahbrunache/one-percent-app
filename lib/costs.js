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
    select l.id, l.name, l.amount_cents, l.share_percent, l.every, l.note, l.is_demo,
           l.order_id, o.reference_code
      from cost_lines l
      left join orders o on o.id = l.order_id
     order by l.every asc, l.name asc
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    amount: Number(r.amount_cents) / 100,
    sharePercent: Number(r.share_percent),
    every: r.every,
    note: r.note,
    isDemo: Boolean(r.is_demo),
    forReference: r.reference_code || null,
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
  // A seeded row's figures are made up. Counting one would put money on this screen that was
  // never spent, which is the same failure as counting an unknown as zero, pointing the other
  // way. The seeder marks its own records; a real call the owner makes to test is not marked
  // and its cost is real, because the voice service billed for it.
  if (held?.demo === true) return null;
  const cost = held?.call_cost?.combined_cost;
  return Number.isFinite(Number(cost)) ? Number(cost) : null;
}

// Whether a record is one the seeder wrote. The cost screen needs this apart from the cost
// itself: an invented figure is not missing, so it is not worth naming as something uncounted.
export function isSeededRecord(record) {
  if (!record) return false;
  try {
    return JSON.parse(record)?.demo === true;
  } catch {
    return false;
  }
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
      // A seeded record is not a gap. Nothing was spent, so there is nothing to go looking for.
      if (!isSeededRecord(call.record)) {
        unknown.push(call.hasRecord
          ? 'a call record with no cost in it'
          : 'a call with no record kept');
      }
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
  // Shown against a demo row and counted against none of it. The row says seven dollars because
  // that is what the screen is for -- it has to look like a session to be worth testing against
  // -- and the totals take only what somebody actually sent.
  const tookIn = order.paid ? SESSION_PRICE_CENTS / 100 : 0;
  const counted = order.isDemo ? 0 : tookIn;
  return {
    id: order.id,
    reference: order.reference,
    isDemo: order.isDemo,
    paid: order.paid,
    tookIn,
    counted,
    calls,
    drafts,
    draftedSeconds,
    spent,
    left: tookIn - spent,
    unknown,
  };
}

// The last seven days, rolling.
//
// A calendar month answers a question nobody asks on the fourth: it is mostly empty at the start
// and mostly over at the end, so the same business reads differently depending on the date. Seven
// days back from now is the same width every time it is looked at.
//
// A monthly bill is spread across it rather than landed whole. Thirty days is the divisor, named
// here rather than hidden, so a bill that arrives once shows up as what it costs for the days
// being counted.
export const WINDOW_DAYS = 7;
export const DAYS_IN_A_MONTH = 30;

// Thirty days is the verdict and seven is the detail.
//
// Seven is one session wide: sell two instead of one and the answer flips, which makes it a
// reading of the week rather than of the business. Thirty smooths that out and still moves every
// day, so it is an answer rather than a wait.
export const VERDICT_DAYS = 30;

async function windowOf(days, monthlyFixed, perSecond) {
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();

  const [row] = await sql()`
    select
      (select coalesce(count(*), 0)::int from orders
        where status = 'confirmed' and is_demo = false and created_at >= ${since}) as sessions,
      (select coalesce(count(*), 0)::int from orders
        where is_demo and created_at >= ${since}) as demo_sessions,
      (select coalesce(sum(amount_cents), 0)::bigint from quotes
        where status = 'paid' and updated_at >= ${since}) as quote_cents
  `;

  // Split by whose order it was, because a demo row's cost is the project's and a client's is
  // the cost of serving them.
  const calls = await sql()`
    select c.record_encrypted as record, o.is_demo
      from calls c join orders o on o.id = c.order_id
     where c.record_encrypted is not null and c.started_at >= ${since}
  `;
  let clientCalls = 0;
  let projectCalls = 0;
  let callsWithoutCost = 0;
  for (const call of calls) {
    const cost = callCostOf(decrypt(call.record));
    if (cost === null) callsWithoutCost += 1;
    else if (call.is_demo) projectCalls += cost;
    else clientCalls += cost;
  }

  const drafted = await sql()`
    select coalesce(sum(d.seconds), 0)::bigint as seconds, o.is_demo
      from drafts d join orders o on o.id = d.order_id
     where d.created_at >= ${since}
     group by o.is_demo
  `;
  const secondsFor = (isDemo) =>
    Number(drafted.find((r) => Boolean(r.is_demo) === isDemo)?.seconds || 0);
  const clientSeconds = secondsFor(false);
  const projectSeconds = secondsFor(true);
  const priced = (seconds) => (perSecond === null ? 0 : seconds * perSecond);

  // Lines attached to one client are the cost of serving them; the rest are the product's.
  const [attached] = await sql()`
    select
      coalesce(sum(case when order_id is null then 0 else amount_cents * share_percent / 100.0 end), 0)
        as client_cents,
      coalesce(sum(case when order_id is null then amount_cents * share_percent / 100.0 else 0 end), 0)
        as product_cents
      from cost_lines where every = 'month'
  `;
  const attachedToClients = Number(attached.client_cents) / 100;

  const sessions = Number(row.sessions);
  const tookIn = sessions * (SESSION_PRICE_CENTS / 100) + Number(row.quote_cents) / 100;

  // A monthly bill, for however many days are being looked at.
  const fixedShare = monthlyFixed === null
    ? null
    : (monthlyFixed * days) / DAYS_IN_A_MONTH;

  const servingClients = clientCalls + priced(clientSeconds)
    + (attachedToClients * days) / DAYS_IN_A_MONTH;
  const runningTheProject = projectCalls + priced(projectSeconds) + (fixedShare ?? 0);
  const spent = servingClients + runningTheProject;

  return {
    days,
    since,
    sessions,
    demoSessions: Number(row.demo_sessions),
    tookIn,
    servingClients,
    runningTheProject,
    clientCalls,
    clientSeconds,
    clientDrafts: priced(clientSeconds),
    projectCalls,
    projectSeconds,
    projectDrafts: priced(projectSeconds),
    fixedShare,
    callsWithoutCost,
    spent,
    left: tookIn - spent,
  };
}

// The same seven days, eight times over.
//
// One window says where this week landed. It does not say whether that is this week or every
// week, and those call for different things: one is worth watching, the other is worth changing
// something about. Waiting a month to find that out is waiting a month to find out.
//
// So eight weeks back, each one its own seven days, and a count of how many were short. The
// count is the signal; the weeks under it are the working.
export const WEEKS_BACK = 8;

async function weeks(monthlyFixed, perSecond) {
  const span = WINDOW_DAYS * 24 * 3_600_000;
  const since = new Date(Date.now() - WEEKS_BACK * span).toISOString();
  const bucketOf = (at) => Math.floor((Date.now() - new Date(at).getTime()) / span);

  const empty = () => ({
    tookIn: 0, servingClients: 0, runningTheProject: 0, demoSessions: 0, sessions: 0,
  });
  const weekly = Array.from({ length: WEEKS_BACK }, empty);
  const into = (at) => {
    const bucket = bucketOf(at);
    return bucket >= 0 && bucket < WEEKS_BACK ? weekly[bucket] : null;
  };

  const sold = await sql()`
    select created_at, is_demo from orders
     where status = 'confirmed' and created_at >= ${since}
  `;
  for (const order of sold) {
    const week = into(order.created_at);
    if (!week) continue;
    if (order.is_demo) week.demoSessions += 1;
    else {
      week.sessions += 1;
      week.tookIn += SESSION_PRICE_CENTS / 100;
    }
  }

  const paid = await sql()`
    select updated_at, amount_cents from quotes
     where status = 'paid' and updated_at >= ${since}
  `;
  for (const quote of paid) {
    const week = into(quote.updated_at);
    if (week) week.tookIn += Number(quote.amount_cents) / 100;
  }

  const calls = await sql()`
    select c.started_at, c.record_encrypted as record, o.is_demo
      from calls c join orders o on o.id = c.order_id
     where c.record_encrypted is not null and c.started_at >= ${since}
  `;
  for (const call of calls) {
    const week = into(call.started_at);
    const cost = callCostOf(decrypt(call.record));
    if (!week || cost === null) continue;
    if (call.is_demo) week.runningTheProject += cost;
    else week.servingClients += cost;
  }

  const drafted = await sql()`
    select d.created_at, d.seconds, d.gave_up_at, o.is_demo
      from drafts d join orders o on o.id = d.order_id
     where d.created_at >= ${since}
  `;
  for (const row of drafted) {
    const week = into(row.created_at);
    const seconds = draftSeconds(row);
    if (!week || seconds === null || perSecond === null) continue;
    if (row.is_demo) week.runningTheProject += seconds * perSecond;
    else week.servingClients += seconds * perSecond;
  }

  // A monthly bill lands on every week, because it was owed in every one of them.
  const share = monthlyFixed === null ? 0 : (monthlyFixed * WINDOW_DAYS) / DAYS_IN_A_MONTH;
  return weekly.map((week, i) => {
    const spent = week.servingClients + week.runningTheProject + share;
    return {
      // 0 is the seven days ending now, so the label counts back from there.
      endedDaysAgo: i * WINDOW_DAYS,
      ...week,
      fixedShare: monthlyFixed === null ? null : share,
      spent,
      left: week.tookIn - spent,
    };
  });
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

  // Three groups, because they answer different questions. A real session sold is revenue and
  // the cost of serving somebody. A demo row is cost with no revenue, and it is the project's.
  // Everything else bought nothing and cost nothing.
  const sold = orders.filter((o) => o.paid && !o.isDemo);
  const demo = orders.filter((o) => o.isDemo);
  const total = (rows, pick) => rows.reduce((sum, o) => sum + pick(o), 0);
  const sessionsIn = total(sold, (o) => o.counted);
  const quotesIn = Number(paidWork.cents) / 100;
  const spent = total(sold, (o) => o.spent);
  const demoSpent = total(demo, (o) => o.spent);

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
    // Seven days back from now, which is the same width whenever it is looked at. Per session
    // is what a price is set from; this is whether the thing pays for itself.
    lastSeven: await windowOf(WINDOW_DAYS, monthlyFixed, draftPerSecond),
    verdict: await windowOf(VERDICT_DAYS, monthlyFixed, draftPerSecond),
    weeks: await weeks(monthlyFixed, draftPerSecond),
    // Underwater on the sessions alone, before anything the servers cost. Null where something
    // is missing, because a figure with a hole in it is worse than no figure.
    perSession: sold.length ? spent / sold.length : null,
    // Testing the product is the project's cost, listed on its own so it is not mistaken for
    // what serving a client takes.
    demoSessions: demo.length,
    demoSpent,
    sessionPrice: SESSION_PRICE_CENTS / 100,
    unknown,
    orders: orders.slice(0, 50),
  };
}
