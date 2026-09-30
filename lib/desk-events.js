// Naming an order, and writing to its trail.
//
// Two things nearly every desk write does: work out which order it is about, and leave a line on
// the record saying what happened. They moved out of the endpoint when the quote handlers did, so
// both files can have them without one importing the other.

import { sql } from './db.js';
import { encrypt } from './crypto.js';
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
