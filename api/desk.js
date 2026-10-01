// The operator desk. Everything that happens after a call, for the one person running this.
//
// The payments screen is a different job and stays where it is: that one is money arriving,
// this one is a relationship being run. Keeping them apart is what stops either screen
// becoming the place where everything is done and nothing is found.
//
// The volume this is designed against is fifty thousand people and one reader. So the queue
// is paged with the page in the address, and a person's record is its own address that can
// be returned to — never one scroll holding the list and the detail together, which has no
// way back to where somebody was.

import { ensureSchema, readChoice, sql, underLimit, writeChoice } from '../lib/db.js';
import { keepRecord } from '../lib/calls.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import {
  EVENT_KINDS,
  FUNNEL_STAGES,
  INTRODUCTION_OUTCOMES,
  QUOTE_STATUSES,
  MILESTONE_STATUSES,
  PLAN_PATHS,
  isDecision,
  conversationIsOpen,
  QUOTE_ANSWERS_WAITING,
  quoteIsWaitingOnYou,
  isIntroductionOutcome,
  isQuoteStatus,
  MAX_OPEN_QUOTES,
  isMilestoneStatus,
  isPlanPath,
  isQueueState,
  pageOf,
  BLOCKER_RETURNS_AFTER_DAYS,
  REVIEW_TARGET_HOURS,
  REVIEW_PROMISE_HOURS,
} from '../lib/desk.js';
import {
  DRAFTS_PER_ORDER,
  DRAFT_WINDOW_SECONDS,
  REPLY_PROMPT,
  SLOTS,
  SYSTEM_PROMPT,
  draft as askForDraft,
  models,
} from '../lib/draft.js';
import Retell from 'retell-sdk';

import { agentScriptExport } from '../lib/voice.js';
import { normalizeReference, OPENING_LINE } from '../lib/orders.js';
import { clearDemo, seedDemo } from '../lib/demo.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';
import { caseOf, orderId, record } from '../lib/desk-events.js';
import { breakEvenForOrder } from '../lib/costs.js';
import { introduce, recordIntroduction } from '../lib/desk-introductions.js';
import { chooseModel, writeDraft } from '../lib/desk-drafts.js';
import { addMilestone, recordMilestone, setPlan } from '../lib/desk-plan.js';
import { funnel } from '../lib/desk-funnel.js';
import { demoClear, demoSeed, markMine } from '../lib/desk-demo.js';
import { block, close, unblock } from '../lib/desk-state.js';
import { agentScript, callRecord } from '../lib/desk-voice.js';
import { moveQuote, quoteWorth, writeQuote } from '../lib/desk-quotes.js';

const PER_PAGE = 25;

function query(req) {
  return new URL(req.url, 'https://placeholder.invalid').searchParams;
}

function needsCase(caseId) {
  if (caseId) return caseId;
  throw new HttpError(
    409,
    'They have not signed in yet, so there is nobody to work with. This opens once they open '
      + 'their claim link while signed in to Skills Economy.',
  );
}

function readDetail(row) {
  if (!row.detail_encrypted) return null;
  try {
    return decrypt(row.detail_encrypted);
  } catch {
    // A row written under a key that is no longer the key. The line still belongs on the
    // trail — that something happened on that date is the part that cannot be reconstructed.
    return null;
  }
}

