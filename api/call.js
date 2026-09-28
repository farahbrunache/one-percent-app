// Starts the session from the claim page, without a phone number.
//
// The claim token is the proof of payment, so nothing has to be dialed and no code has to be
// spoken. A web call cannot be reached except through a link somebody paid for, which makes
// the gate structural rather than a six-digit secret somebody could guess at.

import { ensureSchema, findByClaimTokenHash, sql, underLimit } from '../lib/db.js';
import { callerKey, keyedHash } from '../lib/crypto.js';
import { MAX_SESSION_STARTS, SESSION_WINDOW_HOURS, describeStatus } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

const RETELL_CREATE_WEB_CALL = 'https://api.retellai.com/v2/create-web-call';

export default handle('POST', async (req, res) => {
  const body = await readJson(req);
  const token = String(body.t || '').trim();
  if (!token) throw new HttpError(400, 'This link is missing its claim token.');

  const apiKey = process.env.RETELL_SECRET_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new HttpError(
      503,
      'Sessions cannot start yet — RETELL_SECRET_KEY or RETELL_AGENT_ID is missing from the ' +
        'project settings.',
    );
  }

  await ensureSchema();

  if (!(await underLimit('call', callerKey(req), 20, 3600))) {
    throw new HttpError(429, 'Too many attempts to start a session from here. Try later.');
  }

  const order = await findByClaimTokenHash(keyedHash(token));
  if (!order) throw new HttpError(404, 'No order matches this link.');

  const status = describeStatus(order);
  if (status === 'pending') {
    throw new HttpError(409, 'This order is still waiting on your payment.');
  }
  if (status === 'rejected') {
    throw new HttpError(409, 'This order did not check out, so no session is open on it.');
  }
  if (status !== 'confirmed') {
    throw new HttpError(
      409,
      `This session has been used. It opens ${MAX_SESSION_STARTS} times within ` +
        `${SESSION_WINDOW_HOURS} hours of the first, which covers one that drops.`,
    );
  }

  // Take the slot before spending money, in one statement that only succeeds if a slot is
  // actually free. Reading the count and then deciding leaves a gap: two requests arriving
  // together both read the same number, both pass, and both buy a paid session on one order.
  const taken = await sql()`
    update orders set
      session_starts = session_starts + 1,
      first_started_at = coalesce(first_started_at, now())
    where id = ${order.id}
      and status = 'confirmed'
      and session_starts < ${MAX_SESSION_STARTS}
      and (
        first_started_at is null
        or first_started_at > now() - ${SESSION_WINDOW_HOURS} * interval '1 hour'
      )
    returning session_starts
  `;
  if (!taken.length) {
    throw new HttpError(
      409,
      `This session has been used. It opens ${MAX_SESSION_STARTS} times within ` +
        `${SESSION_WINDOW_HOURS} hours of the first, which covers one that drops.`,
    );
  }

  // Giving the slot back if the voice service refuses, so their failure still costs nobody
  // one of their three.
  const release = async () => {
    await sql()`update orders set session_starts = session_starts - 1 where id = ${order.id}`;
  };

  let response;
  try {
    response = await fetch(RETELL_CREATE_WEB_CALL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      // The reference travels with the call so a transcript can be matched back to the
      // payment it was bought with, without anybody reading it out loud.
      body: JSON.stringify({
        agent_id: agentId,
        metadata: { reference: order.reference_code, order_id: String(order.id) },
      }),
    });
  } catch (error) {
    await release();
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    await release();
    // Retell's own words rather than a blank failure — this is the one part of the flow
    // that cannot be tested without a live account.
    throw new HttpError(
      502,
      `The voice service refused to start a session (${response.status}): ${text.slice(0, 400)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(502, `The voice service answered with something unreadable: ${text.slice(0, 200)}`);
  }

  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) {
    await release();
    throw new HttpError(
      502,
      `The voice service started a session but returned no access token. It sent: ${text.slice(0, 300)}`,
    );
  }

  // The call this order is now expecting. The webhook checks it before writing a transcript,
  // so a delivery cannot be aimed at an order it does not belong to.
  //
  // Its kind is decided here rather than guessed later. Intake is the call somebody bought to
  // get here; a follow-up is one where the person at the other end has already been through
  // this. What separates them is whether any call already came back for the account this order
  // is linked to — an order nobody has linked is a first conversation by definition, and a
  // session that dropped and was restarted is another attempt at the same intake, not a new
  // kind of call.
  const callId = data.call_id || data.callId || null;
  if (callId) {
    const seen = await sql()`
      select exists (
        select 1 from calls c
          join orders o on o.id = c.order_id
         where o.client_account_id is not null
           and o.client_account_id = (select client_account_id from orders where id = ${order.id})
           and c.transcript_encrypted is not null
      ) as before
    `;
    const kind = seen[0]?.before ? 'follow-up' : 'intake';
    await sql()`
      insert into calls (order_id, kind, call_id) values (${order.id}, ${kind}, ${callId})
      on conflict (call_id) do nothing
    `;
  }

  send(res, 200, {
    accessToken,
    callId,
    remaining: Math.max(0, MAX_SESSION_STARTS - Number(taken[0].session_starts || 0)),
  });
});
