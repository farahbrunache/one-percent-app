// What delivering a session costs, read-only.
//
// Nothing here writes, decides or quotes. It adds up what the voice service charged and what
// the drafting worker ran for, puts it against the seven dollars, and names every figure it
// could not work out.
//
// It is admin-only because it is the owner's own arithmetic, and because the orders it lists
// are the people who have paid.

import { ensureSchema } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { costsNow } from '../lib/costs.js';
import { HttpError, handle, send } from '../lib/http.js';

async function now(req, res) {
  requireAdmin(req);
  await ensureSchema();
  send(res, 200, await costsNow());
}

export default handle(['GET'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');
  if (req.method === 'GET' && action === 'now') return now(req, res);
  throw new HttpError(400, 'Use action=now.');
});