// Three queues, derived from the decision rather than stored beside it, so there is never a
// second fact about somebody's state that can disagree with the first.
//
// Waiting is the one with work in it: a call has been filed and nobody has read it yet.
async function queue(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const params = query(req);
  const state = isQueueState(params.get('state')) ? params.get('state') : 'waiting';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const offset = (page - 1) * PER_PAGE;

  // One query, not two. The count used to be a second query carrying its own copy of the
  // same `where`, and the two copies are what let the replies queue go wrong: the condition
  // had to be edited in two places and there was nothing to say when only one of them was.
  // `count(*) over ()` counts the rows the filter matched, before the limit, so the total
  // and the page can never describe different sets.
  //
  // Writing in is open to somebody approved OR somebody quoted -- writing a quote is
  // choosing to work with them, which is the same choice a go is. This queue asked only
  // about approved, so a quoted no-go could write and their message landed nowhere: the
  // tab that exists to surface a message said there was nothing in it.
  const rows = await sql()`
      select o.id, o.reference_code, o.decision,
             o.recommendations_written_at,
             count(*) over () as total,
             exists (select 1 from calls c2
                      where c2.order_id = o.id and c2.record_encrypted is null
                        and c2.transcript_encrypted is not null) as record_missing,
             o.decision_at, o.client_account_id is not null as linked, o.is_demo,
             p.path as plan_path,
             (select c.ended_at from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null
               order by c.ended_at desc nulls last limit 1) as called_at,
             (select c.seconds from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null
               order by c.ended_at desc nulls last limit 1) as seconds,
             (select count(*)::int from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null) as call_count,
             exists (select 1 from quotes q
                      where q.account_id = o.client_account_id
                        and q.status = any(${QUOTE_ANSWERS_WAITING})) as quote_waiting,
             (select m.author from messages m
               where m.account_id = o.client_account_id
               order by m.created_at desc limit 1) = 'client' as awaiting_reply
        from orders o
        left join plans p on p.order_id = o.id and p.in_force
        left join cases k on k.id = o.case_id
       where exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null)
         and case ${state}
               when 'waiting' then o.decision is null
               when 'replies' then (o.approved_as_client_at is not null
                                     or exists (select 1 from quotes q
                                                 where q.account_id = o.client_account_id))
                                   and (select m.author from messages m
                                         where m.account_id = o.client_account_id
                                         order by m.created_at desc limit 1) = 'client'
               when 'active'  then o.decision = 'go' and k.closed_at is null
               else                k.closed_at is not null
             end
       order by o.id desc
       limit ${PER_PAGE} offset ${offset}
    `;

  send(res, 200, {
    state,
    page,
    perPage: PER_PAGE,
    total: Number(rows[0]?.total || 0),
    people: rows.map((r) => ({
      id: r.id,
      reference: r.reference_code,
      calledAt: r.called_at,
      seconds: r.seconds,
      callCount: r.call_count,
      decision: r.decision,
      decidedAt: r.decision_at,
      recommendedAt: r.recommendations_written_at,
      recordMissing: Boolean(r.record_missing),
      linked: r.linked,
      awaitingReply: Boolean(r.awaiting_reply),
      quoteWaiting: Boolean(r.quote_waiting),
      isDemo: Boolean(r.is_demo),
      planPath: r.plan_path,
      planLabel: r.plan_path ? PLAN_PATHS[r.plan_path]?.label || r.plan_path : null,
    })),
  });
}

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
async function today(req, res) {
  requireAdmin(req);
  await ensureSchema();

  // A call that came back and nobody has decided on. The sheet is a separate debt and shows on
  // the person's own record; this list is about reading what arrived.
  const calls = await sql()`
    select o.id, o.reference_code, o.is_demo,
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
           m.at as wrote_at,
           k.blocked_at is not null as was_blocked
      from cases k
      join lateral (
        select max(created_at) as at from messages
         where account_id = k.account_id and author = 'client'
      ) m on true
      join lateral (
        select id, reference_code, is_demo from orders
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
           o.id as order_id, o.reference_code, o.is_demo
      from quotes q
      join lateral (
        select id, reference_code, is_demo from orders
         where client_account_id = q.account_id order by id asc limit 1
      ) o on true
     where q.status = any(${QUOTE_ANSWERS_WAITING})
     order by q.answered_at asc nulls last
     limit 50
  `;

  const now = Date.now();
  const hoursSince = (at) => (at ? (now - new Date(at).getTime()) / 3_600_000 : null);

  send(res, 200, {
    targetHours: REVIEW_TARGET_HOURS,
    promiseHours: REVIEW_PROMISE_HOURS,
    calls: calls.map((r) => ({
      id: Number(r.id),
      reference: r.reference_code,
      calledAt: r.called_at,
      hoursWaiting: hoursSince(r.called_at),
      isDemo: Boolean(r.is_demo),
    })),
    unread: unread.map((r) => ({
      id: Number(r.order_id),
      caseId: Number(r.case_id),
      reference: r.reference_code,
      wroteAt: r.wrote_at,
      hoursWaiting: hoursSince(r.wrote_at),
      wasBlocked: Boolean(r.was_blocked),
      isDemo: Boolean(r.is_demo),
    })),
    answered: answered.map((r) => ({
      id: Number(r.order_id),
      reference: r.reference_code,
      status: r.status,
      amount: r.amount_cents / 100,
      answeredAt: r.answered_at,
      hoursWaiting: hoursSince(r.answered_at),
      isDemo: Boolean(r.is_demo),
    })),
  });
}

