// What a quote was actually paid, when it was due, and why it differs from what was quoted.
//
// `status = 'paid'` said money arrived and nothing else. A quote agreed at four hundred and
// settled at three hundred read as four hundred paid, so the figures counted money nobody sent.
// Nothing could be late, because nothing carried a date. And a discount was invisible, which is
// the one of the three that matters most: a figure nobody can explain six months later is worse
// than no figure.
//
// This is real money, not an in-app unit. What somebody charges a client is dollars and is
// described as dollars.

import { ensureSchema, sql } from './db.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { orderId, record } from './desk-events.js';

async function quoteUnder(orderIdValue, quoteId) {
  const [order] = await sql()`select client_account_id from orders where id = ${orderIdValue}`;
  const account = order?.client_account_id;
  if (!account) throw new HttpError(404, 'No account is linked to that order.');

  const rows = await sql()`
    select id, amount_cents, status, paid_cents, due_at
      from quotes where id = ${quoteId} and account_id = ${account}
  `;
  if (!rows.length) throw new HttpError(404, 'No quote with that number for this person.');
  return rows[0];
}

// When it is expected. Optional on purpose: plenty of paid work has no date on it, and a date
// invented to make a row look complete is a deadline nobody agreed to.
export async function setQuoteDue(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const quote = await quoteUnder(id, orderId(body.quoteId));

  const given = String(body.dueAt || '').trim();
  let dueAt = null;
  if (given) {
    const when = new Date(given);
    if (Number.isNaN(when.getTime())) throw new HttpError(400, 'That is not a date.');
    dueAt = when.toISOString();
  }

  await sql()`update quotes set due_at = ${dueAt}, updated_at = now() where id = ${quote.id}`;
  await record(id, 'quote.due', dueAt ? `Due ${dueAt.slice(0, 10)}.` : 'No date on it.');
  send(res, 200, { ok: true, dueAt });
}

// Money arrived. How much, and when.
//
// Less than quoted needs a line saying why. A discount is a decision and it is the kind nobody
// remembers making, so the row carries the reason or it is refused. More than quoted is allowed
// without one -- somebody paying extra is not a decision that needs defending.
export async function recordPayment(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const quote = await quoteUnder(id, orderId(body.quoteId));

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'How much actually arrived, in dollars?');
  }
  const cents = Math.round(amount * 100);

  const discount = String(body.discount || '').trim().slice(0, 500);
  if (cents < quote.amount_cents && !discount) {
    const quoted = (quote.amount_cents / 100).toFixed(2);
    throw new HttpError(
      400,
      `That is less than the $${quoted} quoted. Write down why, or the difference is a figure `
        + 'nobody can explain later.',
    );
  }

  const at = String(body.at || '').trim();
  const when = at ? new Date(at) : new Date();
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'That is not a date.');

  await sql()`
    update quotes set
      paid_cents = ${cents},
      paid_at = ${when.toISOString()},
      discount_encrypted = ${discount ? encrypt(discount) : null},
      status = 'paid',
      updated_at = now()
    where id = ${quote.id}
  `;

  const short = quote.amount_cents - cents;
  await record(id, 'quote.paid', short > 0
    ? `$${(cents / 100).toFixed(2)} of $${(quote.amount_cents / 100).toFixed(2)}. ${discount}`
    : `$${(cents / 100).toFixed(2)}.`);
  send(res, 200, { ok: true, paidCents: cents, shortBy: short > 0 ? short : 0 });
}
