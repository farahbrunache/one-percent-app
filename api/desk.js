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

import {
  ensureSchema,
  keepRecord,
  readChoice,
  sql,
  underLimit,
  writeChoice,
} from '../lib/db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import {
  EVENT_KINDS,
  FUNNEL_STAGES,
  INTRODUCTION_OUTCOMES,
  QUOTE_STATUSES,
  MILESTONE_STATUSES,
  PLAN_PATHS,
  isAssessment,
  isIntroductionOutcome,
  isQuoteStatus,
  isMilestoneStatus,
  isPlanPath,
  isQueueState,
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
import { HttpError, handle, readJson, send } from '../lib/http.js';

const PER_PAGE = 25;

function query(req) {
  return new URL(req.url, 'https://placeholder.invalid').searchParams;
}

function orderId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which person?');
  return id;
}

// Written by whoever acted, read by whoever comes back to this later. The detail is optional
// and is trimmed to something a phone can show without the line becoming the screen.
async function record(id, kind, detail) {
  const text = String(detail || '').trim().slice(0, 2000);
  await sql()`
    insert into case_events (order_id, kind, detail_encrypted)
    values (${id}, ${kind}, ${text ? encrypt(text) : null})
  `;
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

// Three queues, derived from the assessment rather than stored beside it, so there is never a
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

  const [rows, totals] = await Promise.all([
    sql()`
      select o.id, o.reference_code, o.assessment,
             o.recommendations_written_at,
             exists (select 1 from calls c2
                      where c2.order_id = o.id and c2.record_encrypted is null
                        and c2.transcript_encrypted is not null) as record_missing,
             o.assessed_at, o.client_account_id is not null as linked,
             p.path as plan_path,
             (select c.ended_at from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null
               order by c.ended_at desc nulls last limit 1) as called_at,
             (select c.seconds from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null
               order by c.ended_at desc nulls last limit 1) as seconds,
             (select count(*)::int from calls c
               where c.order_id = o.id and c.transcript_encrypted is not null) as call_count,
             (select m.author from messages m
               where m.account_id = o.client_account_id
               order by m.created_at desc limit 1) = 'client' as awaiting_reply
        from orders o
        left join plans p on p.order_id = o.id and p.in_force
       where exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null)
         and case ${state}
               when 'waiting' then o.assessment is null
               when 'replies' then o.approved_as_client_at is not null
                                   and (select m.author from messages m
                                         where m.account_id = o.client_account_id
                                         order by m.created_at desc limit 1) = 'client'
               when 'active'  then o.assessment = 'go'
               else                o.assessment = 'no-go'
             end
       order by o.id desc
       limit ${PER_PAGE} offset ${offset}
    `,
    sql()`
      select count(*)::int as n from orders o
       where exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null)
         and case ${state}
               when 'waiting' then o.assessment is null
               when 'replies' then o.approved_as_client_at is not null
                                   and (select m.author from messages m
                                         where m.account_id = o.client_account_id
                                         order by m.created_at desc limit 1) = 'client'
               when 'active'  then o.assessment = 'go'
               else                o.assessment = 'no-go'
             end
    `,
  ]);

  send(res, 200, {
    state,
    page,
    perPage: PER_PAGE,
    total: totals[0]?.n || 0,
    people: rows.map((r) => ({
      id: r.id,
      reference: r.reference_code,
      calledAt: r.called_at,
      seconds: r.seconds,
      callCount: r.call_count,
      assessment: r.assessment,
      assessedAt: r.assessed_at,
      recommendedAt: r.recommendations_written_at,
      recordMissing: Boolean(r.record_missing),
      linked: r.linked,
      awaitingReply: Boolean(r.awaiting_reply),
      planPath: r.plan_path,
      planLabel: r.plan_path ? PLAN_PATHS[r.plan_path]?.label || r.plan_path : null,
    })),
  });
}