// One person, entire. Four queries rather than one join, because a join across events and
// milestones multiplies rows and the shapes are different enough that pulling them apart
// again costs more than asking twice.
async function person(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const id = orderId(query(req).get('id'));

  const rows = await sql()`
    select o.id, o.reference_code, o.status, o.decision, o.decision_at, o.case_id, o.is_demo,
           o.client_account_id, o.approved_as_client_at,
           k.first_customer_at,
           o.recommendations_encrypted, o.recommendations_written_at
      from orders o
      left join cases k on k.id = o.case_id
     where o.id = ${id}
  `;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const row = rows[0];
  const caseId = row.case_id === null || row.case_id === undefined ? null : Number(row.case_id);

  // Every order this person bought, not only the one in the address. Somebody who came back
  // for a second session is one person with two purchases, and a screen that shows one of
  // them is hiding the other half of what happened. The sheet stays with its own order,
  // because it was written from that call.
  const orders = caseId
    ? await sql()`
        select o.id, o.reference_code, o.status, o.decision, o.decision_at,
               o.recommendations_written_at,
               (select c.ended_at from calls c
                 where c.order_id = o.id and c.transcript_encrypted is not null
                 order by c.ended_at desc nulls last limit 1) as called_at
          from orders o where o.case_id = ${caseId} order by o.id desc
      `
    : [];

  // Opening the record is what marks it read. Unread means never opened, so this is the moment
  // it stops being true -- not sending a reply, because reading something and deciding it needs
  // research is still having read it. That case comes back through the blocker instead.
  if (caseId) {
    await sql()`update cases set messages_read_at = now() where id = ${caseId}`;
  }

  // One decision for the person, taken from the most recent order that carries one. A
  // decision is made from a call, so it is written on the order it was made from; what a
  // second copy on the case would buy is a way for the two to disagree.
  const decided = orders.find((o) => o.decision) || row;

  // The thread belongs to the account, not to this order, so somebody who buys a second
  // session carries one conversation rather than starting another.
  const [{ count: messageCount }] = row.client_account_id
    ? await sql()`
        select count(*)::int as count from messages
         where account_id = ${row.client_account_id}
      `
    : [{ count: 0 }];
  const messagePage = pageOf(
    new URL(req.url, 'https://placeholder.invalid').searchParams.get('mpage'),
    messageCount,
  );
  const messages = row.client_account_id
    ? await sql()`
        select author, body_encrypted, created_at from messages
         where account_id = ${row.client_account_id}
         order by created_at asc
         limit ${messagePage.perPage} offset ${(messagePage.page - 1) * messagePage.perPage}
      `
    : [];

  // Every call against this order, newest first, each with its own transcript. A session that
  // dropped and was restarted shows as two, which is a fact the owner could not see before.
  const calls = await sql()`
    select id, call_id, kind, transcript_encrypted, summary_encrypted, started_at, ended_at,
           seconds, record_encrypted is not null as record_kept
      from calls where order_id = ${id} order by started_at desc
  `;

  // Both sides. An introduction belongs to a pair, so it appears on either person's record and
  // reads the same way from each end.
  const intros = await sql()`
    select i.id, i.a_order_id, i.b_order_id, i.reason_encrypted, i.outcome,
           i.outcome_encrypted, i.made_at,
           a.reference_code as a_reference, b.reference_code as b_reference
      from introductions i
      join orders a on a.id = i.a_order_id
      join orders b on b.id = i.b_order_id
     where i.a_order_id = ${id} or i.b_order_id = ${id}
        or (${caseId}::bigint is not null and (i.a_case_id = ${caseId} or i.b_case_id = ${caseId}))
     order by i.made_at desc limit 100
  `;

  // Quotes follow the account rather than the order. An order nobody has linked has nobody to
  // quote, which the screen says rather than offering a form that cannot work.
  const [caseRow] = caseId
    ? await sql()`select blocked_at, blocked_until, blocker_encrypted, closed_at
                    from cases where id = ${caseId}`
    : [];

  const quotes = row.client_account_id
    ? await sql()`
        select id, amount_cents, scope_encrypted, status, created_at, updated_at,
               answered_at, reason_encrypted
          from quotes where account_id = ${row.client_account_id}
         order by created_at desc limit 50
      `
    : [];

  const [plans, events] = caseId
    ? await Promise.all([
        sql()`select id, path, in_force, created_at from plans where case_id = ${caseId} order by created_at desc`,
        sql()`select kind, detail_encrypted, created_at from case_events
               where case_id = ${caseId} order by created_at desc limit 100`,
      ])
    : await Promise.all([
        sql()`select id, path, in_force, created_at from plans where order_id = ${id} order by created_at desc`,
        sql()`select kind, detail_encrypted, created_at from case_events
               where order_id = ${id} order by created_at desc limit 100`,
      ]);
  const inForce = plans.find((p) => p.in_force) || null;
  const steps = inForce
    ? await sql()`
        select id, position, title_encrypted, status, outcome_encrypted, updated_at
          from milestones where plan_id = ${inForce.id} order by position asc
      `
    : [];

  // Not always the shape the voice service usually sends. The transcript is the part that
  // matters and it is right there, so an unreadable summary does not fail the request.
  function readSummary(value) {
    if (!value) return null;
    try {
      return JSON.parse(decrypt(value));
    } catch {
      return null;
    }
  }

  send(res, 200, {
    id: row.id,
    reference: row.reference_code,
    status: row.status,
    calls: calls.map((c) => ({
      id: c.id,
      callId: c.call_id,
      kind: c.kind,
      transcript: c.transcript_encrypted ? decrypt(c.transcript_encrypted) : null,
      summary: readSummary(c.summary_encrypted),
      startedAt: c.started_at,
      endedAt: c.ended_at,
      seconds: c.seconds,
    })),
    // The same two facts the queue carries, so one description of what is owed serves both
    // screens rather than each working it out differently. Both read only the calls that came
    // back: a start that produced no words is not when somebody was called, and it has no
    // record to keep and never will, so it is not something anybody is waiting on.
    calledAt: calls.find((c) => c.transcript_encrypted)?.started_at || null,
    recordMissing: calls.some((c) => c.transcript_encrypted && !c.record_kept),
    decision: decided.decision,
    decidedAt: decided.decision_at,
    linkedCase: Boolean(caseId),
    isDemo: Boolean(row.is_demo),
    orders: orders.map((o) => ({
      id: Number(o.id),
      reference: o.reference_code,
      decision: o.decision,
      calledAt: o.called_at,
      recommendedAt: o.recommendations_written_at,
      thisOne: Number(o.id) === id,
    })),
    linked: Boolean(row.client_account_id),
    approvedAt: row.approved_as_client_at,
    // Not the screen's to work out. It got a different answer from the client area's and the two
    // contradicted each other on the same record.
    quoteWaiting: quotes.some((q) => quoteIsWaitingOnYou(q.status)),
    // The owner's own bookkeeping. Neither reaches the client: a blocker is what this is
    // waiting on, and closing is a view that shortens a list.
    blocker: caseRow?.blocker_encrypted ? decrypt(caseRow.blocker_encrypted) : null,
    blockedAt: caseRow?.blocked_at || null,
    blockedUntil: caseRow?.blocked_until || null,
    closedAt: caseRow?.closed_at || null,
    // The floor under a price, so it is on the screen before a number is typed rather than
    // worked out afterwards. It is not the price: what the work is worth to them is a
    // different question and it is the one that sets it.
    breakEven: await breakEvenForOrder(id),
    conversationOpen: conversationIsOpen({
      approvedAt: row.approved_as_client_at,
      quoteCount: quotes.length,
    }),
    recommendations: row.recommendations_encrypted ? decrypt(row.recommendations_encrypted) : null,
    messages: messages.map((m) => ({
      author: m.author,
      body: decrypt(m.body_encrypted),
      at: m.created_at,
    })),
    // Whether the last thing said was theirs. The queue has carried this since it was built,
    // and a person's own record never did -- so the panel whose entire job is saying what is
    // waiting on you could not say the one thing somebody is actually waiting for.
    awaitingReply: messages.length > 0
      && (await sql()`
           select author from messages
            where account_id = ${row.client_account_id}
            order by created_at desc limit 1
         `)[0]?.author === 'client',
    messagePage: messagePage.page,
    messagesPerPage: messagePage.perPage,
    messageCount,
    recommendedAt: row.recommendations_written_at,
    firstCustomerAt: row.first_customer_at,
    plan: inForce
      ? { id: inForce.id, path: inForce.path, label: PLAN_PATHS[inForce.path]?.label || inForce.path, setAt: inForce.created_at }
      : null,
    formerPlans: plans
      .filter((p) => !p.in_force)
      .map((p) => ({ path: p.path, label: PLAN_PATHS[p.path]?.label || p.path, setAt: p.created_at })),
    milestones: steps.map((m) => ({
      id: m.id,
      position: m.position,
      title: decrypt(m.title_encrypted),
      status: m.status,
      outcome: m.outcome_encrypted ? decrypt(m.outcome_encrypted) : null,
      updatedAt: m.updated_at,
    })),
    quotes: quotes.map((q) => ({
      id: q.id,
      // Dollars, because this is money. Sent as a number so the screen does the formatting.
      amount: q.amount_cents / 100,
      scope: decrypt(q.scope_encrypted),
      status: q.status,
      writtenAt: q.created_at,
      movedAt: q.updated_at,
      // What they said back, and when. Without it a quote that was turned down for a reason
      // and one that went nowhere read the same afterwards.
      answeredAt: q.answered_at,
      reason: q.reason_encrypted ? decrypt(q.reason_encrypted) : null,
    })),
    introductions: intros.map((i) => {
      const them = Number(i.a_order_id) === Number(id)
        ? { id: i.b_order_id, reference: i.b_reference }
        : { id: i.a_order_id, reference: i.a_reference };
      return {
        id: i.id,
        them,
        reason: i.reason_encrypted ? decrypt(i.reason_encrypted) : null,
        outcome: i.outcome,
        note: i.outcome_encrypted ? decrypt(i.outcome_encrypted) : null,
        madeAt: i.made_at,
      };
    }),
    events: events.map((e) => ({
      kind: e.kind,
      label: EVENT_KINDS[e.kind] || e.kind,
      detail: readDetail(e),
      at: e.created_at,
    })),
    drafting: { models: models(), chosen: await readChoice(MODEL_CHOICE) },
  });
}

