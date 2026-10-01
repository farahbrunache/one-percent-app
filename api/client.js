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
//
// The conversation is open to a client and to nobody else. Paying does not open it and being
// read does not open it -- a go does, because a go means the work has started and there is
// something to talk about. Anyone else asking gets told so plainly rather than being shown a
// box that would not send.

import { caseForAccount, ensureSchema, findByClaimTokenHash, sql, underLimit } from '../lib/db.js';
import { callerKey, decrypt, encrypt, keyedHash } from '../lib/crypto.js';
import { requireAccount } from '../lib/auth.js';
import { describeStatus } from '../lib/orders.js';
import { conversationIsOpen, isQuoteAnswer, pageOf } from '../lib/desk.js';
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
//
// Approved means a go was recorded. Before that there is nothing decided to talk about, and
// after a no-go there is no work to carry on with -- in both cases the answer is the same
// sentence rather than an empty box.
// A go opens the conversation, and so does being quoted.
//
// The second was missing and it showed. A quote said to say in the conversation if you
// wanted it changed, and somebody quoted after a no-go had no conversation to say it in.
// Writing somebody a quote is choosing to work with them, which is the same choice a go is,
// so it opens the same door.
async function requireClient(account) {
  const [approved, quoted] = await Promise.all([
    sql()`
      select 1 from orders
       where client_account_id = ${account} and approved_as_client_at is not null
       limit 1
    `,
    sql()`select 1 from quotes where account_id = ${account} limit 1`,
  ]);
  if (!conversationIsOpen({ approvedAt: approved.length, quoteCount: quoted.length })) {
    throw new HttpError(
      403,
      'The conversation opens once your call has been read and the answer was yes. Until ' +
        'then what is here to read is your recommendations.',
    );
  }
}

async function thread(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  await requireClient(account);
  const asked = new URL(req.url, 'https://placeholder.invalid').searchParams.get('page');
  const [{ count }] = await sql()`
    select count(*)::int as count from messages where account_id = ${account}
  `;
  const { page, perPage } = pageOf(asked, count);
  const rows = await sql()`
    select author, body_encrypted, created_at from messages
     where account_id = ${account}
     order by created_at asc
     limit ${perPage} offset ${(page - 1) * perPage}
  `;
  send(res, 200, {
    page,
    perPage,
    total: count,
    messages: rows.map((r) => ({
      author: r.author,
      body: decrypt(r.body_encrypted),
      at: r.created_at,
    })),
  });
}

// Writing in. Held to a rate because one person cannot read fifty thousand inboxes, and an
// account that can send without limit is a way to make sure nobody else gets read.
async function sendMessage(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  await requireClient(account);
  if (!(await underLimit('client-send', callerKey(req), 30, 3600))) {
    throw new HttpError(429, "That's a lot of messages in an hour. Try again later.");
  }

  const body = await readJson(req);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'Write something first.');

  await sql()`
    insert into messages (account_id, author, body_encrypted)
    values (${account}, 'client', ${encrypt(text)})
  `;

  // Somebody writing in is the case being open again, whatever was marked. Closing is a view
  // the owner keeps for themselves, and a view that hides a person who just wrote is the one
  // thing it must never do.
  await sql()`update cases set closed_at = null where account_id = ${account}`;

  return thread(req, res);
}

// What has been quoted to them, and what each one covers. Read-only from this end: agreeing
// happens by saying so in the conversation, because a button that creates an obligation to pay
// somebody real money should not be the lightest thing on the screen.
async function quotes(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  const rows = await sql()`
    select id, amount_cents, scope_encrypted, status, created_at, answered_at,
           reason_encrypted
      from quotes where account_id = ${account}
     order by created_at desc limit 50
  `;
  send(res, 200, {
    quotes: rows.map((r) => ({
      id: r.id,
      amount: r.amount_cents / 100,
      scope: decrypt(r.scope_encrypted),
      status: r.status,
      writtenAt: r.created_at,
      answeredAt: r.answered_at,
      reason: r.reason_encrypted ? decrypt(r.reason_encrypted) : null,
    })),
  });
}

