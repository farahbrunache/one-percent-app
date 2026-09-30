// Quotes: writing one, and recording what came back.
//
// Out of the endpoint because the endpoint was over its size limit and this is the smallest whole
// subject in it. A quote is one thing from end to end -- an amount, what it covers, and the answer
// -- and nothing else on the desk reaches into it.

import { ensureSchema, sql } from './db.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { MAX_OPEN_QUOTES, QUOTE_STATUSES, isQuoteStatus } from './desk.js';
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
