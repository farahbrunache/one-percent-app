// What a claim link shows. The phone number and the access code appear here and nowhere else.

import {
  ensureSchema,
  findByClaimTokenHash,
  reconcileStarts,
  aCallCameBack,
  secondsSpent,
  underLimit,
} from '../lib/db.js';
import { callerKey, keyedHash } from '../lib/crypto.js';
import {
  ASSUME_FULL_AFTER_SECONDS,
  PAYMENT_METHODS,
  REJECT_REASONS,
  SESSION_BUDGET_SECONDS,
  UNREPORTED_AFTER_SECONDS,
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

  let order = await findByClaimTokenHash(keyedHash(token));
  if (!order) {
    throw new HttpError(
      404,
      'No order matches this link. Check you have the entire address, or recover it with your ' +
        'card code.',
    );
  }

  // The same repair the start gate does, because this page is what decides whether the button
  // is offered at all. Doing it only at the gate left an order whose attempts all failed
  // showing that its sessions were used, with no button to press to put it right — the repair
  // was behind the door it was meant to open.
  //
  // A lookup writing something is worth a word: it is recounting a derived figure from rows
  // that already exist, it reaches the same answer every time, and nothing about the order
  // itself is changed by it.
  await reconcileStarts(order.id, UNREPORTED_AFTER_SECONDS);
  order = await findByClaimTokenHash(keyedHash(token));

  // What the start gate will actually do, asked here rather than guessed. A page that invites
  // somebody into a session the next request refuses is worse than one that says no first.
  //
  // Every argument the gate passes is passed here too. Leaving one out is how this page came
  // to answer a different question from the one it is reporting on.
  let status = describeStatus(order);
  if (status === 'confirmed') {
    const used = await secondsSpent(
      order.id,
      ASSUME_FULL_AFTER_SECONDS,
      SESSION_BUDGET_SECONDS,
      UNREPORTED_AFTER_SECONDS,
    );
    if (used >= SESSION_BUDGET_SECONDS || (await aCallCameBack(order.id))) status = 'used';
  }

  const spec = PAYMENT_METHODS[order.payment_method] || null;

  const payload = {
    status,
    label: spec ? spec.label : 'Payment',
    amount: order.card_amount_cents / 100,
    reference: order.reference_code,
    submitted: order.created_at,
    decided: order.decided_at,
    // Whether anything has been written for them yet, and nothing of what it says. The screen
    // after a call asks for a sign-in, and until this the ask arrived before there was
    // anything to sign in for -- payment taken, call had, nothing delivered, create an
    // account. A date flag says which of the two screens to show and reveals nothing: whoever
    // holds this link already knows there was a call.
    recommended: Boolean(order.recommendations_written_at),
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
