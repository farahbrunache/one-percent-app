// Where the owner's minutes go, step by step and per person.
//
// Fifty thousand people is a question of minutes per person, and the minutes were guessed. This
// measures them. Opening a record starts a clock for that person; each write on it records the
// time since the clock started or since the last write, and starts it again. More than thirty
// minutes between the two isn't counted: that's a screen left open, not a step.
//
// Nothing here is shown to a client, and none of it is about a client. It's the owner's own work.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { send } from './http.js';

const IDLE_MINUTES = 30;
const REPORT_DAYS = 30;

// The steps worth timing, by desk action, in the order the work runs. Reads, drafts and settings
// aren't steps: a draft is part of writing the sheet, and the time it takes lands on the Save.
export const STEPS = {
  'call-fields': 'Reading the call',
  decide: 'Go or no-go',
  recommend: 'Writing the sheet',
  reply: 'Replying',
  quote: 'Writing a quote',
  introduce: 'An introduction',
  trade: 'Their trade',
  'own-profile': 'Their trade',
  'milestone-add': 'The path', 'milestone-record': 'The path', plan: 'The path',
  'action-add': 'Following up', 'action-record': 'Following up', 'action-push': 'Following up',
  'contact-add': 'People to approach', 'contact-reach': 'People to approach',
  'contact-move': 'People to approach',
  'work-take': 'Work you owe', 'work-move': 'Work you owe',
  note: 'A note',
};

function asOrder(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Opening a record. A clock already running from a few minutes ago is left alone, because the
// screen redraws itself after every write and that isn't a fresh start.
export async function startClock(value) {
  const id = asOrder(value);
  if (!id) return;
  await sql()`
    insert into desk_clock (order_id, at) values (${id}, now())
    on conflict (order_id) do update set at = now()
     where desk_clock.at < now() - (${IDLE_MINUTES} || ' minutes')::interval
  `;
}

export async function timeStep(value, action) {
  const id = asOrder(value);
  if (!id || !STEPS[action]) return;
  await sql()`
    insert into step_times (order_id, step, seconds)
    select ${id}, ${action}, greatest(1, extract(epoch from now() - at))::int
      from desk_clock
     where order_id = ${id} and at > now() - (${IDLE_MINUTES} || ' minutes')::interval
  `;
  await sql()`
    insert into desk_clock (order_id, at) values (${id}, now())
    on conflict (order_id) do update set at = now()
  `;
}

// The last thirty days, one row per kind of step: how often, the typical time, and the total.
// The typical time is the median, because one step that ran into a phone call shouldn't set it.
export async function timeReport(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const rows = await sql()`
    select t.step, count(*)::int as times,
           percentile_cont(0.5) within group (order by t.seconds) as typical,
           sum(t.seconds)::int as total,
           bool_or(o.is_demo) as demo
      from step_times t join orders o on o.id = t.order_id
     where t.at > now() - (${REPORT_DAYS} || ' days')::interval
     group by t.step
  `;
  const people = await sql()`
    select count(distinct order_id)::int as people, coalesce(sum(seconds), 0)::int as total
      from step_times where at > now() - (${REPORT_DAYS} || ' days')::interval
  `;
  const byLabel = new Map();
  for (const row of rows) {
    const label = STEPS[row.step] || row.step;
    const was = byLabel.get(label) || { label, times: 0, total: 0, typical: 0, demo: false };
    was.times += row.times;
    was.total += row.total;
    was.typical = Math.max(was.typical, Math.round(Number(row.typical)));
    was.demo ||= row.demo;
    byLabel.set(label, was);
  }
  const order = [...new Set(Object.values(STEPS))];
  send(res, 200, {
    days: REPORT_DAYS,
    people: people[0].people,
    total: people[0].total,
    steps: [...byLabel.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)),
  });
}
