// Naming an order, and writing to its trail.
//
// Two things nearly every desk write does: work out which order it is about, and leave a line on
// the record saying what happened. They moved out of the endpoint when the quote handlers did, so
// both files can have them without one importing the other.

import { sql } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { HttpError } from './http.js';

export function orderId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which person?');
  return id;
}

// Written by whoever acted, read by whoever comes back to this later. The detail is optional
// and is trimmed to something a phone can show without the line becoming the screen.
export async function record(id, kind, detail) {
  const text = String(detail || '').trim().slice(0, 2000);
  await sql()`
    insert into case_events (order_id, case_id, kind, detail_encrypted)
    select ${id}, o.case_id, ${kind}, ${text ? encrypt(text) : null}
      from orders o where o.id = ${id}
  `;
}

// The case this order belongs to, or null while nobody has signed in. Everything about
// working with a person hangs off the case; everything about one purchase hangs off the
// order. An order with no case has nobody to work with yet, which is a state the screens
// say out loud rather than a gap to paper over.
export async function caseOf(orderId) {
  const rows = await sql()`select case_id from orders where id = ${orderId}`;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  return rows[0].case_id === null || rows[0].case_id === undefined
    ? null
    : Number(rows[0].case_id);
}

export async function referenceOf(id) {
  const rows = await sql()`select reference_code from orders where id = ${id}`;
  return rows[0]?.reference_code || `order ${id}`;
}

// A line on the trail, in plain words.
//
// Shared because both screens that draw the trail need it: the queue and the person's own
// record, which now live in different files. A row written under a key that is no longer the key
// still belongs on the trail -- that something happened on that date is the part that cannot be
// reconstructed, so this returns null rather than throwing.
export function readDetail(row) {
  if (!row.detail_encrypted) return null;
  try {
    return decrypt(row.detail_encrypted);
  } catch {
    return null;
  }
}