// The funnel, counted rather than entered. Five numbers, each a strict subset of the one above,
// so the drop between two of them is a real rate and not two unrelated figures side by side.
//
// A person with more than one order is counted once. Somebody who came back for a second
// session is not two people, and a funnel that said so would overstate the top and understate
// every rate below it.
async function funnel(req, res) {
  requireAdmin(req);
  await ensureSchema();

  const rows = await sql()`
    with people as (
      select o.id,
             coalesce(o.client_account_id, 'order:' || o.id) as who,
             o.assessment,
             o.first_customer_at,
             exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null) as called,
             exists (select 1 from plans p where p.order_id = o.id and p.in_force) as planned,
             exists (select 1 from plans p join milestones m on m.plan_id = p.id
                      where p.order_id = o.id and m.status = 'worked') as worked
        from orders o
       where o.status = 'confirmed'
    )
    select
      count(distinct who) filter (where called) as called,
      count(distinct who) filter (where called and assessment = 'go') as go,
      count(distinct who) filter (where called and assessment = 'go' and planned) as planned,
      count(distinct who) filter (where called and assessment = 'go' and planned and worked) as worked,
      count(distinct who) filter (where first_customer_at is not null) as earning
      from people
  `;
  const counts = rows[0] || {};

  let above = null;
  send(res, 200, {
    stages: FUNNEL_STAGES.map((stage) => {
      const count = Number(counts[stage.key] || 0);
      // The rate from the stage above, which is the only comparison that means anything. The
      // first stage has nothing above it, and a stage below an empty one has no rate either.
      const rate = above === null ? null : above === 0 ? null : Math.round((count / above) * 100);
      above = count;
      return { key: stage.key, label: stage.label, count, rate };
    }),
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
    select id, reference_code, status, assessment, assessed_at,
           client_account_id, approved_as_client_at, first_customer_at,
           recommendations_encrypted, recommendations_written_at
      from orders where id = ${id}
  `;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const row = rows[0];

  // The thread belongs to the account, not to this order, so somebody who buys a second
  // session carries one conversation rather than starting another.
  const messages = row.client_account_id
    ? await sql()`
        select author, body_encrypted, created_at from messages
         where account_id = ${row.client_account_id}
         order by created_at asc limit 200
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
     order by i.made_at desc limit 100
  `;

  // Quotes follow the account rather than the order. An order nobody has linked has nobody to
  // quote, which the screen says rather than offering a form that cannot work.
  const quotes = row.client_account_id
    ? await sql()`
        select id, amount_cents, scope_encrypted, status, created_at, updated_at
          from quotes where account_id = ${row.client_account_id}
         order by created_at desc limit 50
      `
    : [];

  const [plans, events] = await Promise.all([
    sql()`select id, path, in_force, created_at from plans where order_id = ${id} order by created_at desc`,
    sql()`select kind, detail_encrypted, created_at from case_events where order_id = ${id} order by created_at desc limit 100`,
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
    assessment: row.assessment,
    assessedAt: row.assessed_at,
    linked: Boolean(row.client_account_id),
    approvedAt: row.approved_as_client_at,
    recommendations: row.recommendations_encrypted ? decrypt(row.recommendations_encrypted) : null,
    messages: messages.map((m) => ({
      author: m.author,
      body: decrypt(m.body_encrypted),
      at: m.created_at,
    })),
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

// The script the agent runs, as the voice service holds it. Read by this button and by the job
// on a clock, which is why the gathering of it lives in lib/voice.js rather than in either.
async function agentScript(req, res) {
  requireAdmin(req);

  const apiKey = process.env.RETELL_SECRET_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new HttpError(503, 'RETELL_SECRET_KEY or RETELL_AGENT_ID is not set, so nothing can be asked.');
  }

  try {
    send(res, 200, await agentScriptExport(new Retell({ apiKey }), agentId));
  } catch (error) {
    if (error instanceof Retell.APIError) {
      throw new HttpError(
        502,
        `The voice service would not hand over the agent (${error.status}): ` +
          JSON.stringify(error.error ?? error.message).slice(0, 400),
      );
    }
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }
}

// Everything the voice service holds about one call, as it holds it.
//
// What is kept here is the transcript and the summary, because those are what the work runs
// on. The service keeps a great deal more -- how the agent was configured for that call, what
// it cost, latencies, where each turn began and ended, why it ended -- and none of it is worth
// a column until something needs it.
//
// What needs it is building a test case out of a real call, which is the only honest way to
// write one for a conversation. So it is fetched live and handed over whole, rather than
// stored and slowly diverging from what the service actually said.
//
// Nothing is written down by this. It is a read, and the copy that matters stays theirs.
async function callRecord(req, res) {
  requireAdmin(req);
  const callId = String(query(req).get('call') || '').trim();
  if (!callId) throw new HttpError(400, 'Which call? Pass the id the voice service gave it.');

  const apiKey = process.env.RETELL_SECRET_KEY;
  if (!apiKey) throw new HttpError(503, 'RETELL_SECRET_KEY is not set, so nothing can be asked.');

  await ensureSchema();

  // Only a call this site opened. The id comes from the screen, but the screen is not what
  // decides whether it may be read.
  const ours = await sql()`select 1 from calls where call_id = ${callId} limit 1`;
  if (!ours.length) {
    throw new HttpError(404, `No call here was started with the id ${callId}.`);
  }

  try {
    const record = await new Retell({ apiKey }).call.retrieve(callId);

    // Kept on the way past. Their retention is seven days, so a call made before anything here
    // asked for its record can still be caught by somebody opening it -- and after that it is
    // gone from both sides. Reading it is the only chance some calls will get.
    await keepRecord(callId, encrypt(JSON.stringify(record)));

    send(res, 200, record);
  } catch (error) {
    if (error instanceof Retell.APIError) {
      throw new HttpError(
        502,
        `The voice service would not hand over call ${callId} (${error.status}): ` +
          JSON.stringify(error.error ?? error.message).slice(0, 400),
      );
    }
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }
}

async function chooseModel(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const slot = String(body.slot || '').toUpperCase();
  if (!SLOTS.includes(slot)) {
    throw new HttpError(400, `The slots are ${SLOTS.join(' and ')}. That was ${slot || 'empty'}.`);
  }
  const offered = models().map((m) => m.slot);
  if (!offered.includes(slot)) {
    throw new HttpError(
      409,
      `Slot ${slot} has no address or no key set, so there is nothing to switch to. A slot is ` +
        'configured in the secrets store, not here.',
    );
  }
  await writeChoice(MODEL_CHOICE, slot);
  send(res, 200, { ok: true, chosen: slot });
}

// Writes a first pass at the sheet into the operator's box. It files nothing. What comes back
// is read, rewritten or thrown away, and the operator presses Write it themselves.
//
// The call is the input, because the sheet is what the call produced. A draft written from
// anything else would be a guess about somebody the model has not heard.
async function writeDraft(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);

  // A draft costs money and the button is one press.
  if (!(await underLimit('draft', String(id), DRAFTS_PER_ORDER, DRAFT_WINDOW_SECONDS))) {
    throw new HttpError(
      429,
      `That is ${DRAFTS_PER_ORDER} drafts against this order today, which is the limit. Write ` +
        'this one, or come back tomorrow.',
    );
  }

  const rows = await sql()`select id, client_account_id from orders where id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');

  // Two things the operator writes, so the button says which one it is drafting. A reply
  // is drafted from the conversation; a sheet is drafted from the call.
  if (String(body.of || '') === 'reply') {
    const account = rows[0].client_account_id;
    if (!account) {
      throw new HttpError(409, 'Nobody has linked an account to this order, so there is no ' +
        'conversation to answer.');
    }
    const thread = await sql()`
      select author, body_encrypted from messages
        where account_id = ${account}
        order by created_at desc
        limit 20
    `;
    if (!thread.length) {
      throw new HttpError(409, 'The conversation has nothing in it yet, so there is nothing ' +
        'to answer.');
    }
    const said = [
      { role: 'system', content: REPLY_PROMPT },
      ...thread.reverse().map((m) => ({
        role: m.author === 'client' ? 'user' : 'assistant',
        content: decrypt(m.body_encrypted),
      })),
    ];
    const answer = await askForDraft(said, await readChoice(MODEL_CHOICE));
    await sql()`
      insert into drafts (order_id, slot, model, prompt_tokens, completion_tokens, seconds)
      values (${id}, ${answer.slot}, ${answer.model}, ${answer.promptTokens},
              ${answer.completionTokens}, ${answer.seconds})
    `;
    return send(res, 200, answer);
  }

  const called = await sql()`
    select transcript_encrypted from calls
     where order_id = ${id} and transcript_encrypted is not null
     order by ended_at desc nulls last
     limit 3
  `;
  if (!called.length) {
    throw new HttpError(
      409,
      'No call against this order has a transcript yet, so there is nothing to write a sheet ' +
        'from. Keep the call record first, or wait for the hourly job to take it.',
    );
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...called
      .reverse()
      .map((c) => ({ role: 'user', content: decrypt(c.transcript_encrypted) })),
  ];

  const written = await askForDraft(messages, await readChoice(MODEL_CHOICE));

  await sql()`
    insert into drafts (order_id, slot, model, prompt_tokens, completion_tokens, seconds)
    values (${id}, ${written.slot}, ${written.model}, ${written.promptTokens},
            ${written.completionTokens}, ${written.seconds})
  `;

  send(res, 200, written);
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

  const done = await sql()`
    update orders set first_customer_at = case when ${reached} then coalesce(first_customer_at, now()) else null end
     where id = ${id} and status = 'confirmed'
     returning first_customer_at
  `;
  if (!done.length) throw new HttpError(404, 'No confirmed order with that number.');
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
async function assess(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const decision = String(body.assessment || '');
  if (!isAssessment(decision)) throw new HttpError(400, 'The decision is either go or no-go.');

  const done = await sql()`
    update orders set
      assessment = ${decision},
      assessed_at = now(),
      approved_as_client_at = case
        when ${decision} = 'go' then coalesce(approved_as_client_at, now())
        else null
      end
     where id = ${id} and status = 'confirmed'
     returning id
  `;
  if (!done.length) {
    throw new HttpError(409, 'That order is not a confirmed one, so there is no call to assess.');
  }
  await record(id, 'assessed', `${decision}. ${String(body.note || '').trim()}`.trim());
  const opened = decision === 'go' ? await openTheConversation(id) : false;
  send(res, 200, { ok: true, assessment: decision, opened });
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

// Setting the path retires whatever was in force. Two statements rather than one, because the
// partial unique index refuses two rows in force at the same moment.
async function setPlan(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const path = String(body.path || '');
  if (!isPlanPath(path)) {
    throw new HttpError(400, `Pick a path: ${Object.keys(PLAN_PATHS).join(' or ')}.`);
  }

  const exists = await sql()`select 1 from orders where id = ${id} and status = 'confirmed'`;
  if (!exists.length) throw new HttpError(404, 'No confirmed order with that number.');

  const current = await sql()`select path from plans where order_id = ${id} and in_force`;
  if (current[0]?.path === path) {
    throw new HttpError(409, 'That path is already the one in force.');
  }

  await sql()`update plans set in_force = false where order_id = ${id} and in_force`;
  await sql()`insert into plans (order_id, path) values (${id}, ${path})`;
  await record(id, 'plan.set', PLAN_PATHS[path].label);
  send(res, 200, { ok: true, path });
}

async function addMilestone(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const title = String(body.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'A milestone needs a line saying what it is.');

  const plans = await sql()`select id from plans where order_id = ${id} and in_force`;
  if (!plans.length) throw new HttpError(409, 'Set a path first — a milestone belongs to one.');

  const next = await sql()`
    select coalesce(max(position), 0) + 1 as n from milestones where plan_id = ${plans[0].id}
  `;
  await sql()`
    insert into milestones (plan_id, position, title_encrypted)
    values (${plans[0].id}, ${next[0].n}, ${encrypt(title)})
  `;
  await record(id, 'milestone.added', title);
  send(res, 201, { ok: true });
}

// What actually happened, in plain words. The status and the words are recorded together
// because a status on its own says nothing anybody can act on later.
async function recordMilestone(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const milestoneId = orderId(body.milestoneId);
  const status = String(body.status || '');
  if (!isMilestoneStatus(status)) {
    throw new HttpError(400, `Pick a status: ${MILESTONE_STATUSES.join(', ')}.`);
  }
  const outcome = String(body.outcome || '').trim().slice(0, 2000);

  const done = await sql()`
    update milestones m set
      status = ${status},
      outcome_encrypted = ${outcome ? encrypt(outcome) : null},
      updated_at = now()
     from plans p
    where m.id = ${milestoneId} and m.plan_id = p.id
      and p.order_id = ${id} and p.in_force
    returning m.id
  `;
  if (!done.length) {
    throw new HttpError(404, 'No milestone with that number under this person\'s current plan.');
  }
  await record(id, 'milestone.recorded', `${status}. ${outcome}`.trim());
  send(res, 200, { ok: true, status });
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

// Written for one person, against what the work is. No tier is chosen because there are none.
async function writeQuote(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'A quote needs an amount in dollars.');
  }
  // Rounded here rather than trusted, so a fraction of a cent cannot arrive from a form.
  const cents = Math.round(amount * 100);
  if (cents > 100_000_00) {
    throw new HttpError(400, 'That is more than a hundred thousand dollars. Check the figure.');
  }

  const scope = String(body.scope || '').trim().slice(0, 2000);
  if (!scope) {
    throw new HttpError(400, 'Say what the quote covers. A number on its own is unreadable in June.');
  }

  const rows = await sql()`select client_account_id from orders where id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const account = rows[0].client_account_id;
  if (!account) {
    throw new HttpError(
      409,
      'Nobody has linked an account to this order yet, so there is no one to quote. They link ' +
        'it by opening their claim link while signed in.',
    );
  }

  await sql()`
    insert into quotes (account_id, amount_cents, scope_encrypted)
    values (${account}, ${cents}, ${encrypt(scope)})
  `;
  await record(id, 'quote.written', `$${amount.toFixed(2)}. ${scope}`);
  send(res, 201, { ok: true });
}

async function moveQuote(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const quoteId = orderId(body.quoteId);
  const status = String(body.status || '');
  if (!isQuoteStatus(status)) {
    throw new HttpError(400, `Pick one: ${QUOTE_STATUSES.join(', ')}.`);
  }

  const rows = await sql()`select client_account_id from orders where id = ${id}`;
  const account = rows[0]?.client_account_id;
  if (!account) throw new HttpError(404, 'No account is linked to that order.');

  const done = await sql()`
    update quotes set status = ${status}, updated_at = now()
     where id = ${quoteId} and account_id = ${account}
     returning amount_cents
  `;
  if (!done.length) throw new HttpError(404, 'No quote with that number for this person.');
  await record(id, 'quote.moved', `${status}. $${(done[0].amount_cents / 100).toFixed(2)}`);
  send(res, 200, { ok: true, status });
}

// Made, not proposed. The row is a record of something done: two people were put in touch.
// There is no state for a match that was considered and rejected, because that is not a thing
// that happened to anybody.
async function introduce(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const reference = normalizeReference(body.reference);
  if (!reference) throw new HttpError(400, 'Which reference are they introduced to?');

  const them = await sql()`select id from orders where reference_code = ${reference}`;
  if (!them.length) throw new HttpError(404, `No order here carries the reference ${reference}.`);
  const otherId = Number(them[0].id);
  if (otherId === id) throw new HttpError(400, 'That is the same person.');

  // The pair is unordered, so check it both ways round before writing a second row for the
  // same two people.
  const already = await sql()`
    select id from introductions
     where (a_order_id = ${id} and b_order_id = ${otherId})
        or (a_order_id = ${otherId} and b_order_id = ${id})
     limit 1
  `;
  if (already.length) throw new HttpError(409, 'These two have already been introduced.');

  const reason = String(body.reason || '').trim().slice(0, 2000);
  await sql()`
    insert into introductions (a_order_id, b_order_id, reason_encrypted)
    values (${id}, ${otherId}, ${reason ? encrypt(reason) : null})
  `;
  // On both records, because it happened to both of them.
  await record(id, 'introduction.made', `To ${reference}. ${reason}`.trim());
  await record(otherId, 'introduction.made', `To ${await referenceOf(id)}. ${reason}`.trim());
  send(res, 201, { ok: true });
}

async function referenceOf(id) {
  const rows = await sql()`select reference_code from orders where id = ${id}`;
  return rows[0]?.reference_code || `order ${id}`;
}

async function recordIntroduction(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const introId = orderId(body.introductionId);
  const outcome = String(body.outcome || '');
  if (!isIntroductionOutcome(outcome)) {
    throw new HttpError(400, `Pick one: ${INTRODUCTION_OUTCOMES.join(', ')}.`);
  }
  const note = String(body.note || '').trim().slice(0, 2000);

  const done = await sql()`
    update introductions set
      outcome = ${outcome},
      outcome_encrypted = ${note ? encrypt(note) : null},
      updated_at = now()
     where id = ${introId} and (a_order_id = ${id} or b_order_id = ${id})
     returning a_order_id, b_order_id
  `;
  if (!done.length) throw new HttpError(404, 'No introduction with that number involving them.');
  await record(id, 'introduction.recorded', `${outcome}. ${note}`.trim());
  send(res, 200, { ok: true, outcome });
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
  GET: { queue, person, funnel },
  POST: {
    assess,
    plan: setPlan,
    'milestone-add': addMilestone,
    'milestone-record': recordMilestone,
    reply,
    recommend,
    draft: writeDraft,
    model: chooseModel,
    quote: writeQuote,
    'quote-move': moveQuote,
    introduce,
    'introduction-record': recordIntroduction,
    'first-customer': firstCustomer,
    note: addNote,
  },
};

export default handle(['GET', 'POST'], async (req, res) => {
  const action = query(req).get('action');
  const run = ACTIONS[req.method]?.[action];
  if (!run) {
    const names = Object.keys(ACTIONS[req.method] || {}).join(', ');
    throw new HttpError(400, `On ${req.method} the actions here are: ${names}.`);
  }
  return run(req, res);
});
