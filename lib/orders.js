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

// Ten characters. The reference is written into a payment note and typed back on the recovery
// form, and a match there mints a new claim link and retires the old one — so a guessed
// reference takes a paid session and locks out the person who paid for it. Six characters from
// this alphabet is seven hundred million combinations, which a patient stranger rotating
// addresses can work through. Ten is around six hundred trillion, which nobody can.
const REFERENCE_LENGTH = 10;

// Grouped in the middle so it can be read aloud and typed back without losing the place.
function group(bare) {
  return bare.length === REFERENCE_LENGTH ? `${bare.slice(0, 5)}-${bare.slice(5)}` : bare;
}

export function referenceCode(random) {
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    out += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)];
  }
  return group(out);
}

export function normalizeReference(raw) {
  return group(
    String(raw || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ''),
  );
}

// Whether a normalized string is shaped like a reference at all. Used before a lookup, so that
// something too short to be either a reference or a gift card code is refused rather than
// searched for.
export function looksLikeReference(normalized) {
  return /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(normalized);
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