// The name of the one choice this screen owns. A slot letter, never an address and never a
// key: those are settings and are not writable from a browser at any privilege.
const MODEL_CHOICE = 'draft.model.slot';

// The end of the method. METHOD.md ends the relationship here rather than at a session count,
// so this is the one outcome worth recording on its own and the bottom of the funnel.
//
// Reversible, because it can be recorded on the wrong person or turn out not to have held, and
// both ways round leave a line on the trail.
async function firstCustomer(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const reached = body.reached !== false;

  const confirmed = await sql()`select 1 from orders where id = ${id} and status = 'confirmed'`;
  if (!confirmed.length) throw new HttpError(404, 'No confirmed order with that number.');
  const caseId = needsCase(await caseOf(id));

  const done = await sql()`
    update cases
       set first_customer_at = case when ${reached} then coalesce(first_customer_at, now()) else null end
     where id = ${caseId}
     returning first_customer_at
  `;
  await record(id, 'first-customer', reached ? String(body.note || '').trim() : 'Taken back off.');
  send(res, 200, { ok: true, at: done[0].first_customer_at });
}

// The conversation opens itself.
//
// Two things have to be true: a go was recorded, and the sheet is written. The opening line
// asks what they make of the recommendations, so posting it before there are any would be a
// question about nothing.
//
// It runs from both the decision and the sheet, because either can happen second. Posting is
// guarded on the thread being empty, which makes it safe to call twice and means somebody who
// comes back for a later call is not opened at again.
async function openTheConversation(id) {
  const rows = await sql()`
    select client_account_id from orders
     where id = ${id}
       and approved_as_client_at is not null
       and recommendations_encrypted is not null
       and client_account_id is not null
  `;
  if (!rows.length) return false;
  const account = rows[0].client_account_id;

  const already = await sql()`select 1 from messages where account_id = ${account} limit 1`;
  if (already.length) return false;

  await sql()`
    insert into messages (account_id, author, body_encrypted)
    values (${account}, 'opening', ${encrypt(OPENING_LINE)})
  `;
  await record(id, 'conversation.opened', OPENING_LINE);
  return true;
}

