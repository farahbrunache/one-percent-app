// One person, entire: the screen the desk opens when you press a row.
//
// Out of the endpoint because that file passed its size limit again, and because this is the
// largest single subject it held -- everything known about somebody, read in one request so the
// screen draws once rather than filling in panel by panel.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { HttpError, query, send } from './http.js';
import { directoryReadConfigured } from './desk-directory.js';
import { readFields } from './desk-callfields.js';
import { decrypt } from './crypto.js';
import { readChoice } from './settings.js';
import { models } from './draft.js';
import { MODEL_CHOICE } from './desk-drafts.js';
import { caseOf, orderId, readDetail } from './desk-events.js';
import {
  CADENCES,
  EVENT_KINDS,
  PLAN_PATHS,
  conversationIsOpen,
  pageOf,
  quoteIsWaitingOnYou,
} from './desk.js';
import { OPENING_LINE } from './orders.js';
import { breakEvenForOrder } from './costs.js';

// One person, entire. Four queries rather than one join, because a join across events and
// milestones multiplies rows and the shapes are different enough that pulling them apart
// again costs more than asking twice.
export async function person(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const id = orderId(query(req).get('id'));

  const rows = await sql()`
    select o.id, o.reference_code, o.status, o.decision, o.decision_at, o.case_id, o.is_demo,
           o.client_account_id, o.approved_as_client_at,
           k.first_customer_at, k.name_encrypted,
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
           seconds, record_encrypted is not null as record_kept, fields_encrypted
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
               answered_at, reason_encrypted, due_at, paid_cents, paid_at, discount_encrypted
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

  // Who they are going to approach, and every time they did. Keyed to the case, so somebody
  // with two orders has one list rather than two.
  const contacts = caseId
    ? await sql()`
        select id, name_encrypted, where_encrypted, why_encrypted, status, created_at, updated_at,
               directory_profile_encrypted is not null as from_directory
          from contacts where case_id = ${caseId} order by created_at asc
      `
    : [];
  const reaches = contacts.length
    ? await sql()`
        select o.id, o.contact_id, o.at, o.said_encrypted, o.back_encrypted
          from outreach o join contacts c on c.id = o.contact_id
         where c.case_id = ${caseId}
         order by o.at desc
      `
    : [];

  // Work owed to this person, and which quote it came from.
  const projects = caseId
    ? await sql()`
        select id, quote_id, title_encrypted, state, due_at, delivered_at, note_encrypted,
               created_at, updated_at
          from projects where case_id = ${caseId} order by created_at asc
      `
    : [];

  // The actions under those milestones, in one query rather than one per step. Nested on the
  // way out, because the screen draws them under the milestone they belong to.
  const actions = inForce
    ? await sql()`
        select a.id, a.milestone_id, a.position, a.title_encrypted, a.status, a.cadence,
               a.next_at, a.outcome_encrypted, a.closed_at, a.updated_at
          from action_items a join milestones m on m.id = a.milestone_id
         where m.plan_id = ${inForce.id}
         order by a.position asc
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
    name: row.name_encrypted ? decrypt(row.name_encrypted) : null,
    status: row.status,
    calls: calls.map((c) => ({
      id: c.id,
      callId: c.call_id,
      kind: c.kind,
      transcript: c.transcript_encrypted ? decrypt(c.transcript_encrypted) : null,
      summary: readSummary(c.summary_encrypted),
      fields: readFields(c.fields_encrypted),
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
      actions: actions
        .filter((a) => String(a.milestone_id) === String(m.id))
        .map((a) => ({
          id: Number(a.id),
          position: a.position,
          title: decrypt(a.title_encrypted),
          status: a.status,
          cadence: a.cadence,
          cadenceLabel: CADENCES[a.cadence]?.label || a.cadence,
          nextAt: a.next_at,
          // Whether it is due is worked out here rather than on the screen, so a page left open
          // overnight does not go on saying nothing is waiting.
          due: a.status === 'open' && a.next_at !== null
            && new Date(a.next_at).getTime() <= Date.now(),
          outcome: a.outcome_encrypted ? decrypt(a.outcome_encrypted) : null,
          closedAt: a.closed_at,
          updatedAt: a.updated_at,
        })),
    })),
    projects: projects.map((w) => ({
      id: Number(w.id),
      quoteId: w.quote_id === null || w.quote_id === undefined ? null : Number(w.quote_id),
      title: decrypt(w.title_encrypted),
      state: w.state,
      dueAt: w.due_at,
      deliveredAt: w.delivered_at,
      note: w.note_encrypted ? decrypt(w.note_encrypted) : null,
      // Late is worked out here rather than on the screen, so a page left open overnight does
      // not go on saying nothing is owed.
      late: w.delivered_at === null && w.state !== 'dropped' && w.due_at !== null
        && new Date(w.due_at).getTime() <= Date.now(),
      takenAt: w.created_at,
      movedAt: w.updated_at,
    })),
    // Whether the desk can read the Skills Economy Directory. Off means the link field hides.
    directoryRead: directoryReadConfigured(),
    contacts: contacts.map((c) => ({
      id: Number(c.id),
      name: decrypt(c.name_encrypted),
      where: c.where_encrypted ? decrypt(c.where_encrypted) : null,
      why: c.why_encrypted ? decrypt(c.why_encrypted) : null,
      fromDirectory: c.from_directory,
      status: c.status,
      addedAt: c.created_at,
      movedAt: c.updated_at,
      reaches: reaches
        .filter((r) => String(r.contact_id) === String(c.id))
        .map((r) => ({
          id: Number(r.id),
          at: r.at,
          said: r.said_encrypted ? decrypt(r.said_encrypted) : null,
          back: r.back_encrypted ? decrypt(r.back_encrypted) : null,
        })),
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
      dueAt: q.due_at,
      // What actually arrived, which is not always what was quoted.
      paid: q.paid_cents === null || q.paid_cents === undefined ? null : q.paid_cents / 100,
      paidAt: q.paid_at,
      discount: q.discount_encrypted ? decrypt(q.discount_encrypted) : null,
      late: q.status === 'agreed' && q.paid_at === null && q.due_at !== null
        && new Date(q.due_at).getTime() <= Date.now(),
      // Money taken for something nobody is tracking. Said on the quote rather than left to be
      // noticed, because the quote is where somebody looks when they wonder what they owe.
      untracked: q.paid_at !== null
        && !projects.some((w) => String(w.quote_id) === String(q.id)),
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
