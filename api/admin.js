// The one screen with manual work on it. Sign in, read the pending cards, redeem each one
// somewhere else, then confirm or reject it here.
//
// Confirming destroys the stored card code. By that point it has been redeemed, so keeping
// it would be holding somebody's spent money for no reason.

import { ensureSchema, sql, underLimit } from '../lib/db.js';
import {
  callerKey,
  decrypt,
  signAdminToken,
  timingSafeEqual,
  verifyAdminToken,
} from '../lib/crypto.js';
import { PAYMENT_METHODS, REJECT_REASONS } from '../lib/orders.js';
import { HttpError, handle, readCookie, readJson, send, setCookie } from '../lib/http.js';

const COOKIE = 'op_admin';

function requireAdmin(req) {
  if (!verifyAdminToken(readCookie(req, COOKIE))) {
    throw new HttpError(401, 'Sign in first.');
  }
}

async function login(req, res) {
  await ensureSchema();
  if (!(await underLimit('admin-login', callerKey(req), 10, 900))) {
    throw new HttpError(429, 'Too many sign-in attempts. Wait fifteen minutes.');
  }
  const expected = process.env.ADMIN_SECRET;
  if (!expected || expected.length < 16) {
    throw new HttpError(
      503,
      'ADMIN_SECRET is missing or shorter than 16 characters. Set it in the project settings.',
    );
  }
  const body = await readJson(req);
  if (!timingSafeEqual(String(body.secret || ''), expected)) {
    throw new HttpError(401, 'That is not the admin secret.');
  }
  setCookie(res, COOKIE, signAdminToken(), 12 * 3600);
  send(res, 200, { ok: true });
}

async function list(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const rows = await sql()`
    select id, card_amount_cents, card_code_encrypted, payment_method,
           reference_code, created_at
      from orders
     where status = 'pending'
     order by created_at asc
     limit 100
  `;
  const counts = await sql()`
    select status, count(*)::int as n from orders group by status
  `;
  send(res, 200, {
    pending: rows.map((r) => ({
      id: r.id,
      method: r.payment_method,
      label: PAYMENT_METHODS[r.payment_method]?.label || 'Payment',
      amount: r.card_amount_cents / 100,
      reference: r.reference_code,
      // Only a gift card carries one. A transfer is matched on the reference instead.
      code: r.card_code_encrypted ? decrypt(r.card_code_encrypted) : null,
      submitted: r.created_at,
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
}

async function decide(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which order?');

  if (body.decision === 'reject') {
    const reason = String(body.reason || 'invalid');
    if (!REJECT_REASONS[reason]) {
      throw new HttpError(400, `Pick a reason: ${Object.keys(REJECT_REASONS).join(', ')}.`);
    }
    const done = await sql()`
      update orders set
        status = 'rejected',
        reject_reason = ${reason},
        card_code_encrypted = null,
        decided_at = now()
      where id = ${id} and status = 'pending'
      returning id
    `;
    if (!done.length) throw new HttpError(409, 'That order was already decided.');
    return send(res, 200, { ok: true, status: 'rejected' });
  }

  if (body.decision !== 'confirm') {
    throw new HttpError(400, 'The decision is either confirm or reject.');
  }

  const done = await sql()`
    update orders set
      status = 'confirmed',
      card_code_encrypted = null,
      decided_at = now()
    where id = ${id} and status = 'pending'
    returning id
  `;
  if (!done.length) throw new HttpError(409, 'That order was already decided.');
  // Confirming used to mint a six-digit code for somebody to read down a phone line. A web
  // call starts from the claim page, which already proves who they are, so there is nothing
  // to mint and nothing to say out loud.
  send(res, 200, { ok: true, status: 'confirmed' });
}

export default handle(['GET', 'POST'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');

  if (req.method === 'POST' && action === 'login') return login(req, res);
  if (req.method === 'GET' && action === 'list') return list(req, res);
  if (req.method === 'POST' && action === 'decide') return decide(req, res);
  if (req.method === 'POST' && action === 'logout') {
    setCookie(res, COOKIE, '', 0);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(400, 'Use action=login, action=list, action=decide or action=logout.');
});
