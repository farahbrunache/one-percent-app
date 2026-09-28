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

import { verify } from 'retell-sdk';

import { ensureSchema, sql } from '../lib/db.js';
import { encrypt } from '../lib/crypto.js';
import { HttpError, handle, readRaw, send } from '../lib/http.js';

// Retell signs every delivery. There is no shared secret to agree on and no custom header to
// send one in — the webhook settings are a URL and a timeout, and that is all of it.
//
// The signature is `v=<unix ms>,d=<hex>`, an HMAC-SHA256 over the raw body with the timestamp
// appended, keyed with the Retell API key. The check is theirs rather than reimplemented here:
// getting the concatenation backwards would refuse every real delivery while looking correct,
// and this has to be right without a live account to try it against.
//
// The timestamp is part of what is signed, and the library refuses one outside its window, so a
// delivery captured off the wire cannot be replayed later.
async function checkSignature(req, body) {
  const apiKey = process.env.RETELL_SECRET_KEY;
  if (!apiKey) {
    throw new HttpError(
      503,
      'RETELL_SECRET_KEY is not set, so a delivery cannot be checked against anything. It is ' +
        'the same API key the site starts calls with, and in Retell it is the one carrying the ' +
        'webhook badge — another key will not verify a signature.',
    );
  }

  const signature = req.headers['x-retell-signature'];
  if (!signature) throw new HttpError(401, 'That delivery carries no signature.');

  let ok = false;
  try {
    ok = await verify(body, apiKey, String(signature));
  } catch {
    // A signature that is not the shape the library expects. Not this webhook either way.
    ok = false;
  }
  if (!ok) throw new HttpError(401, 'That signature does not check out.');
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
  // The body is read before anything else, because the signature is over the bytes as they
  // arrived. Parsing and re-serializing first would produce different bytes and fail every
  // genuine delivery.
  const raw = await readRaw(req);
  await checkSignature(req, raw);

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
