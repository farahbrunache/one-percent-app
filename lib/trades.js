// The trade list, and the introductions it makes possible.
//
// The list is Charging The Future's skills taxonomy, read over the route that product opened for
// One Percent alone: sectors and job titles, nothing that joins a person to anything. It's copied
// here once a day so paid work never waits on the free product. What a trade is called is theirs;
// which trade a person here has is ours, and never goes the other way.
//
// The point is introductions. Two people in the same sector are people who can send each other
// work: the plumber and the electrician, the teacher and the tutor. Each introduction moves two
// people forward, so finding pairs fast is the one place a minute of the owner's time is spent
// on more than one person.

import { ensureSchema, sql } from './db.js';
import { HttpError } from './http.js';

const FETCH_MS = 15_000;

// Settings are read when used, so a deploy without them still serves every page.
function where() {
  const url = String(process.env.TAXONOMY_URL || '').replace(/\/+$/, '');
  const token = String(process.env.TAXONOMY_TOKEN || '');
  if (!url || !token) {
    throw new HttpError(503, 'TAXONOMY_URL or TAXONOMY_TOKEN is not set, so the trade list '
      + "can't be read from Charging The Future. Every trade already copied here still works.");
  }
  return { url, token };
}

export async function refreshTrades() {
  await ensureSchema();
  const { url, token } = where();
  let response;
  try {
    response = await fetch(`${url}/api/skills-taxonomy/hierarchy`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
  } catch (error) {
    throw new HttpError(502, `Charging The Future didn't answer for the trade list: ${error.message}. `
      + 'The copy here is unchanged.');
  }
  if (!response.ok) {
    throw new HttpError(502, `Charging The Future answered ${response.status} for the trade list. `
      + (response.status === 401 || response.status === 403
        ? 'TAXONOMY_TOKEN is wrong or was revoked. It is sent as name.secret. '
        : '')
      + 'The copy here is unchanged.');
  }
  const body = await response.json();
  const seen = [];
  for (const sector of body.items || []) {
    for (const title of sector.jobTitles || []) {
      seen.push(String(title.id));
      await sql()`
        insert into trades (id, title, sector_id, sector, sector_order, title_order, active, refreshed_at)
        values (${String(title.id)}, ${title.name}, ${String(sector.id)}, ${sector.name},
                ${Number(sector.displayOrder) || 0}, ${Number(title.displayOrder) || 0},
                ${Boolean(sector.isActive !== false && title.isActive !== false)}, now())
        on conflict (id) do update set
          title = excluded.title, sector_id = excluded.sector_id, sector = excluded.sector,
          sector_order = excluded.sector_order, title_order = excluded.title_order,
          active = excluded.active, refreshed_at = now()
      `;
    }
  }
  // Gone from their list is inactive here, not deleted: a person's trade stays on their record.
  const retired = seen.length
    ? await sql()`update trades set active = false
                   where not is_demo and active and not (id = any(${seen})) returning id`
    : [];
  return { titles: seen.length, retired: retired.length };
}

// The list for the picker, grouped by sector in their order.
export async function tradeList() {
  const rows = await sql()`
    select id, title, sector, is_demo from trades
     where active
     order by sector_order, sector, title_order, title
  `;
  return rows.map((r) => ({ id: r.id, title: r.title, sector: r.sector, isDemo: Boolean(r.is_demo) }));
}

// People who could work with this one: the same trade (peers who share overflow and prices) and
// the same sector in another trade (people who send each other jobs). Only people told yes, since
// an introduction puts somebody in front of somebody else, and never two already introduced.
export async function suggestFor(orderId, limit = 5) {
  const me = await sql()`
    select o.id, o.case_id, o.trade_id, t.sector_id
      from orders o left join trades t on t.id = o.trade_id
     where o.id = ${orderId}
  `;
  if (!me.length || !me[0].trade_id) return { trade: null, same: [], sector: [] };
  const { case_id: caseId, trade_id: tradeId, sector_id: sectorId } = me[0];
  const rows = await sql()`
    select o.id, o.reference_code, o.is_demo, o.trade_id, t.title, k.name_encrypted,
           o.trade_id = ${tradeId} as same_trade
      from orders o
      join trades t on t.id = o.trade_id
      left join cases k on k.id = o.case_id
     where t.sector_id = ${sectorId}
       and o.decision = 'go'
       and o.id <> ${orderId}
       and (${caseId}::bigint is null or o.case_id is null or o.case_id <> ${caseId})
       and not exists (
         select 1 from introductions i
          where (i.a_order_id = ${orderId} and i.b_order_id = o.id)
             or (i.b_order_id = ${orderId} and i.a_order_id = o.id)
             or (${caseId}::bigint is not null and o.case_id is not null and (
                  (i.a_case_id = ${caseId} and i.b_case_id = o.case_id)
               or (i.b_case_id = ${caseId} and i.a_case_id = o.case_id)))
       )
     order by o.id desc
     limit ${limit * 4}
  `;
  return {
    trade: tradeId,
    same: rows.filter((r) => r.same_trade).slice(0, limit),
    sector: rows.filter((r) => !r.same_trade).slice(0, limit),
  };
}

// Pairs across everybody, for the list on Everybody: two people told yes, in the same sector,
// never introduced. Newest first, because a pair with somebody who just got a go is the one
// most likely to still be looking.
export async function pairsToIntroduce(limit = 10) {
  return sql()`
    select a.id as a_id, a.reference_code as a_ref, ka.name_encrypted as a_name, ta.title as a_title,
           b.id as b_id, b.reference_code as b_ref, kb.name_encrypted as b_name, tb.title as b_title,
           ta.sector, (a.is_demo or b.is_demo) as is_demo
      from orders a
      join trades ta on ta.id = a.trade_id
      join orders b on b.id > a.id and b.decision = 'go'
      join trades tb on tb.id = b.trade_id and tb.sector_id = ta.sector_id
      left join cases ka on ka.id = a.case_id
      left join cases kb on kb.id = b.case_id
     where a.decision = 'go'
       and (a.case_id is null or b.case_id is null or a.case_id <> b.case_id)
       and not exists (
         select 1 from introductions i
          where (i.a_order_id = a.id and i.b_order_id = b.id)
             or (i.a_order_id = b.id and i.b_order_id = a.id)
             or (a.case_id is not null and b.case_id is not null and (
                  (i.a_case_id = a.case_id and i.b_case_id = b.case_id)
               or (i.a_case_id = b.case_id and i.b_case_id = a.case_id)))
       )
     order by b.id desc, a.id desc
     limit ${limit}
  `;
}
