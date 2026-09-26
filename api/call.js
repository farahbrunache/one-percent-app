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
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
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
    throw new HttpError(
      502,
      `The voice service started a session but returned no access token. It sent: ${text.slice(0, 300)}`,
    );
  }

  // Counted only once the session actually exists, so a failure on their side costs nobody
  // one of their three.
  await sql()`
    update orders set
      session_starts = session_starts + 1,
      first_started_at = coalesce(first_started_at, now())
    where id = ${order.id}
  `;

  send(res, 200, {
    accessToken,
    callId: data.call_id || data.callId || null,
    remaining: MAX_SESSION_STARTS - Number(order.session_starts || 0) - 1,
  });
});