// Answering a quote. Three answers, and each one is a row changing state at a known moment
// rather than a sentence somebody has to read and interpret later.
//
// Agreeing needs nothing said. The other two ask for a line, because a quote that comes back
// with no reason leaves the operator guessing at a number, a scope or a date -- and guessing
// produces a second quote that is wrong the same way.
//
// Only a quote still on offer can be answered, and only by the account it was written for.
// Both are checked in the update rather than before it, so two taps cannot both land.
async function answerQuote(req, res) {
  const account = requireAccount(req);
  await ensureSchema();
  if (!(await underLimit('client-quote', callerKey(req), 40, 3600))) {
    throw new HttpError(429, 'That is a lot of answers in an hour. Try again later.');
  }

  const body = await readJson(req);
  const answer = String(body.answer || '');
  if (!isQuoteAnswer(answer)) {
    throw new HttpError(400, 'The answer is either agreed, declined or changes asked.');
  }

  const reason = String(body.reason || '').trim().slice(0, 2000);
  if (answer !== 'agreed' && !reason) {
    throw new HttpError(
      400,
      answer === 'declined'
        ? 'Say in a line why it is a no. Without it there is nothing to write a better one from.'
        : 'Say in a line what needs changing. Without it there is nothing to change.',
    );
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Which quote?');

  const done = await sql()`
    update quotes set
      status = ${answer},
      answered_at = now(),
      reason_encrypted = ${reason ? encrypt(reason) : null},
      updated_at = now()
     where id = ${id} and account_id = ${account} and status = 'offered'
     returning id
  `;
  if (!done.length) {
    throw new HttpError(409, 'That quote is not one of yours, or it has already been answered.');
  }

  // On the trail beside everything else that happened to this person, so the record reads in
  // order. A quote follows the account rather than one order, so it is filed against their
  // most recent one, which is the record somebody is looking at.
  await sql()`
    insert into case_events (order_id, kind, detail_encrypted)
    select id, 'quote.answered', ${encrypt(`${answer}. ${reason}`.trim())}
      from orders where client_account_id = ${account}
     order by created_at desc limit 1
  `;

  return quotes(req, res);
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
    throw new HttpError(409, "That order didn't check out, so there's nothing to link.");
  }
  if (order.client_account_id && order.client_account_id !== account) {
    throw new HttpError(409, 'That link is already held by a different account.');
  }

  // Signing in and linking an order is what creates a case. Before this the order is
  // interest: a payment, a code, a call and a sheet, and nothing about a person. After it
  // there is somebody to work with, and the plan, the conversation and the quotes hang off
  // them rather than off whichever order they happened to buy.
  const caseId = await caseForAccount(account);
  await sql()`
    update orders set client_account_id = ${account}, case_id = ${caseId}
     where id = ${order.id} and client_account_id is null
  `;
  // An order this account already held, from before cases existed, still needs the case.
  await sql()`
    update orders set case_id = ${caseId}
     where client_account_id = ${account} and case_id is null
  `;
  return mine(req, res);
}

export default handle(['GET', 'POST'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');
  if (req.method === 'GET' && action === 'mine') return mine(req, res);
  if (req.method === 'GET' && action === 'thread') return thread(req, res);
  if (req.method === 'GET' && action === 'quotes') return quotes(req, res);
  if (req.method === 'POST' && action === 'link') return link(req, res);
  if (req.method === 'POST' && action === 'quote-answer') return answerQuote(req, res);
  if (req.method === 'POST' && action === 'send') return sendMessage(req, res);
  throw new HttpError(
    400,
    'Use action=mine, action=thread, action=quotes, action=link, action=send or ' +
      'action=quote-answer.',
  );
});
