// Drafting, and the record of what each one cost.
//
// Out of the endpoint because the endpoint passed its size limit, and this is the subject that
// reaches furthest outside it: a model, a queue, a budget, and a table counting what the queue
// charged for. Everything else on the desk is a row and a screen.

import { ensureSchema, sql } from './db.js';
import { readChoice, underLimit, writeChoice } from './settings.js';
import { decrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import {
  DRAFTS_PER_ORDER,
  DRAFT_WINDOW_SECONDS,
  REPLY_PROMPT,
  SLOTS,
  SYSTEM_PROMPT,
  draft as askForDraft,
  models,
} from './draft.js';
import { orderId } from './desk-events.js';
import { recordSpend } from './spend.js';

const MODEL_CHOICE = 'draft.model';

export async function chooseModel(req, res) {
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
// Asking for a draft, written down from the moment it starts.
//
// A job outlives the wait for it. The budget runs out here; the worker keeps going there, and
// the worker is what costs money. So the row goes in at submit with the job's name on it, and
// a press that follows an abandoned job picks that one back up rather than paying for a second.
//
// A row with no finished_at and no gave_up_at is a job in flight. Past the budget it cannot
// still be running, so it is marked given up and the next press starts fresh.
const DRAFT_RESUME_WITHIN_SECONDS = 15 * 60;

async function askAndRecord(id, said, slot) {
  const [inFlight] = await sql()`
    select id, job_id from drafts
     where order_id = ${id} and finished_at is null and gave_up_at is null
       and job_id is not null
       and created_at > now() - (${DRAFT_RESUME_WITHIN_SECONDS} || ' seconds')::interval
     order by created_at desc limit 1
  `;

  let row = inFlight?.id ?? null;
  const answer = await askForDraft(said, slot, undefined, {
    resume: inFlight?.job_id,
    submitted: async (job, model) => {
      const made = await sql()`
        insert into drafts (order_id, slot, model, job_id)
        values (${id}, ${model.slot}, ${model.name}, ${job})
        returning id
      `;
      row = Number(made[0].id);
    },
  }).catch(async (error) => {
    // Given up on, so the next press does not keep reconnecting to a job that is gone. The
    // row stays, because what it records is money spent on nothing -- and the charge goes to
    // the ledger for the same reason. A worker that ran was billed whether or not anybody
    // waited for it.
    if (row) {
      const [gone] = await sql()`
        update drafts set gave_up_at = now() where id = ${row}
        returning id, created_at, order_id
      `;
      if (gone) {
        const ran = Math.max(0, Math.round(
          (Date.now() - new Date(gone.created_at).getTime()) / 1000,
        ));
        await noteSpend(gone, ran);
      }
    }
    throw error;
  });

  const [done] = await sql()`
    update drafts
       set model = ${answer.model}, prompt_tokens = ${answer.promptTokens},
           completion_tokens = ${answer.completionTokens}, seconds = ${answer.seconds},
           finished_at = now()
     where id = ${row}
    returning id, created_at, order_id
  `;
  if (done) await noteSpend(done, answer.seconds);
  return answer;
}

// The seconds a worker ran, against the order it ran for. Priced on the cost screen rather
// than here, so changing the rate reprices what already happened instead of leaving the old
// figure frozen in the ledger.
async function noteSpend(draftRow, seconds) {
  if (!Number.isFinite(Number(seconds))) return;
  const [order] = await sql()`select is_demo from orders where id = ${draftRow.order_id}`;
  await recordSpend({
    kind: 'draft',
    source: `draft:${draftRow.id}`,
    seconds: Number(seconds),
    wasDemo: Boolean(order?.is_demo),
    orderId: Number(draftRow.order_id),
    at: draftRow.created_at,
  });
}

export async function writeDraft(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);

  // A draft costs money and the button is one press. A press that reconnects to a job already
  // paid for is not a second draft, and askAndRecord decides which this is -- so the allowance
  // is spent there rather than here, where every press looked the same.
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
    const answer = await askAndRecord(id, said, await readChoice(MODEL_CHOICE));
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

  const written = await askAndRecord(id, messages, await readChoice(MODEL_CHOICE));
  send(res, 200, written);
}
