// What a session costs, and how somebody can pay for it.

export const SESSION_PRICE_CENTS = 700;

// Two routes, chosen to cover everybody without a third account to reconcile.
//
// Wise delivers actual money to a bank account, which matters because every bill this pays
// is charged in cash. The gift card is for somebody with no bank account at all — it can be
// bought over a counter with cash, so the route in stays open for them.
//
// Zelle was here and was removed: it identifies by email address, and an address handed to
// anybody who opens an order is an address handed to anybody at all.
export const PAYMENT_METHODS = {
  wise: { label: 'Wise', needsCode: false, envKey: 'PAY_WISE' },
  amazon: { label: 'Amazon gift card', needsCode: true, envKey: null },
};

export function isPaymentMethod(value) {
  return Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, value);
}

// Said out loud in a transfer note, and typed back to recover a lost link. Digits and
// letters that cannot be mistaken for each other: no O, 0, I, 1, S or 5.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';

export function referenceCode(random) {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)];
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

export function normalizeReference(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^(.{3})(.{3})$/, '$1-$2');
}

export const REJECT_REASONS = {
  not_received: 'Nothing arrived under that reference.',
  short: 'Less than seven dollars arrived.',
  empty: 'The gift card had no balance on it.',
  used: 'The gift card had already been redeemed.',
  invalid: 'The gift card code did not work. It may have been mistyped.',
  duplicate: 'That payment had already been submitted here.',
};

// A session that drops must not burn what somebody paid for, so a confirmed order opens a few
// times inside a short window. Past either limit it stops and the claim page says so.
export const MAX_SESSION_STARTS = 3;
export const SESSION_WINDOW_HOURS = 24;

export function describeStatus(order) {
  if (!order) return 'unknown';
  if (order.status !== 'confirmed') return order.status;
  const first = order.first_started_at;
  const expired =
    first && Date.now() - new Date(first).getTime() > SESSION_WINDOW_HOURS * 3_600_000;
  if (expired || Number(order.session_starts || 0) >= MAX_SESSION_STARTS) return 'used';
  return 'confirmed';
}