// Go or no-go, by somebody who read the words. Changing a decision is allowed and leaves both
// on the trail; what is not allowed is a machine making it.
async function decide(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const decision = String(body.decision || '');
  if (!isDecision(decision)) throw new HttpError(400, 'The decision is either go or no-go.');

  const done = await sql()`
    update orders set
      decision = ${decision},
      decision_at = now(),
      approved_as_client_at = case
        when ${decision} = 'go' then coalesce(approved_as_client_at, now())
        else null
      end
     where id = ${id} and status = 'confirmed'
     returning id
  `;
  if (!done.length) {
    throw new HttpError(409, 'That order is not a confirmed one, so there is no call to decide on.');
  }
  await record(id, 'decided', `${decision}. ${String(body.note || '').trim()}`.trim());
  const opened = decision === 'go' ? await openTheConversation(id) : false;
  send(res, 200, { ok: true, decision, opened });
}

// What the caller reads when they come back.
//
// The same kind of thing whichever way the decision went. A no-go is not a rejection and must
// not read as one: nobody loses anything they had, Skills Economy is unchanged and free, and
// what One Percent adds is one person's time. So both sides get recommendations, and the
// difference is whether the conversation opens, not whether there is something to read.
async function recommend(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const text = String(body.body || '').trim().slice(0, 8000);
  if (!text) throw new HttpError(400, 'An empty sheet is not a recommendation.');

  const done = await sql()`
    update orders set
      recommendations_encrypted = ${encrypt(text)},
      recommendations_written_at = now()
     where id = ${id} and status = 'confirmed'
     returning id
  `;
  if (!done.length) {
    throw new HttpError(409, 'That order is not a confirmed one, so there is nobody to write to.');
  }
  await record(id, 'recommended', 'Written.');
  const opened = await openTheConversation(id);
  send(res, 201, { ok: true, opened });
}

