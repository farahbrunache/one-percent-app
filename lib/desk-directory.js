// A person from the Skills Economy Directory, on somebody's list of people to approach.
//
// The owner already entered these people in the Directory, so the desk points at them rather than
// asking for them a second time (owner decision, 2026-10-02). The limits, from the private
// `one-percent` repository and from `chargingthefuture/chargingthefuture`:
//
// - A pointer, not a copy. A contact stores the Directory profile id, sealed like everything else,
//   and nothing the Directory says about the person. The name, trade, skills, link and location
//   are read live each time the record is opened and never written down here, so a takedown there
//   takes effect here with nothing to clean up.
// - Claimed profiles only. Skills Economy answers an unclaimed profile the same way as a missing
//   one, and this says so where the details would have been.
// - The owner's desk only. Every action here is admin-only, and nothing on a client's screen
//   reads a contact's profile.
// - Never in the way. The person screen loads without it. A Directory that doesn't answer leaves
//   the contact on the list with a line saying what failed.
//
// Switched off until DIRECTORY_SERVICE_URL and DIRECTORY_SERVICE_TOKEN are both set: the link field
// hides, and this action refuses and names the two settings.

import { ensureSchema, sql } from './db.js';
import { decrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, query, send } from './http.js';
import { caseOf, orderId } from './desk-events.js';

// Directory ids are uuids, plus older text ids carried over from an earlier version. The same
// shape Skills Economy checks before it reads anything.
const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function directoryReadConfigured() {
  return Boolean(process.env.DIRECTORY_SERVICE_URL && process.env.DIRECTORY_SERVICE_TOKEN);
}

// What the owner pastes: the profile's address from the Directory (…/apps/directory/profile/<id>),
// or the id on its own. Anything else is a 400 that says what was expected.
export function profileIdFrom(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  let candidate = text;
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      url = null;
    }
    const match = url && url.pathname.match(/\/directory\/profiles?\/([^/]+)\/?$/);
    candidate = match ? decodeURIComponent(match[1]) : '';
  }
  if (!PROFILE_ID.test(candidate)) {
    throw new HttpError(
      400,
      'That isn\'t a Directory profile link. Open the person in the Skills Economy Directory and '
        + 'copy the address, which ends in /apps/directory/profile/ and their id.',
    );
  }
  return candidate;
}

// One read, with a short wait, because the owner is looking at a screen. The answer is passed on
// as the Directory gave it and is not stored.
export async function readProfile(profileId) {
  if (!directoryReadConfigured()) {
    throw new HttpError(
      503,
      'Reading the Directory is switched off. It needs DIRECTORY_SERVICE_URL and '
        + 'DIRECTORY_SERVICE_TOKEN set in this site\'s settings.',
    );
  }
  const base = process.env.DIRECTORY_SERVICE_URL.replace(/\/+$/, '');
  let answer;
  try {
    answer = await fetch(`${base}/api/directory/service/profiles/${encodeURIComponent(profileId)}`, {
      headers: { authorization: `Bearer ${process.env.DIRECTORY_SERVICE_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(502, 'Skills Economy couldn\'t be reached, or didn\'t answer within 8 seconds. The contact is saved; '
      + 'open the record again later to see their profile.');
  }
  if (answer.status === 404) {
    throw new HttpError(404, 'The Directory has no claimed profile with this id. It may have been '
      + 'unclaimed or taken down, and there are no details to show.');
  }
  if (answer.status === 401) {
    throw new HttpError(502, 'Skills Economy refused this site\'s credential. Check that '
      + 'DIRECTORY_SERVICE_TOKEN here matches an entry in DIRECTORY_SERVICE_TOKENS there.');
  }
  if (!answer.ok) {
    throw new HttpError(502, `Skills Economy answered ${answer.status}, so the profile couldn't be `
      + 'read. Open the record again later.');
  }
  const body = await answer.json().catch(() => null);
  if (!body || typeof body.profile !== 'object' || !body.profile) {
    throw new HttpError(502, 'Skills Economy answered with something that isn\'t a profile.');
  }
  return body.profile;
}

// GET ?action=directory-profile&id=<order>&contact=<contact id>
export async function directoryProfile(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const params = query(req);
  const id = orderId(params.get('id'));
  const caseId = await caseOf(id);
  if (caseId === null) throw new HttpError(404, 'This order has no case, so it has no contacts.');
  const contactId = orderId(params.get('contact'));

  // Checked in the statement, so a contact on somebody else's list can't be read through this one.
  const rows = await sql()`
    select directory_profile_encrypted from contacts where id = ${contactId} and case_id = ${caseId}
  `;
  if (!rows.length) throw new HttpError(404, 'No contact with that number for this person.');
  if (!rows[0].directory_profile_encrypted) {
    throw new HttpError(404, 'This contact isn\'t linked to a Directory profile.');
  }
  const profile = await readProfile(decrypt(rows[0].directory_profile_encrypted));
  send(res, 200, { profile });
}
