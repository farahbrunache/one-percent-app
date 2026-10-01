// Two things that are not the schema: a setting the operator owns, and the counter that stops a
// script hammering an endpoint.
//
// Out of lib/db.js because that file is the schema and had grown past its limit. Neither of
// these describes a table; both just read and write one, which is what every other library here
// does. They sit together because they are the two rows the product writes about itself rather
// than about a person.

import { sql } from './db.js';
import { keyedHash } from './crypto.js';

// A setting the operator owns. Absent means nothing has been chosen, which is not an error:
// the reader decides what no choice means.
export async function readChoice(name) {
  const rows = await sql()`select value from settings where name = ${name}`;
  return rows.length ? rows[0].value : null;
}

export async function writeChoice(name, value) {
  await sql()`
    insert into settings (name, value, changed_at) values (${name}, ${value}, now())
    on conflict (name) do update set value = excluded.value, changed_at = now()
  `;
}

// A fixed-window counter. Coarse on purpose: it is here to stop a script, not to be fair.
// Returns true when the request is allowed.
export async function underLimit(name, callerHash, max, windowSeconds) {
  const q = sql();
  const bucket = keyedHash(`${name}:${callerHash}`);
  const rows = await q`
    insert into rate_limits (bucket, hits, window_start)
    values (${bucket}, 1, now())
    on conflict (bucket) do update set
      hits = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then 1
        else rate_limits.hits + 1
      end,
      window_start = case
        when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        then now()
        else rate_limits.window_start
      end
    returning hits
  `;
  return Number(rows[0]?.hits ?? 0) <= max;
}

