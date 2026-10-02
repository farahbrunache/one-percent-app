// What the drafting worker actually cost, read from the bill rather than worked out.
//
// Everything else on the cost screen is either a real charge recorded when it happened (a call)
// or a figure somebody typed in (the monthly lines). Drafting was neither: it was seconds the
// worker ran, times a rate somebody guessed, and a guess times a measurement is still a guess.
//
// Runpod bills per endpoint, so the figure for this product's own endpoints can be asked for
// directly. That matters more than convenience: the Runpod account is shared with Charging The
// Future, and an account-wide total would put that product's spending in this product's figures.
// The v2 route returns account-wide totals with no endpoint filter, which is exactly the number
// that must not be used here. The v1 route takes `endpointId`, so it is the one.
//
// Nothing here writes. It reads a bill and hands back daily figures; the caller decides what to
// do with them.

const BILLING = 'https://rest.runpod.io/v1/billing/endpoints';

// Which endpoints are this product's, worked out from the drafting settings rather than asked
// for separately. A slot's address is `https://api.runpod.ai/v2/<endpoint-id>`, so the id is
// already configured and a second setting holding the same value would be a second thing to keep
// in step.
export function endpointIds(env = process.env) {
  const ids = new Set();
  for (const name of ['DRAFT_MODEL_A_URL', 'DRAFT_MODEL_B_URL']) {
    const url = (env[name] || '').trim();
    if (!url) continue;
    const match = /\/v2\/([A-Za-z0-9_-]+)/.exec(url);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

// A day, as the bill buckets them. Billing runs about an hour behind, so today's figure is a
// running total rather than a settled one -- which is why what this produces has to be revisable
// rather than written once.
function dayStart(at) {
  const day = new Date(at);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

export function windowFor(days, now = new Date()) {
  const end = dayStart(now);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = dayStart(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// One endpoint's daily figures. Returns [] rather than throwing when nothing is configured,
// because a product with no drafting endpoint has no drafting bill and that is not an error.
async function readOne(endpointId, key, window, fetcher) {
  const address = `${BILLING}?${new URLSearchParams({
    endpointId,
    bucketSize: 'day',
    startTime: window.start,
    endTime: window.end,
  })}`;

  const answer = await fetcher(address, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  });

  if (!answer.ok) {
    const body = await answer.text().catch(() => '');
    throw new Error(
      `Runpod answered ${answer.status} for the billing of endpoint ${endpointId}. `
        + `The key is RUNPOD_API_KEY and it has to be one this account issued. ${body}`.trim(),
    );
  }

  const rows = await answer.json();
  if (!Array.isArray(rows)) {
    throw new Error('Runpod billing came back as something other than a list of records.');
  }
  return rows;
}

// Every configured endpoint's daily spend, added together per day.
//
// Added rather than kept apart because two slots are two models of one tool, and what the cost
// screen asks is what drafting cost -- not what each slot cost. Splitting them would be a
// different question nobody has.
export async function draftingByDay({ days = 35, env = process.env, fetcher = fetch } = {}) {
  // Named rather than reached through the bag, so the settings check can see that something
  // reads it and the deploy list and the code cannot drift apart.
  const key = (env === process.env ? process.env.RUNPOD_API_KEY || '' : env.RUNPOD_API_KEY || '').trim();
  if (!key) {
    throw new Error(
      'RUNPOD_API_KEY is not set, so the drafting bill cannot be read. It goes in One Percent\'s '
        + 'own project in the settings store, never a value copied from anywhere else.',
    );
  }

  const ids = endpointIds(env);
  if (!ids.length) return { days: [], endpoints: [] };

  const window = windowFor(days);
  const perDay = new Map();
  for (const id of ids) {
    for (const row of await readOne(id, key, window, fetcher)) {
      const at = dayStart(row.time || window.start).toISOString();
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      perDay.set(at, (perDay.get(at) || 0) + amount);
    }
  }

  return {
    endpoints: ids,
    days: [...perDay.entries()]
      .map(([at, amount]) => ({ at, amount }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
  };
}
