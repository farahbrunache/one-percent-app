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
  DRAFT_BUDGET_MS,
  DRAFT_WINDOW_SECONDS,
  RECAP_PROMPT,
  REPLY_PROMPT,
  SLOTS,
  SYSTEM_PROMPT,
  draft as askForDraft,
  models,
} from './draft.js';
import { orderId } from './desk-events.js';
import { recordSpend } from './spend.js';

// The name of the one choice this screen owns. A slot letter, never an address and never a key:
// those are settings and are not writable from a browser at any privilege.
//
// Exported, because the desk reads it back to show which slot is chosen. It was declared twice
// under one name with two different values -- 'draft.model' here, 'draft.model.slot' where the
// screen read it -- so pressing the toggle wrote one key and the screen read another, and the
// chosen slot never appeared. One constant, one key.
export const MODEL_CHOICE = 'draft.model';

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

// A job the budget gave up on is still running, and the worker is what costs money. Retiring it
// here is what records what it cost: past the resume window it cannot still be going, so the row
// is closed and its seconds reach the ledger even though nobody ever pressed again.
//
// Without this a row left in flight by a timeout nobody returned to would sit open forever and
// its spending would never be counted.
async function closeAbandoned(id) {
  const abandoned = await sql()`
    update drafts set gave_up_at = now()
     where order_id = ${id} and finished_at is null and gave_up_at is null
       and created_at <= now() - (${DRAFT_RESUME_WITHIN_SECONDS} || ' seconds')::interval
    returning id, created_at, order_id
  `;
  // The budget's worth, because that is the only part anybody watched. The job may have run
  // longer and it may have run less; nothing here knows. What settles it is the Runpod bill,
  // which is read per day and wins over this figure on the cost screen.
  for (const row of abandoned) await noteSpend(row, Math.round(DRAFT_BUDGET_MS / 1000));
}

export async function askAndRecord(id, said, slot) {
  await closeAbandoned(id);

  const [inFlight] = await sql()`
    select id, job_id from drafts
     where order_id = ${id} and finished_at is null and gave_up_at is null
       and job_id is not null
       and created_at > now() - (${DRAFT_RESUME_WITHIN_SECONDS} || ' seconds')::interval
     order by created_at desc limit 1
  `;

  // A press that reconnects to a job already paid for is not a second draft, so the allowance is
  // spent here rather than on every press. It used to be spent before this ran, which meant a
  // cold start that timed out three times burned three of the ten and paid for three jobs.
  if (!inFlight && !(await underLimit('draft', String(id), DRAFTS_PER_ORDER, DRAFT_WINDOW_SECONDS))) {
    throw new HttpError(
      429,
      `That is ${DRAFTS_PER_ORDER} drafts against this order today, which is the limit. Write `
        + 'this one, or come back tomorrow.',
    );
  }

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
    // Running out of patience is not the job ending.
    //
    // The budget stops the polling here; it does not stop the worker, and the worker is what
    // costs money. So a 504 leaves the row in flight and the next press picks the same job back
    // up — which is why the job's name is written down at submit.
    //
    // This used to mark every failure as given up, including that one. The resume query wants a
    // row with no `gave_up_at`, so it could never find one: a cold start timed out, the row was
    // closed, and pressing again submitted a second job and paid for it while the first was
    // still running and about to finish. The fifteen-minute resume window was unreachable code.
    //
    // Everything else did end the job — the worker refused it, ended it, or answered with
    // nothing — so those close the row and record what it cost.
    if (row && error?.status !== 504) {
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
  // From the row rather than from the answer. `answer.seconds` is measured from the press that
  // collected it, so a job submitted, timed out, and picked up by a second press would record
  // only the seconds of that second wait -- which is not what the worker ran for.
  if (done) {
    await noteSpend(done, Math.max(0, Math.round(
      (Date.now() - new Date(done.created_at).getTime()) / 1000,
    )));
  }
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

  const rows = await sql()`select id, client_account_id from orders where id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');

  // Three things the button can be drafting, so it says which. A reply comes from the
  // conversation, a recap from everything typed in since, and a sheet from the call itself.
  if (String(body.of || '') === 'recap') {
    const { recapFacts } = await import('./draft-recap.js');
    const record = await recapFacts(id);
    if (!record || record.caseId === null) {
      throw new HttpError(409, 'This order has no case open against it yet, so there is nothing '
        + 'to recap. Record a decision first.');
    }
    if (record.lines.length < 3) {
      throw new HttpError(409, 'There is almost nothing in this record yet — a recap of it would '
        + 'be shorter than reading it. Come back when there is a plan and some work against it.');
    }
    const asked = [
      { role: 'system', content: RECAP_PROMPT },
      { role: 'user', content: record.lines.join('\n') },
    ];
    return send(res, 200, await askAndRecord(id, asked, await readChoice(MODEL_CHOICE)));
  }

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
