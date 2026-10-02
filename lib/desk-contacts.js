// The people somebody is going to approach, and what happened when they did.
//
// The method ends at a first paying customer, and a first paying customer is a person somebody
// spoke to. The sheet could already say "pick three people to approach this week" with nowhere
// to put the three names, so the list that produces the only outcome this product measures was
// the one thing never written down.
//
// Three operations: add somebody, record that you reached out and what came back, and move the
// status. Nothing here sends anything, and nothing here should ever learn how -- the message
// goes out on Quora, in Signal, or in a shop, and what came back is typed in afterwards.

import { ensureSchema, sql } from './db.js';
import { encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { CONTACT_PAID, CONTACT_STATUSES, isContactStatus } from './desk.js';
import { caseOf, orderId, record } from './desk-events.js';
import { profileIdFrom } from './desk-directory.js';

function needsCase(caseId) {
  if (caseId === null) {
    throw new HttpError(
      409,
      'Nobody has signed in against this order yet, so there is no case to hang a contact on. '
        + 'They link it by opening their claim link while signed in.',
    );
  }
  return caseId;
}

// Checked in the statement rather than in two queries, so there is no moment between the check
// and the write where the contact stopped belonging to this person.
async function contactUnder(caseId, contactId) {
  const rows = await sql()`
    select id, status from contacts where id = ${contactId} and case_id = ${caseId}
  `;
  if (!rows.length) throw new HttpError(404, 'No contact with that number for this person.');
  return rows[0];
}

export async function addContact(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));

  // A Directory link stands in for the name: the Directory already has it, and it is read from
  // there on the desk rather than typed a second time. Either one is enough.
  const profileId = profileIdFrom(body.directory);
  const name = String(body.name || '').trim().slice(0, 200);
  if (!name && !profileId) {
    throw new HttpError(400, 'Who is it? A name, or whatever they are known as, or their Directory link.');
  }

  await sql()`
    insert into contacts (case_id, name_encrypted, where_encrypted, why_encrypted, directory_profile_encrypted)
    values (${caseId}, ${encrypt(name)},
            ${String(body.where || '').trim().slice(0, 200) ? encrypt(String(body.where).trim().slice(0, 200)) : null},
            ${String(body.why || '').trim().slice(0, 500) ? encrypt(String(body.why).trim().slice(0, 500)) : null},
            ${profileId ? encrypt(profileId) : null})
  `;
  await record(id, 'contact.added', name || 'Somebody from the Directory');
  send(res, 201, { ok: true });
}

// Reaching out happened. Two halves, and the second is often empty on the day: what was said,
// and what came back. A row with nothing back yet is the ordinary case and is not a failure.
export async function reachOut(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));
  const contact = await contactUnder(caseId, orderId(body.contactId));

  const said = String(body.said || '').trim().slice(0, 2000);
  const back = String(body.back || '').trim().slice(0, 2000);
  if (!said && !back) {
    throw new HttpError(400, 'Write what was said, what came back, or both.');
  }

  await sql()`
    insert into outreach (contact_id, said_encrypted, back_encrypted)
    values (${contact.id}, ${said ? encrypt(said) : null}, ${back ? encrypt(back) : null})
  `;

  // Somebody on the list who has now been approached is no longer somebody to approach. Moved
  // here rather than asking for it separately, because the two are one fact and a status that
  // has to be remembered is a status that goes out of date.
  if (contact.status === 'to approach') {
    await sql()`update contacts set status = 'reached out', updated_at = now() where id = ${contact.id}`;
  } else {
    await sql()`update contacts set updated_at = now() where id = ${contact.id}`;
  }

  await record(id, 'contact.reached', [said, back].filter(Boolean).join(' — '));
  send(res, 201, { ok: true });
}

export async function moveContact(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = needsCase(await caseOf(id));
  const contact = await contactUnder(caseId, orderId(body.contactId));

  const status = String(body.status || '');
  if (!isContactStatus(status)) {
    throw new HttpError(400, `Pick a status: ${CONTACT_STATUSES.join(', ')}.`);
  }

  await sql()`update contacts set status = ${status}, updated_at = now() where id = ${contact.id}`;

  // The end of the method, recorded once. Somebody's first paying customer is a date on their
  // case and it is also a contact on this list, and asking for it in both places is asking the
  // same question twice and getting two answers.
  //
  // `coalesce` rather than an overwrite: the first is the first, and a second paying customer
  // does not move the date. The control on the case stays, because a first customer can come
  // from somewhere that was never on this list.
  let firstCustomerAt = null;
  if (status === CONTACT_PAID) {
    const [row] = await sql()`
      update cases set first_customer_at = coalesce(first_customer_at, now())
       where id = ${caseId}
      returning first_customer_at
    `;
    firstCustomerAt = row?.first_customer_at ?? null;
  }

  await record(id, 'contact.moved', status);
  send(res, 200, { ok: true, status, firstCustomerAt });
}
