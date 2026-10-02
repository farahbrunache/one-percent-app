// A client's own Directory profile, and the trade it gives.
//
// Somebody who has signed in with Skills Economy may already have said what they do in the
// Directory. The owner pastes their profile link once, and each time the record opens the desk
// reads the profile live and offers its job title as their trade, one tap to use.
//
// The same limits as a contact's profile (lib/desk-directory.js): the profile id is the only thing
// saved, the rest is read each time and never written down, and a Directory that doesn't answer
// leaves the record working. The trade is saved only when the owner taps Use it, because that's
// the owner choosing it, and the suggestions and pairs run on it.

import { ensureSchema, sql } from './db.js';
import { decrypt, encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, query, readJson, send } from './http.js';
import { caseOf, orderId, record } from './desk-events.js';
import { profileIdFrom, readProfile } from './desk-directory.js';

export async function linkOwnProfile(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const caseId = await caseOf(id);
  if (caseId === null) {
    throw new HttpError(409, "Nobody has signed in on this order yet, so there's no person to link a profile to.");
  }
  const profileId = profileIdFrom(body.link);
  await sql()`update cases set directory_profile_encrypted = ${profileId ? encrypt(profileId) : null}
               where id = ${caseId}`;
  await record(id, 'own-profile', profileId ? 'Linked their Directory profile.' : 'Unlinked their Directory profile.');
  send(res, 200, { linked: Boolean(profileId) });
}

// Read live. The job title comes back as a name, so it's matched to the trade list by name
// within the same sector; a title the copy here doesn't have yet is shown without the button.
export async function readOwnProfile(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const id = orderId(query(req).get('id'));
  const caseId = await caseOf(id);
  const rows = caseId === null ? [] : await sql()`
    select directory_profile_encrypted from cases where id = ${caseId}
  `;
  if (!rows.length || !rows[0].directory_profile_encrypted) {
    throw new HttpError(404, "This person's Directory profile isn't linked.");
  }
  const profile = await readProfile(decrypt(rows[0].directory_profile_encrypted));
  const match = profile.jobTitle ? await sql()`
    select id from trades
     where active and lower(title) = lower(${profile.jobTitle})
       and (${profile.sector}::text is null or lower(sector) = lower(${profile.sector}))
     limit 1
  ` : [];
  send(res, 200, {
    jobTitle: profile.jobTitle || null,
    sector: profile.sector || null,
    profileUrl: profile.profileUrl || null,
    tradeId: match.length ? match[0].id : null,
  });
}
