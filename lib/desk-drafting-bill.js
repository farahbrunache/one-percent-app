// Reading the drafting bill into the ledger.
//
// The cost screen priced drafting as seconds times a rate somebody typed in. Runpod bills per
// endpoint and the real figure can be asked for, so it is asked for.
//
// Two ways in, both landing here: a scheduled job, so the figures stay current without anybody
// pressing anything, and a button on the cost screen for when somebody wants to know now.

import { ensureSchema } from './db.js';
import { requireAdmin } from './auth.js';
import { HttpError, send } from './http.js';
import { draftingByDay } from './runpod-billing.js';
import { recordMeteredSpend } from './spend.js';

// The project's cost rather than any one client's. Drafting is the operator's own tool: nobody
// is charged for a draft, it comes out of the same seven dollars, and attributing a share of a
// day's bill to whoever happened to be drafted that day would invent a figure.
const WAS_DEMO = true;

export async function pullDraftingBill() {
  await ensureSchema();
  const bill = await draftingByDay();

  let written = 0;
  let total = 0;
  for (const day of bill.days) {
    await recordMeteredSpend({
      kind: 'drafting',
      source: `drafting:${day.at.slice(0, 10)}`,
      amountCents: Math.round(day.amount * 100),
      wasDemo: WAS_DEMO,
      at: day.at,
    });
    written += 1;
    total += day.amount;
  }

  return { endpoints: bill.endpoints.length, days: written, total };
}

// The scheduled caller, which proves itself with the same secret the record sweep uses rather
// than a second one. Both are the same kind of caller -- a job on a clock reaching one endpoint
// -- and a second secret would be a second thing to rotate for no extra safety.
export async function draftingBillSweep(req, res) {
  const expected = (process.env.SWEEP_SECRET || '').trim();
  if (!expected) {
    throw new HttpError(
      503,
      'SWEEP_SECRET is not set, so a scheduled caller cannot prove itself and this refuses '
        + 'rather than running for anybody who asks.',
    );
  }
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (given !== expected) throw new HttpError(401, 'That is not the sweep secret.');

  send(res, 200, await pullDraftingBill());
}

// The same work, pressed by the owner on the cost screen.
export async function pullBillNow(req, res) {
  requireAdmin(req);
  send(res, 200, await pullDraftingBill());
}
