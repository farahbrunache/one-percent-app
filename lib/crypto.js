// Encryption, hashing and token generation for the checkout.
//
// Two facts drive every choice in this file.
//
// A gift card code is money in bearer form. Anybody who reads it can spend it, so it is
// encrypted at rest and destroyed the moment a decision is recorded — see api/admin.js.
//
// An access code is what a caller speaks to the intake agent, so it is short. A short secret
// is guessable offline if a database is ever read by somebody who should not have it, which
// is why nothing here is hashed with a bare digest. Everything is keyed with HMAC under a
// secret that lives outside the database.

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

function secret() {
  const raw = process.env.CARD_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      'CARD_ENCRYPTION_KEY is missing or shorter than 32 characters. Set it in the Render ' +
        'project settings. Without it, card codes cannot be stored or read.',
    );
  }
  return raw;
}

// A 32-byte key derived from the environment secret, cached per process.
let cachedKey = null;
function key() {
  if (!cachedKey) cachedKey = crypto.createHash('sha256').update(secret()).digest();
  return cachedKey;
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString('base64')).join('.');
}

export function decrypt(stored) {
  if (!stored) return null;
  const parts = String(stored).split('.');
  if (parts.length !== 3) throw new Error('Stored value is not in the expected three-part form.');
  const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// Keyed hash. Used wherever a value has to be looked up but must never be recoverable from
// the database alone: card codes for recovery, claim tokens, and rate-limit buckets.
export function keyedHash(value) {
  return crypto.createHmac('sha256', key()).update(String(value)).digest('hex');
}

// Gift card codes are written down in every imaginable style. Normalize before hashing so
// somebody recovering a lost claim link is not defeated by a dash or a space.
export function normalizeCardCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function claimToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Requests are rate limited per caller, but an address is personal information and this
// checkout collects none. Store a keyed hash of it instead; it is enough to count with.
export function callerKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim();
  return keyedHash('caller:' + (ip || 'unknown'));
}

// Signed, expiring cookie value naming who is signed in. The database is not consulted on
// every request; the signature is the check. The name inside is the Skills Economy account
// id, which is what came back from the sign-in.
export function signSession(subject, ttlMinutes = 720) {
  const expires = Date.now() + ttlMinutes * 60_000;
  const payload = `${Buffer.from(String(subject), 'utf8').toString('base64url')}.${expires}`;
  return `${payload}.${keyedHash(payload)}`;
}

// Returns the account id, or null. Never throws — a cookie that has been tampered with, or
// has simply run out, is the same thing as not being signed in.
export function readSession(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [encoded, expires, signature] = parts;
  if (!Number(expires) || Number(expires) < Date.now()) return null;
  if (!timingSafeEqual(signature, keyedHash(`${encoded}.${expires}`))) return null;
  const subject = Buffer.from(encoded, 'base64url').toString('utf8');
  return subject || null;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}
