// The client area: what somebody sees on this site once they have signed in.
//
// Three states, and the screen has to be able to tell them apart rather than guess:
//
//   signed in, no session linked   — they have paid but never shown this site which order is
//                                    theirs, or they are somebody who has not bought anything
//   linked, not approved yet       — the call has happened and the owner has not read it yet
//   approved                       — they are a client
//
// Linking is done with the claim link, because that is the one thing only the person who paid
// holds. A reference is written in a payment note and read off a screen; a claim token is not.

import { ensureSchema, findByClaimTokenHash, sql, underLimit } from '../lib/db.js';
import { callerKey, keyedHash } from '../lib/crypto.js';
import { requireAccount } from '../lib/auth.js';
import { describeStatus } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

function shape(rows) {
  return rows.map((r) => ({
    reference: r.reference_code,
    approved: Boolean(r.approved_as_client_at),
    calledAt: r.first_started_at,
    sessionStarts: r.session_starts,
    hasTranscript: Boolean(r.transcript_encrypted),
  }));
}

async function mine(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  const rows = await sql()`
    select reference_code, approved_as_client_at, first_started_at, session_starts,
           transcript_encrypted
      from orders
     where client_account_id = ${account}
     order by created_at desc
     limit 50
  `;
  const sessions = shape(rows);
  send(res, 200, {
    account,
    sessions,
    approved: sessions.some((s) => s.approved),
  });
}

async function link(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  if (!(await underLimit('client-link', callerKey(req), 20, 3600))) {
    throw new HttpError(429, 'Too many attempts from here. Try later.');
  }

  const body = await readJson(req);
  // A whole link pasted in is the common case, so take the token out of it rather than
  // telling somebody they pasted too much.
  const raw = String(body.t || '').trim();
  const token = raw.includes('t=') ? raw.split('t=').pop().split('&')[0].trim() : raw;
  if (!token) throw new HttpError(400, 'Paste the link you were given after paying.');

  const order = await findByClaimTokenHash(keyedHash(token));
  if (!order) throw new HttpError(404, 'No order matches that link.');
  if (describeStatus(order) === 'rejected') {
    throw new HttpError(409, 'That order did not check out, so there is nothing to link.');
  }
  if (order.client_account_id && order.client_account_id !== account) {
    throw new HttpError(409, 'That link is already held by a different account.');
  }

  await sql()`
    update orders set client_account_id = ${account}
     where id = ${order.id} and client_account_id is null
  `;
  return mine(req, res);
}

export default handle(['GET', 'POST'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');
  if (req.method === 'GET' && action === 'mine') return mine(req, res);
  if (req.method === 'POST' && action === 'link') return link(req, res);
  throw new HttpError(400, 'Use action=mine or action=link.');
});
