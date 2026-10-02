// How far people get. Two funnels, because there are two questions.
//
// Out of the endpoint because the endpoint passed its size limit again, and because this is the
// one thing on the desk that is about everybody rather than about one person.
//
// The six rows measure whether the method worked for the person who called. The four measure
// whether selling the call works. Both start from the call and neither is a version of the other.
//
// The six have no row above the call and are not getting one. Nothing about how somebody arrived
// at the sales page is visible from here and nothing ever will be, so a row there would be a
// guess drawn as a measurement.
//
// The four do have a row above it, and it is the size of the list being approached. That is a
// figure the operator keeps rather than one this product can count -- the list lives in the other
// product's Directory, behind a boundary that carries vocabulary and nothing about a person -- so
// it is entered, and the screen says so rather than letting it pass as counted.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { FUNNEL_STAGES, POOL_SETTING, SELLING_STAGES } from './desk.js';
import { readChoice, writeChoice } from './settings.js';

// The funnel, counted rather than entered. Six numbers, each a strict subset of the one above,
// so the drop between two of them is a real rate and not two unrelated figures side by side.
//
// A person with more than one order is counted once. Somebody who came back for a second
// session is not two people, and a funnel that said so would overstate the top and understate
// every rate below it.
export async function funnel(req, res) {
  requireAdmin(req);
  await ensureSchema();

  const rows = await sql()`
    with people as (
      select o.id,
             coalesce('case:' || o.case_id, 'order:' || o.id) as who,
             o.decision,
             (select k.first_customer_at from cases k where k.id = o.case_id) as first_customer_at,
             exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null) as called,
             exists (select 1 from plans p
                      where p.in_force
                        and (p.case_id = o.case_id or (o.case_id is null and p.order_id = o.id))
                    ) as planned,
             exists (select 1 from contacts ct where ct.case_id = o.case_id) as listed,
             exists (select 1 from contacts ct join outreach ou on ou.contact_id = ct.id
                      where ct.case_id = o.case_id) as approached
        from orders o
       where o.status = 'confirmed'
    )
    select
      count(distinct who) filter (where called) as called,
      count(distinct who) filter (where called and decision = 'go') as go,
      count(distinct who) filter (where called and decision = 'go' and planned) as planned,
      count(distinct who) filter (where called and decision = 'go' and planned and listed) as listed,
      count(distinct who) filter (
        where called and decision = 'go' and planned and listed and approached) as approached,
      -- Cumulative like every row above it. It was not, and that made the rate under the last
      -- row meaningless: somebody could appear at the bottom of the funnel without appearing
      -- anywhere above it, so the drop between the last two rows was two unrelated figures side
      -- by side. A first customer who never called is not somebody this method reached.
      --
      -- Their own record still carries the date whatever the funnel says. This counts people who
      -- went through the method; that records what happened to one person.
      count(distinct who) filter (
        where called and decision = 'go' and planned and listed and approached
          and first_customer_at is not null) as earning
      from people
  `;
  const counts = rows[0] || {};

  const selling = await sellingRows();

  let above = null;
  send(res, 200, {
    selling,
    stages: FUNNEL_STAGES.map((stage) => {
      const count = Number(counts[stage.key] || 0);
      // The rate from the stage above, which is the only comparison that means anything. The
      // first stage has nothing above it, and a stage below an empty one has no rate either.
      const rate = above === null ? null : above === 0 ? null : Math.round((count / above) * 100);
      above = count;
      return { key: stage.key, label: stage.label, count, rate };
    }),
  });
}

// What it took to get a call, and what a call turned into.
//
// Counted the same way as the six above -- one person counted once, each row a strict subset of
// the one over it -- so the drop between two rows is a rate. The exception is the top row, which
// is the size of the list and cannot be counted from here.
//
// A piece of work can exist with no quote behind it, so making the last row a subset of the one
// above can read lower than the work actually delivered. It stays a subset anyway, because a rate
// between two rows means nothing when somebody can appear in the lower one without appearing in
// the higher one. The person's own record carries what was handed over whatever this says.
async function sellingRows() {
  const rows = await sql()`
    with people as (
      select coalesce('case:' || o.case_id, 'order:' || o.id) as who,
             exists (select 1 from calls c
                      where c.order_id = o.id and c.transcript_encrypted is not null) as called,
             exists (select 1 from quotes q
                      where q.account_id = o.client_account_id
                        and q.answered_at is not null) as answered,
             exists (select 1 from projects w
                      where w.case_id = o.case_id and w.delivered_at is not null) as delivered
        from orders o
       where o.status = 'confirmed'
    )
    select
      count(distinct who) filter (where called) as called,
      count(distinct who) filter (where called and answered) as answered,
      count(distinct who) filter (where called and answered and delivered) as delivered
      from people
  `;
  const counts = rows[0] || {};
  const written = await readChoice(POOL_SETTING);
  const pool = written === null || written === '' ? null : Number(written);

  let above = null;
  return {
    pool,
    stages: SELLING_STAGES.map((stage) => {
      const count = stage.key === 'pool' ? pool : Number(counts[stage.key] || 0);
      // No rate under a row that was never filled in, and none under an empty one. A rate
      // against a missing top row would be a division by a figure nobody has given.
      const rate = above === null || above === 0 || count === null
        ? null
        : Math.round((count / above) * 100);
      above = count;
      return { key: stage.key, label: stage.label, count, rate, entered: Boolean(stage.entered) };
    }),
  };
}

// How many people there are to approach. The one figure here the operator owns, so it is written
// rather than derived, and clearing it is allowed: no figure is better than a wrong one.
export async function setPool(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);

  // One more person approached, which is the daily case: a tap rather than retyping the count.
  // Read and written here rather than added on the screen, so a screen opened yesterday can't
  // write yesterday's figure plus one.
  if (body.add !== undefined) {
    if (body.add !== 1) throw new HttpError(400, 'Adding to the list goes up by one at a time.');
    const written = await readChoice(POOL_SETTING);
    const before = written === null || written === '' ? null : Number(written);
    const pool = (before || 0) + 1;
    if (pool > 9_999_999) throw new HttpError(400, 'The list is at its largest count, seven digits.');
    await writeChoice(POOL_SETTING, String(pool));
    return send(res, 200, { pool, before });
  }

  const given = String(body.pool ?? '').trim();

  if (given === '') {
    await writeChoice(POOL_SETTING, '');
    return send(res, 200, { pool: null });
  }
  if (!/^\d{1,7}$/.test(given)) {
    throw new HttpError(400, 'The number of people to approach has to be a plain count, digits '
      + 'only, up to seven of them. Leave it empty to take the figure off the screen.');
  }
  await writeChoice(POOL_SETTING, given);
  send(res, 200, { pool: Number(given) });
}
