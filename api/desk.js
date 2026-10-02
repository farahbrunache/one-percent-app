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

import { ensureSchema, sql } from '../lib/db.js';
import { readChoice } from '../lib/settings.js';
import { keepRecord } from '../lib/calls.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import {
  ACTION_STATUSES,
  CADENCES,
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
import { HttpError, handle, query, readJson, send } from '../lib/http.js';
import { caseOf, orderId, readDetail, record } from '../lib/desk-events.js';
import { breakEvenForOrder } from '../lib/costs.js';
import { introduce, recordIntroduction } from '../lib/desk-introductions.js';
import { chooseModel, writeDraft } from '../lib/desk-drafts.js';
import { addMilestone, recordMilestone, setPlan } from '../lib/desk-plan.js';
import { addAction, pushAction, recordAction } from '../lib/desk-actions.js';
import { addContact, moveContact, reachOut } from '../lib/desk-contacts.js';
import { recordPayment, setQuoteDue } from '../lib/desk-payments.js';
import { moveWork, setWorkDue, takeOnWork } from '../lib/desk-projects.js';
import { today } from '../lib/desk-today.js';
import { person } from '../lib/desk-person.js';
import { funnel, setPool } from '../lib/desk-funnel.js';
import { demoClear, demoSeed, markMine } from '../lib/desk-demo.js';
import { block, close, unblock } from '../lib/desk-state.js';
import { agentScript, callRecord } from '../lib/desk-voice.js';
import { moveQuote, quoteWorth, writeQuote } from '../lib/desk-quotes.js';

const PER_PAGE = 25;

function needsCase(caseId) {
  if (caseId) return caseId;
  throw new HttpError(
    409,
    'They have not signed in yet, so there is nobody to work with. This opens once they open '
      + 'their claim link while signed in to Skills Economy.',
  );
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
    'action-add': addAction,
    'action-record': recordAction,
    'action-push': pushAction,
    'quote-due': setQuoteDue,
    'quote-paid': recordPayment,
    'work-take': takeOnWork,
    'work-move': moveWork,
    'work-due': setWorkDue,
    'contact-add': addContact,
    'contact-reach': reachOut,
    'contact-move': moveContact,
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
    'funnel-pool': setPool,
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
