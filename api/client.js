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
import { callerKey, decrypt, encrypt, keyedHash } from '../lib/crypto.js';
import { requireAccount } from '../lib/auth.js';
import { describeStatus } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

function shape(rows) {
  return rows.map((r) => ({
    reference: r.reference_code,
    approved: Boolean(r.approved_as_client_at),
    calledAt: r.first_started_at,
    sessionStarts: r.session_starts,
    hasTranscript: Boolean(r.has_transcript),
    // The same thing whichever way the decision went. Everybody who calls gets these; what
    // differs is whether the conversation opens alongside them.
    recommendations: r.recommendations_encrypted ? decrypt(r.recommendations_encrypted) : null,
    recommendedAt: r.recommendations_written_at,
  }));
}

async function mine(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  const rows = await sql()`
    select reference_code, approved_as_client_at, first_started_at, session_starts,
           recommendations_encrypted, recommendations_written_at,
           exists (select 1 from calls c
                    where c.order_id = orders.id
                      and c.transcript_encrypted is not null) as has_transcript
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

// The conversation, from the other end. One thread per person however many sessions they
// buy, so somebody who comes back months later is not starting again with a stranger.
async function thread(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  const rows = await sql()`
    select author, body_encrypted, created_at from messages
     where account_id = ${account}
     order by created_at asc limit 200
  `;
  send(res, 200, {
    messages: rows.map((r) => ({
      author: r.author,
      body: decrypt(r.body_encrypted),
      at: r.created_at,
    })),
  });
}

// What has been quoted to them, and what each one covers. Read-only from this end: agreeing
// happens by saying so in the conversation, because a button that creates an obligation to pay
// somebody real money should not be the lightest thing on the screen.
async function quotes(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  const rows = await sql()`
    select amount_cents, scope_encrypted, status, created_at
      from quotes where account_id = ${account}
     order by created_at desc limit 50
  `;
  send(res, 200, {
    quotes: rows.map((r) => ({
      amount: r.amount_cents / 100,
      scope: decrypt(r.scope_encrypted),
      status: r.status,
      writtenAt: r.created_at,
    })),
  });
}

// Writing in. Held to a rate because one person cannot read fifty thousand inboxes, and an
// account that can send without limit is a way to make sure nobody else gets read.
//
// Not gated on being approved. Somebody who paid and has not been read yet, or who was told
// no, still has a thing they paid for to ask about, and a screen that takes their money and
// then has no way to reach anybody is the complaint that writes itself.
async function sendMessage(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  if (!(await underLimit('client-send', callerKey(req), 30, 3600))) {
    throw new HttpError(429, 'That is a lot of messages in an hour. Try again later.');
  }

  const linked = await sql()`select 1 from orders where client_account_id = ${account} limit 1`;
  if (!linked.length) {
    throw new HttpError(
      409,
      'Link the claim link you were given after paying first. Until then there is no session ' +
        'here to talk about.',
    );
  }

  const body = await readJson(req);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'An empty message is not a message.');

  await sql()`
    insert into messages (account_id, author, body_encrypted)
    values (${account}, 'client', ${encrypt(text)})
  `;
  return thread(req, res);
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
  if (req.method === 'GET' && action === 'thread') return thread(req, res);
  if (req.method === 'GET' && action === 'quotes') return quotes(req, res);
  if (req.method === 'POST' && action === 'link') return link(req, res);
  if (req.method === 'POST' && action === 'send') return sendMessage(req, res);
  throw new HttpError(
    400,
    'Use action=mine, action=thread, action=quotes, action=link or action=send.',
  );
});
