// What the voice service sends back when a session ends.
//
// Retell keeps the transcript in its own dashboard. That is not a place the work can be done
// from: the owner reads a transcript on a phone and starts the next conversation from it, and
// a session nobody can read is a session that produced nothing.
//
// So the transcript is copied here, onto the call record opened when the session started. The
// call's own id is what matches them, and that id was minted by the voice service and written
// here at the start — so a delivery naming a session this site never started finds nothing.
//
// It is encrypted at rest, like the card codes. A transcript is somebody's trade, their rate,
// their first customer and what is standing in their way.

import { ensureSchema, sql } from '../lib/db.js';
import { encrypt, timingSafeEqual } from '../lib/crypto.js';
import { HttpError, handle, readRaw, send } from '../lib/http.js';

// Retell is told this when the webhook is set up, and it comes back on every delivery. A
// shared secret rather than a signature: the signature format is the voice service's to
// change, and this has to be right the first time without a live account to test against.
function checkSecret(req) {
  const expected = process.env.RETELL_WEBHOOK_SECRET;
  if (!expected || expected.length < 16) {
    throw new HttpError(
      503,
      'RETELL_WEBHOOK_SECRET is missing or shorter than 16 characters. Set it in the ' +
        'service settings and give Retell the same value.',
    );
  }
  // A header only. The same value in the address ends up in access logs, in anything between
  // here and there, and in a browser's history if it is ever opened by hand — and one leaked
  // line is all a forged delivery needs.
  const sent = req.headers['x-retell-secret'] || '';
  if (!timingSafeEqual(String(sent), expected)) {
    throw new HttpError(401, 'That is not this webhook.');
  }
}

// The shape differs between the events Retell sends and between versions of them, so every
// field is looked for in more than one place and nothing is required except the call itself.
function readCall(payload) {
  const call = payload.call || payload.data || payload;
  const analysis = call.call_analysis || call.analysis || null;

  const startMs = Number(call.start_timestamp) || 0;
  const endMs = Number(call.end_timestamp) || 0;
  const seconds =
    Number(call.duration_ms) > 0
      ? Math.round(Number(call.duration_ms) / 1000)
      : endMs > startMs
        ? Math.round((endMs - startMs) / 1000)
        : null;

  return {
    id: call.call_id || call.id || null,
    transcript: typeof call.transcript === 'string' ? call.transcript : null,
    analysis,
    endedAt: endMs ? new Date(endMs).toISOString() : null,
    seconds,
  };
}

export default handle('POST', async (req, res) => {
  checkSecret(req);

  const raw = await readRaw(req);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, `That delivery was not readable as JSON: ${error.message}`);
  }

  const call = readCall(payload);
  if (!call.id) throw new HttpError(400, 'That delivery names no call.');
  await ensureSchema();

  // Retell sends more than one event for a call and the later one carries more, so this
  // overwrites — but never writes a null over something already there, because the earlier
  // event is sometimes the only one with a field in it.
  const transcript = call.transcript ? encrypt(call.transcript) : null;
  const summary = call.analysis ? encrypt(JSON.stringify(call.analysis)) : null;

  // The row api/call.js opened when the session started is what this fills in. Matching on the
  // call id alone is enough and is the whole check: that id was minted by the voice service and
  // written here at start, so a delivery naming an order it does not belong to finds nothing.
  //
  // The later event carries more than the earlier one, so this overwrites — but `coalesce`
  // never writes a null over something already there, because sometimes the earlier event is
  // the only one with a field in it.
  const rows = await sql()`
    update calls set
      transcript_encrypted = coalesce(${transcript}, transcript_encrypted),
      summary_encrypted = coalesce(${summary}, summary_encrypted),
      ended_at = coalesce(${call.endedAt}, ended_at),
      seconds = coalesce(${call.seconds}, seconds)
    where call_id = ${call.id}
    returning id
  `;
  if (!rows.length) {
    throw new HttpError(
      404,
      `No session here is expecting call ${call.id}. Either it was never started from this ` +
        'site, or it was started against an order that no longer exists.',
    );
  }

  // Nothing about the caller goes back out. Retell needs only to know it landed.
  send(res, 200, { ok: true });
});