// Answering. The reply goes to the account rather than to the order, and an order nobody has
// linked has nowhere to send one — say that plainly rather than accepting a message into a
// thread no one will ever read.
async function reply(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'An empty message is not a message.');

  const rows = await sql()`select client_account_id from orders where id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const account = rows[0].client_account_id;
  if (!account) {
    throw new HttpError(
      409,
      'Nobody has linked an account to this order yet, so there is no one to send this to. ' +
        'They link it by opening their claim link while signed in.',
    );
  }

  await sql()`
    insert into messages (account_id, author, body_encrypted)
    values (${account}, 'operator', ${encrypt(text)})
  `;
  send(res, 201, { ok: true });
}

async function addNote(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const note = String(body.note || '').trim();
  if (!note) throw new HttpError(400, 'An empty note is not a note.');

  const exists = await sql()`select 1 from orders where id = ${id}`;
  if (!exists.length) throw new HttpError(404, 'No order with that number.');
  await record(id, 'note', note);
  send(res, 201, { ok: true });
}

const ACTIONS = {
  GET: { today, queue, person, funnel, 'call-record': callRecord, 'agent-script': agentScript },
  POST: {
    decide,
    plan: setPlan,
    'milestone-add': addMilestone,
    'milestone-record': recordMilestone,
    reply,
    recommend,
    draft: writeDraft,
    model: chooseModel,
    quote: writeQuote,
    'quote-move': moveQuote,
    'quote-worth': quoteWorth,
    introduce,
    'introduction-record': recordIntroduction,
    'first-customer': firstCustomer,
    note: addNote,
    block,
    unblock,
    close,
    'mine': markMine,
    'demo-seed': demoSeed,
    'demo-clear': demoClear,
  },
};

export default handle(['GET', 'POST'], async (req, res) => {
  const action = query(req).get('action');
  const run = ACTIONS[req.method]?.[action];
  if (!run) {
    const names = Object.keys(ACTIONS[req.method] || {}).join(', ');
    throw new HttpError(
      400,
      `This screen asked for "${action || '(nothing)'}" and the desk has no such action on `
        + `${req.method}. That is a bug in the page, not something you did. The ones it does `
        + `have: ${names}.`,
    );
  }
  return run(req, res);
});
