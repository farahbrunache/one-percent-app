// How far people get, as six numbers.
//
// Out of the endpoint because the endpoint passed its size limit again, and because this is the
// one thing on the desk that is about everybody rather than about one person.
//
// It starts at the call because nothing above that is visible: leads arrive with no address and
// no open rate, and a top row invented to make the shape look right would be a guess presented
// as a measurement.

import { ensureSchema, sql } from './db.js';
import { requireAdmin } from './auth.js';
import { send } from './http.js';
import { FUNNEL_STAGES } from './desk.js';

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

  let above = null;
  send(res, 200, {
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
