// What the voice service holds, read live.
//
// Two reads and no writes: everything that service knows about one call, and the script its
// agent runs. Neither is stored here -- the copy that matters stays theirs, and a copy kept
// here would diverge from what they actually say.
//
// Out of the endpoint because the endpoint passed its size limit, and because this is the only
// part of the desk that talks to somebody else's service.

import { ensureSchema, sql } from './db.js';
import { keepRecord } from './calls.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, send } from './http.js';
import { agentScriptExport } from './voice.js';
import Retell from 'retell-sdk';

function query(req) {
  return new URL(req.url, 'https://placeholder.invalid').searchParams;
}

// Everything the voice service holds about one call, as it holds it.
//
// What is kept here is the transcript and the summary, because those are what the work runs
// on. The service keeps a great deal more -- how the agent was configured for that call, what
// it cost, latencies, where each turn began and ended, why it ended -- and none of it is worth
// a column until something needs it.
//
// What needs it is building a test case out of a real call, which is the only honest way to
// write one for a conversation. So it is fetched live and handed over whole, rather than
// stored and slowly diverging from what the service actually said.
//
// Nothing is written down by this. It is a read, and the copy that matters stays theirs.
export async function callRecord(req, res) {
  requireAdmin(req);
  const callId = String(query(req).get('call') || '').trim();
  if (!callId) throw new HttpError(400, 'Which call? Pass the id the voice service gave it.');

  const apiKey = process.env.RETELL_SECRET_KEY;
  if (!apiKey) throw new HttpError(503, 'RETELL_SECRET_KEY is not set, so nothing can be asked.');

  await ensureSchema();

  // Only a call this site opened. The id comes from the screen, but the screen is not what
  // decides whether it may be read.
  const ours = await sql()`select 1 from calls where call_id = ${callId} limit 1`;
  if (!ours.length) {
    throw new HttpError(404, `No call here was started with the id ${callId}.`);
  }

  try {
    const record = await new Retell({ apiKey }).call.retrieve(callId);

    // Kept on the way past. Their retention is seven days, so a call made before anything here
    // asked for its record can still be caught by somebody opening it -- and after that it is
    // gone from both sides. Reading it is the only chance some calls will get.
    await keepRecord(callId, encrypt(JSON.stringify(record)));

    send(res, 200, record);
  } catch (error) {
    if (error instanceof Retell.APIError) {
      throw new HttpError(
        502,
        `The voice service would not hand over call ${callId} (${error.status}): ` +
          JSON.stringify(error.error ?? error.message).slice(0, 400),
      );
    }
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }
}

// The script the agent runs, as the voice service holds it. Read by this button and by the job
// on a clock, which is why the gathering of it lives in lib/voice.js rather than in either.
export async function agentScript(req, res) {
  requireAdmin(req);

  const apiKey = process.env.RETELL_SECRET_KEY;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new HttpError(503, 'RETELL_SECRET_KEY or RETELL_AGENT_ID is not set, so nothing can be asked.');
  }

  try {
    send(res, 200, await agentScriptExport(new Retell({ apiKey }), agentId));
  } catch (error) {
    if (error instanceof Retell.APIError) {
      throw new HttpError(
        502,
        `The voice service would not hand over the agent (${error.status}): ` +
          JSON.stringify(error.error ?? error.message).slice(0, 400),
      );
    }
    throw new HttpError(502, `Could not reach the voice service: ${error.message}`);
  }
}
