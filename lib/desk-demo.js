// The demo records, and marking a session as the owner's own.
//
// One subject: everything about testing the product on the only instance there is. Seeding rows
// that look like work, clearing them, and saying that a session the owner bought and called
// through is theirs rather than a client's.
//
// Out of the endpoint because the endpoint passed its size limit, and because none of it is
// about a person who paid.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { clearDemo, seedDemo } from './demo.js';
import { orderId, record } from './desk-events.js';

// Demo records, made and removed from the desk because there is no terminal and no second
// instance. Both are admin-only, and the delete refuses anything without the mark -- see
// lib/demo.js for why that is a refusal rather than a filter.
// Marking a session the owner made themselves, so its seven dollars stays out of the revenue
// and its costs stay in.
//
// Different from a seeded row, and the difference is what was spent. A seeded row is invented
// end to end: no call was placed and no worker ran, so counting its figures would put money on
// the cost screen that was never spent. A session the owner buys and calls through to test
// bills the voice service for real, and that bill is the price of having a product rather than
// the price of serving somebody.
//
// One way only. An order marked as the owner's own stays that way, because unmarking it would
// move real spending onto a client who never existed and let seven dollars nobody sent into
// the revenue.
export async function markMine(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);

  const rows = await sql()`select is_demo from orders where id = ${id}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  if (rows[0].is_demo) {
    throw new HttpError(409, 'That one is already marked as yours.');
  }

  await sql()`update orders set is_demo = true where id = ${id}`;
  await record(id, 'note', 'Marked as the owner\'s own: no revenue counted, costs are the '
    + "project's.");
  send(res, 200, { ok: true });
}

export async function demoSeed(req, res) {
  requireAdmin(req);
  await ensureSchema();
  send(res, 201, { made: await seedDemo() });
}

export async function demoClear(req, res) {
  requireAdmin(req);
  await ensureSchema();
  send(res, 200, await clearDemo());
}
