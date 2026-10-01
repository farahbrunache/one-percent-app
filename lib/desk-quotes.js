// Quotes: writing one, and recording what came back.
//
// Out of the endpoint because the endpoint was over its size limit and this is the smallest whole
// subject in it. A quote is one thing from end to end -- an amount, what it covers, and the answer
// -- and nothing else on the desk reaches into it.

import { ensureSchema, sql } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { MAX_OPEN_QUOTES, QUOTE_STATUSES, isQuoteStatus } from './desk.js';
import { draft as askForDraft } from './draft.js';
import { readChoice } from './db.js';
import { orderId, record } from './desk-events.js';

// Written for one person, against what the work is. No tier is chosen because there are none.
export async function writeQuote(req, res) {
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

  // Three at once, and the insert is what counts them, so two taps arriving together cannot
  // both pass a check made before either wrote. What is capped is how many are waiting on an
  // answer -- answering one frees the slot, so a long relationship carries any number over
  // time. Three is a choice somebody reads in one go; a fourth makes it a list, and a list of
  // prices arriving unasked is what a sales pitch looks like.
  const written = await sql()`
    insert into quotes (account_id, amount_cents, scope_encrypted)
    select ${account}, ${cents}, ${encrypt(scope)}
     where (
       select count(*) from quotes
        where account_id = ${account} and status = 'offered'
     ) < ${MAX_OPEN_QUOTES}
    returning id
  `;
  if (!written.length) {
    throw new HttpError(
      409,
      `There are already ${MAX_OPEN_QUOTES} quotes waiting on an answer from this person, ` +
        'which is as many as anybody can choose between. Withdraw one, or wait for an answer.',
    );
  }
  // Countering. They asked for a change, which hands the quote back with nothing on this end
  // able to answer it -- the moves here are paid and withdrawn, and neither is a reply to "can
  // it be less". So a counter writes the new quote and closes the old one in the same action:
  // one price is live at a time for the same piece of work, and the old one stays on the record
  // with what they said about it.
  //
  // Only a quote they asked to change can be countered. Agreeing or declining is their answer
  // and closing it from here would overwrite it.
  if (body.replaces !== undefined && body.replaces !== null) {
    const replaced = orderId(body.replaces);
    const closed = await sql()`
      update quotes set status = 'withdrawn', updated_at = now()
       where id = ${replaced} and account_id = ${account} and status = 'changes asked'
      returning amount_cents
    `;
    if (!closed.length) {
      throw new HttpError(
        409,
        'That quote is not one they asked to change, so there is nothing here to counter. The ' +
          'new quote was written; the old one is untouched.',
      );
    }
    await record(id, 'quote.moved',
      `withdrawn, countered. $${(closed[0].amount_cents / 100).toFixed(2)}`);
  }

  await record(id, 'quote.written', `$${amount.toFixed(2)}. ${scope}`);
  send(res, 201, { ok: true });
}

export async function moveQuote(req, res) {
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

// What the work might be worth to the person it is for.
//
// The floor under a price is arithmetic and is on the screen already. This is the other half,
// and it is not arithmetic: what something is worth to somebody depends on what they said they
// do, what they charge, and what reaching one more customer would mean for them. A model can
// read that back out of the call and the sheet and put a figure beside its reasoning.
//
// It is a button and never a step. Nothing it says is written anywhere, nothing is quoted on
// its say-so, and the form below it works exactly the same when no model is configured.
const WORTH_PROMPT = [
  'You are reading one call and the sheet written from it, for the operator of One Percent, who',
  'is about to write a quote for paid work. You are not talking to the client and nothing you',
  'write reaches them.',
  '',
  'Say what a piece of paid work would be worth to this person, in dollars, and why. Work only',
  'from what they said: their trade, what they charge, how often somebody needs them, what they',
  'said is in the way. Where they did not say something you need, say that it is missing rather',
  'than assuming a figure.',
  '',
  'Value is not cost. Do not price the operator\'s time, do not work from what anything costs to',
  'deliver, and do not mention either. What the work costs is on the same screen and is a',
  'different question.',
  '',
  'Give a range rather than one number, and say what would move it to each end. Two short',
  'paragraphs at most.',
  '',
  'This is a reading for one person to weigh, not a price. Never say what they should be',
  'charged, never say the quote is ready, and never apologize.',
].join('\n');

export async function quoteWorth(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);

  const rows = await sql()`
    select o.recommendations_encrypted,
           (select c.transcript_encrypted from calls c
             where c.order_id = o.id and c.transcript_encrypted is not null
             order by c.ended_at desc nulls last limit 1) as transcript
      from orders o where o.id = ${id}
  `;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');

  const transcript = rows[0].transcript ? decrypt(rows[0].transcript) : null;
  if (!transcript) {
    throw new HttpError(409, 'There is no call to read, so there is nothing to work from.');
  }

  const sheet = rows[0].recommendations_encrypted
    ? decrypt(rows[0].recommendations_encrypted)
    : null;

  const said = [
    { role: 'system', content: WORTH_PROMPT },
    { role: 'user', content: `The call:\n${transcript}` },
    ...(sheet ? [{ role: 'user', content: `What they were told:\n${sheet}` }] : []),
  ];

  const answer = await askForDraft(said, await readChoice('draft.model'));
  send(res, 200, answer);
}
