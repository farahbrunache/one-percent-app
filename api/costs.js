// What delivering a session costs, read-only.
//
// Nothing here writes, decides or quotes. It adds up what the voice service charged and what
// the drafting worker ran for, puts it against the seven dollars, and names every figure it
// could not work out.
//
// It is admin-only because it is the owner's own arithmetic, and because the orders it lists
// are the people who have paid.

import { ensureSchema, sql } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { costsNow, isCostUnit } from '../lib/costs.js';
import { normalizeReference } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

async function now(req, res) {
  requireAdmin(req);
  await ensureSchema();
  send(res, 200, await costsNow());
}

// A cost line, typed in rather than set somewhere a laptop is needed to reach. The share is
// what makes a tool bought once and used across three things carry a third of its price here.
async function addLine(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);

  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'A cost line needs a name. Render, the domain, your time.');

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'What does it cost, in dollars?');
  }
  const cents = Math.round(amount * 100);

  // A hundred where nothing is said, because most bills are not shared.
  const share = body.share === undefined || body.share === null || body.share === ''
    ? 100
    : Number(body.share);
  if (!Number.isFinite(share) || share <= 0 || share > 100) {
    throw new HttpError(400, 'The share is a number from 1 to 100. A third of a bill is 33.');
  }

  const every = String(body.every || 'month');
  if (!isCostUnit(every)) {
    throw new HttpError(400, 'A line is charged every month or per second of drafting.');
  }

  // One rate, because two would be two answers to what a second costs.
  if (every === 'draft-second') {
    const [already] = await sql()`select id from cost_lines where every = 'draft-second' limit 1`;
    if (already) {
      await sql()`delete from cost_lines where id = ${Number(already.id)}`;
    }
  }

  // Whose cost it is. Nothing means the product: hosting, a tool, time spent on the thing
  // itself. A reference means time or money spent on that one person.
  let orderId = null;
  const reference = normalizeReference(body.reference || '');
  if (reference) {
    const [found] = await sql()`
      select id, is_demo from orders where reference_code = ${reference} limit 1
    `;
    if (!found) throw new HttpError(404, `No session with the reference ${reference}.`);
    // What a demo row costs is real and it is the project's, because nobody paid seven dollars
    // for it. Hanging a cost on one would invent a client who was never served.
    if (found.is_demo) {
      throw new HttpError(
        409,
        'That is a demo session. What testing costs is real, and it belongs to the project '
          + 'rather than to a client nobody served. Leave the reference empty for that.',
      );
    }
    orderId = Number(found.id);
  }

  await sql()`
    insert into cost_lines (name, amount_cents, share_percent, every, note, order_id)
    values (${name}, ${cents}, ${Math.round(share)}, ${every},
            ${String(body.note || '').trim().slice(0, 300) || null}, ${orderId})
  `;
  send(res, 201, { ok: true });
}

async function removeLine(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which line?');
  const gone = await sql()`delete from cost_lines where id = ${id} returning id`;
  if (!gone.length) throw new HttpError(404, 'No cost line with that number.');
  send(res, 200, { ok: true });
}

export default handle(['GET', 'POST'], async (req, res) => {
  const action = new URL(req.url, 'https://placeholder.invalid').searchParams.get('action');
  if (req.method === 'GET' && action === 'now') return now(req, res);
  if (req.method === 'POST' && action === 'line-add') return addLine(req, res);
  if (req.method === 'POST' && action === 'line-remove') return removeLine(req, res);
  throw new HttpError(400, 'Use action=now, action=line-add or action=line-remove.');
});
