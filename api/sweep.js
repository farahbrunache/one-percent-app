// The jobs that run on a clock rather than because somebody pressed something.
//
// Two of them, and both exist for the same reason: the voice service forgets a call after seven
// days, and the script the agent runs lives in their dashboard and nowhere else. Anything that
// depends on a person remembering to press a button is a record that will eventually be lost on
// a week nobody was looking.
//
// Called by a scheduled workflow, which proves itself with a shared secret rather than a
// sign-in. There is no person here to sign in, and an admin session is not something a workflow
// should be able to hold.

import Retell from 'retell-sdk';

import { ensureSchema, sql } from '../lib/db.js';
import { keepRecord } from '../lib/calls.js';
import { encrypt } from '../lib/crypto.js';
import { HttpError, handle, send } from '../lib/http.js';
import { agentScriptExport } from '../lib/voice.js';

// How many calls one run will fetch. A sweep that tries everything at once against a service
// that rate limits is a sweep that half works and reports success; the next run takes the rest.
const PER_RUN = 25;

function requireSweeper(req) {
  const secret = process.env.SWEEP_SECRET;
  if (!secret) {
    throw new HttpError(503, 'SWEEP_SECRET is not set, so a scheduled job cannot prove itself.');
  }
  const sent = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // Compared at full length rather than by first difference.
  if (sent.length !== secret.length || sent !== secret) {
    throw new HttpError(401, 'That is not the scheduled job.');
  }
}

// Every call whose record was never kept. The window is seven days on their side, so this runs
// often enough that a webhook lost on a bad afternoon is still caught the same day.
async function records(res, retell) {
  const waiting = await sql()`
    select call_id from calls
      where record_encrypted is null
        and call_id is not null
        and started_at > now() - interval '7 days'
      order by started_at asc
      limit ${PER_RUN}
  `;

  const kept = [];
  const missed = [];
  for (const row of waiting) {
    try {
      const record = await retell.call.retrieve(row.call_id);
      await keepRecord(row.call_id, encrypt(JSON.stringify(record)));
      kept.push(row.call_id);
    } catch (error) {
      // Named rather than counted. A call that cannot be kept is one that will be gone, and
      // knowing which one is the difference between a fix and a shrug.
      missed.push({ call: row.call_id, said: error.message });
    }
  }

  send(res, 200, { looked: waiting.length, kept: kept.length, missed });
}

export default handle('POST', async (req, res) => {
  requireSweeper(req);

  const apiKey = process.env.RETELL_SECRET_KEY;
  if (!apiKey) throw new HttpError(503, 'RETELL_SECRET_KEY is not set, so nothing can be asked.');

  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');
  const retell = new Retell({ apiKey });

  if (action === 'records') {
    await ensureSchema();
    return records(res, retell);
  }

  if (action === 'script') {
    const agentId = process.env.RETELL_AGENT_ID;
    if (!agentId) throw new HttpError(503, 'RETELL_AGENT_ID is not set.');
    return send(res, 200, await agentScriptExport(retell, agentId));
  }

  throw new HttpError(400, 'The jobs here are: records, script.');
});
