// The first screen, and the only one the owner opens cold.
//
// Out of the endpoint because that file passed its size limit, and because this is one subject
// with one rule over it: what shows here is decided by facts about a row, never by a filter
// somebody has to set. A filter forgotten is a person waiting that nobody sees.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { send } from './http.js';
import {
  BLOCKER_RETURNS_AFTER_DAYS,
  CADENCES,
  QUOTE_ANSWERS_WAITING,
  REVIEW_PROMISE_HOURS,
  REVIEW_TARGET_HOURS,
} from './desk.js';
import { decrypt } from './crypto.js';

// The first screen. Two questions and nothing else.
//
// A funnel answers whether the work is working, which is a question for a quiet afternoon. The
// first thing in the morning is who is waiting, and the promise on the claim page is what makes
// that a clock rather than a list: forty-eight hours is what somebody was told, twenty-four is
// the target, so anything past twenty-four is at risk of breaking the promise.
//
// Oldest first, both lists. First come, first served -- and at the volume this is built for a
// queue somebody scrolls is a queue somebody loses, so the screen hands over the next one and
// says how many are behind it.
export async function today(req, res) {
  requireAdmin(req);
  await ensureSchema();

  // A call that came back and nobody has decided on. The sheet is a separate debt and shows on
  // the person's own record; this list is about reading what arrived.
  const calls = await sql()`
    select o.id, o.reference_code, o.is_demo,
           (select name_encrypted from cases where id = o.case_id) as name_encrypted,
           (select c.ended_at from calls c
             where c.order_id = o.id and c.transcript_encrypted is not null
             order by c.ended_at desc nulls last limit 1) as called_at
      from orders o
     where o.decision is null
       and exists (select 1 from calls c
                    where c.order_id = o.id and c.transcript_encrypted is not null)
     order by called_at asc nulls last
     limit 50
  `;

  // Somebody wrote and it has not been opened. Blocked drops off: it was read, it cannot be
  // answered yet, and showing it again every refresh is how a screen wastes somebody's morning.
  // It comes back on its date, or once it has sat longer than the window.
  const unread = await sql()`
    select k.id as case_id, o.id as order_id, o.reference_code, o.is_demo,
           k.name_encrypted, m.at as wrote_at,
           k.blocked_at is not null as was_blocked
      from cases k
      join lateral (
        select max(created_at) as at from messages
         where account_id = k.account_id and author = 'client'
      ) m on true
      join lateral (
        select id, reference_code, is_demo, case_id from orders
         where case_id = k.id order by id asc limit 1
      ) o on true
     where m.at is not null
       and (k.messages_read_at is null or m.at > k.messages_read_at)
       and (
         k.blocked_at is null
         or (k.blocked_until is not null and k.blocked_until <= now())
         or (k.blocked_until is null
             and k.blocked_at < now() - (${BLOCKER_RETURNS_AFTER_DAYS} || ' days')::interval)
       )
     order by m.at asc
     limit 50
  `;

  // A quote they answered, where the answer put it back on you. Agreeing and asking for a change
  // both do; declining does not. Neither ends by itself, so each one sits here until you write
  // the counter or mark it paid.
  const answered = await sql()`
    select q.id as quote_id, q.status, q.answered_at, q.amount_cents,
           o.id as order_id, o.reference_code, o.is_demo,
           (select name_encrypted from cases where id = o.case_id) as name_encrypted
      from quotes q
      join lateral (
        select id, reference_code, is_demo, case_id from orders
         where client_account_id = q.account_id order by id asc limit 1
      ) o on true
     where q.status = any(${QUOTE_ANSWERS_WAITING})
     order by q.answered_at asc nulls last
     limit 50
  `;

  // An action somebody is working through, due to be asked about again. The cadence is what
  // puts it here: without one the row has no date and never reaches this screen at all.
  //
  // This is the half of a reminder that usually goes missing. Writing down what somebody will
  // do is easy and everybody does it; coming back three weeks later to ask how it went is the
  // part that needs a screen, because nobody remembers on their own.
  const due = await sql()`
    select a.id as action_id, a.title_encrypted, a.cadence, a.next_at,
           m.title_encrypted as milestone_encrypted,
           o.id as order_id, o.reference_code, o.is_demo,
           (select name_encrypted from cases where id = o.case_id) as name_encrypted
      from action_items a
      join milestones m on m.id = a.milestone_id
      join plans p on p.id = m.plan_id and p.in_force
      join orders o on o.id = p.order_id
     where a.status = 'open' and a.next_at is not null and a.next_at <= now()
     order by a.next_at asc
     limit 50
  `;

  // Agreed, past its date, and nothing received. Money owed is the quietest thing on this screen
  // and the easiest to let slide, because nobody chases it and the client is not waiting on an
  // answer. A date that has passed is the only thing that makes it visible.
  const late = await sql()`
    select q.id as quote_id, q.amount_cents, q.due_at,
           o.id as order_id, o.reference_code, o.is_demo,
           (select name_encrypted from cases where id = o.case_id) as name_encrypted
      from quotes q
      join lateral (
        select id, reference_code, is_demo, case_id from orders
         where client_account_id = q.account_id order by id asc limit 1
      ) o on true
     where q.status = 'agreed' and q.paid_at is null
       and q.due_at is not null and q.due_at <= now()
     order by q.due_at asc
     limit 50
  `;

  // Work taken on, past its date, not handed over. The other direction from the quotes above:
  // that list is money somebody owes, this one is work the operator owes.
  const owing = await sql()`
    select w.id as project_id, w.title_encrypted, w.due_at,
           o.id as order_id, o.reference_code, o.is_demo,
           (select name_encrypted from cases where id = o.case_id) as name_encrypted
      from projects w
      join lateral (
        select id, reference_code, is_demo, case_id from orders
         where case_id = w.case_id order by id asc limit 1
      ) o on true
     where w.delivered_at is null and w.state <> 'dropped'
       and w.due_at is not null and w.due_at <= now()
     order by w.due_at asc
     limit 50
  `;

  // Whether there is demo data, which is a fact rather than something to be asked about. The
  // screen offers one control over it and decides from this which one it is: adding when there is
  // none, deleting when there is.
  //
  // Three tables rather than orders alone, because a seed that failed part way can leave cost
  // lines behind with no order against them. Offering to add on top of those makes a second set:
  // the seed stamps every run, so it adds rather than doing nothing.
  const [demo] = await sql()`
    select exists(select 1 from orders where is_demo)
        or exists(select 1 from cases where is_demo)
        or exists(select 1 from cost_lines where is_demo) as there
  `;

  const now = Date.now();
  const hoursSince = (at) => (at ? (now - new Date(at).getTime()) / 3_600_000 : null);

  send(res, 200, {
    targetHours: REVIEW_TARGET_HOURS,
    promiseHours: REVIEW_PROMISE_HOURS,
    demoData: Boolean(demo?.there),
    calls: calls.map((r) => ({
      id: Number(r.id),
      reference: r.reference_code,
      calledAt: r.called_at,
      hoursWaiting: hoursSince(r.called_at),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
    unread: unread.map((r) => ({
      id: Number(r.order_id),
      caseId: Number(r.case_id),
      reference: r.reference_code,
      wroteAt: r.wrote_at,
      hoursWaiting: hoursSince(r.wrote_at),
      wasBlocked: Boolean(r.was_blocked),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
    answered: answered.map((r) => ({
      id: Number(r.order_id),
      reference: r.reference_code,
      status: r.status,
      amount: r.amount_cents / 100,
      answeredAt: r.answered_at,
      hoursWaiting: hoursSince(r.answered_at),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
    late: late.map((r) => ({
      id: Number(r.order_id),
      quoteId: Number(r.quote_id),
      reference: r.reference_code,
      amount: r.amount_cents / 100,
      dueAt: r.due_at,
      hoursWaiting: hoursSince(r.due_at),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
    owing: owing.map((r) => ({
      id: Number(r.order_id),
      projectId: Number(r.project_id),
      reference: r.reference_code,
      title: decrypt(r.title_encrypted),
      dueAt: r.due_at,
      hoursWaiting: hoursSince(r.due_at),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
    due: due.map((r) => ({
      id: Number(r.order_id),
      actionId: Number(r.action_id),
      reference: r.reference_code,
      title: decrypt(r.title_encrypted),
      milestone: decrypt(r.milestone_encrypted),
      cadenceLabel: CADENCES[r.cadence]?.label || r.cadence,
      dueAt: r.next_at,
      hoursWaiting: hoursSince(r.next_at),
      name: r.name_encrypted ? decrypt(r.name_encrypted) : null,
      isDemo: Boolean(r.is_demo),
    })),
  });
}

