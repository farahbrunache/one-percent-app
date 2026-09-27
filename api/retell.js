// What the voice service sends back when a session ends.
//
// Retell keeps the transcript in its own dashboard. That is not a place the work can be done
// from: the owner reads a transcript on a phone and starts the next conversation from it, and
// a session nobody can read is a session that produced nothing.
//
// So the transcript is copied here, against the order it was bought with. The reference and
// the order id travelled out with the call, so nothing has to be matched by hand.
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
  const sent =
    req.headers['x-retell-secret'] ||
    new URL(req.url, 'https://placeholder.invalid').searchParams.get('k') ||
    '';
  if (!timingSafeEqual(String(sent), expected)) {
    throw new HttpError(401, 'That is not this webhook.');
  }
}

// The shape differs between the events Retell sends and between versions of them, so every
// field is looked for in more than one place and nothing is required except the call itself.
function readCall(payload) {
  const call = payload.call || payload.data || payload;
  const metadata = call.metadata || {};
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
    orderId: Number(metadata.order_id) || null,
    reference: metadata.reference ? String(metadata.reference) : null,
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
  if (!call.orderId && !call.reference) {
    throw new HttpError(400, `Call ${call.id} carries no order, so there is nothing to file it against.`);
  }

  await ensureSchema();

  // Retell sends more than one event for a call and the later one carries more, so this
  // overwrites — but never writes a null over something already there, because the earlier
  // event is sometimes the only one with a field in it.
  const transcript = call.transcript ? encrypt(call.transcript) : null;
  const summary = call.analysis ? encrypt(JSON.stringify(call.analysis)) : null;

  // Two statements rather than one with a condition inside it: this driver does not compose
  // a query out of pieces, and a query built by joining strings is how an injection gets in.
  const rows = call.orderId
    ? await sql()`
        update orders set
          call_id = ${call.id},
          transcript_encrypted = coalesce(${transcript}, transcript_encrypted),
          call_summary_encrypted = coalesce(${summary}, call_summary_encrypted),
          call_ended_at = coalesce(${call.endedAt}, call_ended_at),
          call_seconds = coalesce(${call.seconds}, call_seconds)
        where id = ${call.orderId}
        returning id
      `
    : await sql()`
        update orders set
          call_id = ${call.id},
          transcript_encrypted = coalesce(${transcript}, transcript_encrypted),
          call_summary_encrypted = coalesce(${summary}, call_summary_encrypted),
          call_ended_at = coalesce(${call.endedAt}, call_ended_at),
          call_seconds = coalesce(${call.seconds}, call_seconds)
        where reference_code = ${call.reference}
        returning id
      `;
  if (!rows.length) {
    throw new HttpError(
      404,
      `No order matches ${call.orderId ? `id ${call.orderId}` : `reference ${call.reference}`}.`,
    );
  }

  // Nothing about the caller goes back out. Retell needs only to know it landed.
  send(res, 200, { ok: true });
});
