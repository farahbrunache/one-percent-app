// Gets a lost claim link back. The only thing that works is the card code itself, which the
// buyer has on the card or in their own receipt, and which is never stored in readable form.

import { ensureSchema, sql, underLimit } from '../lib/db.js';
import { callerKey, claimToken, keyedHash, normalizeCardCode } from '../lib/crypto.js';
import { normalizeReference } from '../lib/orders.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

export default handle('POST', async (req, res) => {
  const body = await readJson(req);
  const raw = String(body.code || '').trim();
  const reference = normalizeReference(raw);
  const cardCode = normalizeCardCode(raw);

  // A reference is six characters plus a dash; a gift card code is longer. Either is accepted
  // without asking which one somebody is holding.
  if (reference.length !== 7 && cardCode.length < 8) {
    throw new HttpError(400, 'Enter your reference, or the gift card code you sent.');
  }

  await ensureSchema();

  if (!(await underLimit('recover', callerKey(req), 8, 3600))) {
    throw new HttpError(429, 'Too many recovery attempts from here in the last hour. Try later.');
  }

  const rows = await sql()`
    select id from orders
     where reference_code = ${reference.length === 7 ? reference : null}
        or card_code_hash = ${cardCode.length >= 8 ? keyedHash(cardCode) : null}
     limit 1
  `;
  if (!rows.length) {
    throw new HttpError(
      404,
      'Nothing here matches that. Check your reference or gift card code, or start an order if ' +
        'you have not yet.',
    );
  }

  // The old token cannot be returned — only its hash was kept — so issue a new one. This
  // retires the previous link, which is the correct outcome for a link somebody has lost.
  const token = claimToken();
  await sql()`
    update orders set claim_token_hash = ${keyedHash(token)} where id = ${rows[0].id}
  `;

  send(res, 200, { claim: `/claim?t=${token}` });
});
