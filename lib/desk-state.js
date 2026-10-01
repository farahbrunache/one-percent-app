// Two things that decide which screen a case appears on, and neither of which the client sees.
//
// A blocker is "not now". It is waiting on somebody else -- a licensing board, a reply, a date
// -- and it comes off the morning screen until its date passes or the window runs out. It is
// never a judgment about the person, and the reason is written down so the thing it is waiting
// on is a fact rather than a memory.
//
// Closing is a view. The work is done, the list is shorter, and nothing about the client's side
// changes: they see what they always saw and the conversation stays open. A message from them
// clears it, because somebody writing in is the case being open again whatever was marked.
//
// Both are the owner's own bookkeeping. Neither reaches anybody.

import { ensureSchema, sql } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { caseOf, orderId, record } from './desk-events.js';

function needsCase(caseId) {
  if (caseId === null) {
    throw new HttpError(
      409,
      'Nobody has signed in against this order yet, so there is no case to mark. They link it ' +
        'by opening their claim link while signed in.',
    );
  }
  return caseId;
}

// A date is optional, because most of what somebody waits on has no date on it. Without one the
// case comes back on its own after the window, which is the difference between "not now" and
// forgetting about somebody.
export async function block(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));

  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!reason) {
    throw new HttpError(400, 'Say what it is waiting on. A blocker with no reason is a case you '
      + 'will not remember in a week.');
  }

  let until = null;
  if (body.until) {
    const when = new Date(String(body.until));
    if (Number.isNaN(when.getTime())) throw new HttpError(400, 'That is not a date.');
    if (when.getTime() < Date.now()) {
      throw new HttpError(400, 'That date has passed, so it would come straight back. Leave it '
        + 'empty to have it come back on its own.');
    }
    until = when.toISOString();
  }

  await sql()`
    update cases set blocked_at = now(), blocked_until = ${until},
                     blocker_encrypted = ${encrypt(reason)}
     where id = ${caseId}
  `;
  await record(id, 'note', `Blocked: ${reason}`);
  send(res, 200, { ok: true });
}

export async function unblock(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));

  const rows = await sql()`select blocker_encrypted from cases where id = ${caseId}`;
  if (!rows.length || !rows[0].blocker_encrypted) {
    throw new HttpError(409, 'Nothing is blocking this one.');
  }
  await sql()`
    update cases set blocked_at = null, blocked_until = null, blocker_encrypted = null
     where id = ${caseId}
  `;
  await record(id, 'note', `Unblocked: ${decrypt(rows[0].blocker_encrypted)}`);
  send(res, 200, { ok: true });
}

export async function close(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));

  const [row] = await sql()`select closed_at from cases where id = ${caseId}`;
  const closing = !row.closed_at;
  await sql()`
    update cases set closed_at = ${closing ? new Date().toISOString() : null}
     where id = ${caseId}
  `;
  await record(id, 'note', closing
    ? 'Closed. A view only: they see no difference and the conversation stays open.'
    : 'Opened again.');
  send(res, 200, { ok: true, closed: closing });
}
