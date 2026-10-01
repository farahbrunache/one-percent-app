// The things somebody actually has to do, and coming back to ask about them.
//
// A milestone says where the work is headed. It is too big to pick up on a Tuesday, so it sat
// on the record as a heading with nothing under it, and the actual next move lived in the
// owner's head. These are that move, written down.
//
// Three operations and nothing else: add one, close it out with what happened, and push its
// date back when you have asked and it is still going. Everything here is the owner's own
// working notes about somebody else's situation, so nothing in it reaches the client.

import { ensureSchema, sql } from './db.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { ACTION_STATUSES, CADENCES, isActionStatus, isCadence, nextDueAt } from './desk.js';
import { orderId, record } from './desk-events.js';

// An action item belongs to a milestone, which belongs to the plan in force, which belongs to
// the person this order is for. Checking the chain in the statement rather than in three
// queries means there is no moment between the check and the write where it stops being true.
async function milestoneUnder(orderIdValue, milestoneId) {
  const rows = await sql()`
    select m.id from milestones m
      join plans p on p.id = m.plan_id
     where m.id = ${milestoneId} and p.order_id = ${orderIdValue} and p.in_force
  `;
  if (!rows.length) {
    throw new HttpError(404, 'No milestone with that number under this person\'s current plan.');
  }
  return Number(rows[0].id);
}

async function itemUnder(orderIdValue, itemId) {
  const rows = await sql()`
    select a.id, a.status from action_items a
      join milestones m on m.id = a.milestone_id
      join plans p on p.id = m.plan_id
     where a.id = ${itemId} and p.order_id = ${orderIdValue} and p.in_force
  `;
  if (!rows.length) {
    throw new HttpError(404, 'No action with that number under this person\'s current plan.');
  }
  return rows[0];
}

export async function addAction(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const milestoneId = await milestoneUnder(id, orderId(body.milestoneId));

  const title = String(body.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'An action needs a line saying what to do.');

  const cadence = String(body.cadence || 'none');
  if (!isCadence(cadence)) {
    throw new HttpError(400, `Pick how often to come back: ${Object.keys(CADENCES).join(', ')}.`);
  }

  const next = await sql()`
    select coalesce(max(position), 0) + 1 as n from action_items
     where milestone_id = ${milestoneId}
  `;
  await sql()`
    insert into action_items (milestone_id, position, title_encrypted, cadence, next_at)
    values (${milestoneId}, ${next[0].n}, ${encrypt(title)}, ${cadence},
            ${nextDueAt(cadence)})
  `;
  await record(id, 'action.added', title);
  send(res, 201, { ok: true });
}

// Closing one out. The words are the point: a status on its own says nothing anybody can act on
// months later, and what happened is usually the thing that changes the next step.
export async function recordAction(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const item = await itemUnder(id, orderId(body.actionId));

  const status = String(body.status || '');
  if (!isActionStatus(status)) {
    throw new HttpError(400, `Pick a status: ${ACTION_STATUSES.join(', ')}.`);
  }
  const outcome = String(body.outcome || '').trim().slice(0, 2000);

  // Reopening is allowed and puts the item back on its cadence, because somebody saying they
  // are back on something is the ordinary case and a list that cannot take it back is a list
  // people work around.
  const open = status === 'open';
  const [row] = await sql()`select cadence from action_items where id = ${item.id}`;
  await sql()`
    update action_items set
      status = ${status},
      outcome_encrypted = ${outcome ? encrypt(outcome) : null},
      closed_at = ${open ? null : new Date().toISOString()},
      next_at = ${open ? nextDueAt(row.cadence) : null},
      updated_at = now()
    where id = ${item.id}
  `;
  await record(id, 'action.recorded', `${status}. ${outcome}`.trim());
  send(res, 200, { ok: true, status });
}

// Asked about it, still going. Pushes the date out by its own cadence from now rather than from
// the date it was due, so an item asked about late comes back a full cycle later rather than
// the morning after.
export async function pushAction(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const item = await itemUnder(id, orderId(body.actionId));
  if (item.status !== 'open') {
    throw new HttpError(409, 'That one is closed out. Reopen it to put it back on a cadence.');
  }

  const [row] = await sql()`select cadence from action_items where id = ${item.id}`;
  const at = nextDueAt(row.cadence);
  if (at === null) {
    throw new HttpError(
      409,
      'That one has no reminder on it, so there is no date to push. Nothing is waiting.',
    );
  }

  await sql()`
    update action_items set next_at = ${at}, updated_at = now() where id = ${item.id}
  `;
  await record(id, 'action.asked', `Comes back ${new Date(at).toISOString().slice(0, 10)}.`);
  send(res, 200, { ok: true, nextAt: at });
}
