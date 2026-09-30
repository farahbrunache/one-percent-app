// Postgres in this process, and the two helpers every group of queries needs.
//
// It boots PGlite, hands lib/db.js a tagged template the same shape Neon's client has, and runs
// the schema once. Pulled out of database.test.mjs so that file can split along its own headings
// without each part booting its own database or carrying its own copy of check().

import { PGlite } from '@electric-sql/pglite';

process.env.CARD_ENCRYPTION_KEY ||= 'test-key-that-is-long-enough-to-pass-0123456789';

let failures = 0;

export function check(label, condition, detail) {
  if (condition) console.log('  ok   ' + label);
  else {
    failures += 1;
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail)));
  }
}

export function failureCount() {
  return failures;
}

// The database itself, for the handful of cases that have to run statement text rather than a
// tagged template -- renaming a column out from under the schema, mostly.
export const pg = await PGlite.create();

// Neon's client is a tagged template that returns rows. This is the same shape over Postgres.
export function tagged(strings, ...values) {
  let text = '';
  strings.forEach((part, i) => {
    text += part;
    if (i < values.length) text += `$${i + 1}`;
  });
  return pg.query(text, values).then((result) => result.rows);
}

export const db = await import('../lib/db.js');
db.useDatabase(tagged);
