// The one screen with manual work on it. Sign in with Skills Economy, read the pending
// cards, redeem each one somewhere else, then confirm or reject it here.
//
// Confirming destroys the stored card code. By that point it has been redeemed, so keeping
// it would be holding somebody's spent money for no reason.
//
// There is no password here and no account of its own. Signing in happens at Skills
// Economy and comes back as an account id; this checks that id against the admin list.

import { ensureSchema, sql } from '../lib/db.js';
import { decrypt } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import { PAYMENT_METHODS, REJECT_REASONS, normalizeReference } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

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

// Everything that has been through here, newest first. The card code is not in it and
// cannot be — it is destroyed when a decision is recorded — but the reference, the amount,
// the decision and whether the session was ever started all survive, and somebody writing
// in to say they paid is found by their reference.
const PER_PAGE = 25;

async function history(req, res) {
  await requireAdmin(req);
  await ensureSchema();
  const params = new URL(req.url, 'https://placeholder.invalid').searchParams;
  const reference = normalizeReference(params.get('q'));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [rows, totals] = reference
    ? await Promise.all([
        sql()`
          select id, reference_code, payment_method, card_amount_cents, status, reject_reason,
                 created_at, decided_at, session_starts, first_started_at
            from orders where reference_code = ${reference}
           order by created_at desc limit ${PER_PAGE} offset ${offset}
        `,
        sql()`select count(*)::int as n from orders where reference_code = ${reference}`,
      ])
    : await Promise.all([
        sql()`
          select id, reference_code, payment_method, card_amount_cents, status, reject_reason,
                 created_at, decided_at, session_starts, first_started_at
            from orders
           order by created_at desc limit ${PER_PAGE} offset ${offset}
        `,
        sql()`select count(*)::int as n from orders`,
      ]);
  send(res, 200, {
    page,
    perPage: PER_PAGE,
    total: totals[0]?.n || 0,
    searched: reference || null,
    orders: rows.map((r) => ({
      id: r.id,
      reference: r.reference_code,
      method: r.payment_method,
      label: PAYMENT_METHODS[r.payment_method]?.label || 'Payment',
      amount: r.card_amount_cents / 100,
      status: r.status,
      rejectReason: r.reject_reason ? REJECT_REASONS[r.reject_reason] || r.reject_reason : null,
      submitted: r.created_at,
      decided: r.decided_at,
      sessionStarts: r.session_starts,
      firstStarted: r.first_started_at,
      hasTranscript: r.has_transcript,
      callSeconds: r.call_seconds,
      linked: Boolean(r.client_account_id),
      approvedClient: Boolean(r.approved_as_client_at),
    })),
  });
}

// One transcript, asked for by the row that says it exists. The list does not carry them:
// they are long, and a screen that loads twenty-five of them to show none is a screen that
// takes a while to say nothing.
async function transcript(req, res) {
  await requireAdmin(req);
  await ensureSchema();
  const id = Number(new URL(req.url, 'https://placeholder.invalid').searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which order?');

  const rows = await sql()`
    select reference_code, transcript_encrypted, call_summary_encrypted, call_ended_at,
           call_seconds
      from orders where id = ${id}
  `;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const row = rows[0];
  if (!row.transcript_encrypted) {
    throw new HttpError(404, 'No transcript was ever filed against that order.');
  }

  let summary = null;
  if (row.call_summary_encrypted) {
    try {
      summary = JSON.parse(decrypt(row.call_summary_encrypted));
    } catch {
      // What the voice service sent was not the shape it usually is. The transcript is the
      // part that matters and it is right here, so this does not fail the request.
      summary = null;
    }
  }

  send(res, 200, {
    reference: row.reference_code,
    transcript: decrypt(row.transcript_encrypted),
    summary,
    endedAt: row.call_ended_at,
    seconds: row.call_seconds,
  });
}

// Taking somebody on after reading their call. Separate from confirming the payment, and
// later: the payment says the session was bought, this says the owner read what it produced
// and wants to keep working with them.
async function approveClient(req, res) {
  await requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which order?');

  const rows = await sql()`
    update orders set approved_as_client_at = now()
     where id = ${id} and status = 'confirmed' and approved_as_client_at is null
     returning id
  `;
  if (!rows.length) {
    throw new HttpError(409, 'That order is not a confirmed one, or it is already approved.');
  }
  send(res, 200, { ok: true });
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

  if (req.method === 'GET' && action === 'list') return list(req, res);
  if (req.method === 'GET' && action === 'history') return history(req, res);
  if (req.method === 'GET' && action === 'transcript') return transcript(req, res);
  if (req.method === 'POST' && action === 'decide') return decide(req, res);
  if (req.method === 'POST' && action === 'approve-client') return approveClient(req, res);

  throw new HttpError(400, 'Use action=list, action=history, action=transcript, action=decide or action=approve-client.');
});
