// What a claim link shows. The phone number and the access code appear here and nowhere else.

import { ensureSchema, findByClaimTokenHash, secondsSpent, underLimit } from '../lib/db.js';
import { callerKey, keyedHash } from '../lib/crypto.js';
import {
  ASSUME_FULL_AFTER_SECONDS,
  PAYMENT_METHODS,
  REJECT_REASONS,
  SESSION_BUDGET_SECONDS,
  describeStatus,
} from '../lib/orders.js';
import { HttpError, handle, send } from '../lib/http.js';

export default handle('GET', async (req, res) => {
  const token = new URL(req.url, 'https://placeholder.invalid').searchParams.get('t');
  if (!token) throw new HttpError(400, 'This link is missing its claim token.');

  await ensureSchema();

  if (!(await underLimit('status', callerKey(req), 120, 3600))) {
    throw new HttpError(429, 'Too many lookups from here in the last hour. Try later.');
  }

  const order = await findByClaimTokenHash(keyedHash(token));
  if (!order) {
    throw new HttpError(
      404,
      'No order matches this link. Check you have the entire address, or recover it with your ' +
        'card code.',
    );
  }

  // What the start gate will actually do, asked here rather than guessed. A page that invites
  // somebody into a session the next request refuses is worse than one that says no first.
  let status = describeStatus(order);
  if (status === 'confirmed') {
    const used = await secondsSpent(order.id, ASSUME_FULL_AFTER_SECONDS, SESSION_BUDGET_SECONDS);
    if (used >= SESSION_BUDGET_SECONDS) status = 'used';
  }

  const spec = PAYMENT_METHODS[order.payment_method] || null;

  const payload = {
    status,
    label: spec ? spec.label : 'Payment',
    amount: order.card_amount_cents / 100,
    reference: order.reference_code,
    submitted: order.created_at,
    decided: order.decided_at,
  };

  // Still waiting, and paid by transfer: repeat where to send it and under what reference,
  // because this page is the only thing they kept.
  if (status === 'pending' && spec && !spec.needsCode) {
    payload.payTo = process.env[spec.envKey] || null;
  }

  if (status === 'rejected') {
    payload.reason = REJECT_REASONS[order.reject_reason] || 'The card did not check out.';
  }

  send(res, 200, payload);
});
