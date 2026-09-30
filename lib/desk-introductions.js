// Putting two people in touch, and what came of it.
//
// Out of the endpoint because the endpoint passed its size limit again. This is the subject the
// allowlist named as next: it reaches two orders at once and nothing else on the desk does, so
// it is the part that reads least like the rest of the file.

import { ensureSchema, sql } from './db.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { INTRODUCTION_OUTCOMES, isIntroductionOutcome } from './desk.js';
import { normalizeReference } from './orders.js';
import { caseOf, orderId, record, referenceOf } from './desk-events.js';

// Made, not proposed. The row is a record of something done: two people were put in touch.
// There is no state for a match that was considered and rejected, because that is not a thing
// that happened to anybody.
export async function introduce(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const reference = normalizeReference(body.reference);
  if (!reference) throw new HttpError(400, 'Which reference are they introduced to?');

  const them = await sql()`select id from orders where reference_code = ${reference}`;
  if (!them.length) throw new HttpError(404, `No order here carries the reference ${reference}.`);
  const otherId = Number(them[0].id);
  if (otherId === id) throw new HttpError(400, 'That is the same person.');

  // An introduction is between two people, not two purchases. Two reference codes belonging
  // to one person are one person, so introducing them to each other is the same mistake as
  // introducing an order to itself.
  const [mine, theirs] = await Promise.all([caseOf(id), caseOf(otherId)]);
  if (mine && theirs && mine === theirs) {
    throw new HttpError(400, 'That reference belongs to the same person.');
  }

  // The pair is unordered, so check it both ways round before writing a second row for the
  // same two people -- by case where both have signed in, because two of somebody's reference
  // codes are not two people to introduce twice.
  const already = mine && theirs
    ? await sql()`
        select id from introductions
         where (a_case_id = ${mine} and b_case_id = ${theirs})
            or (a_case_id = ${theirs} and b_case_id = ${mine})
         limit 1
      `
    : await sql()`
        select id from introductions
         where (a_order_id = ${id} and b_order_id = ${otherId})
            or (a_order_id = ${otherId} and b_order_id = ${id})
         limit 1
      `;
  if (already.length) throw new HttpError(409, 'These two have already been introduced.');

  const reason = String(body.reason || '').trim().slice(0, 2000);
  await sql()`
    insert into introductions (a_order_id, b_order_id, a_case_id, b_case_id, reason_encrypted)
    values (${id}, ${otherId}, ${mine}, ${theirs}, ${reason ? encrypt(reason) : null})
  `;
  // On both records, because it happened to both of them.
  await record(id, 'introduction.made', `To ${reference}. ${reason}`.trim());
  await record(otherId, 'introduction.made', `To ${await referenceOf(id)}. ${reason}`.trim());
  send(res, 201, { ok: true });
}

export async function recordIntroduction(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const introId = orderId(body.introductionId);
  const outcome = String(body.outcome || '');
  if (!isIntroductionOutcome(outcome)) {
    throw new HttpError(400, `Pick one: ${INTRODUCTION_OUTCOMES.join(', ')}.`);
  }
  const note = String(body.note || '').trim().slice(0, 2000);

  const done = await sql()`
    update introductions set
      outcome = ${outcome},
      outcome_encrypted = ${note ? encrypt(note) : null},
      updated_at = now()
     where id = ${introId} and (a_order_id = ${id} or b_order_id = ${id})
     returning a_order_id, b_order_id
  `;
  if (!done.length) throw new HttpError(404, 'No introduction with that number involving them.');
  await record(id, 'introduction.recorded', `${outcome}. ${note}`.trim());
  send(res, 200, { ok: true, outcome });
}
