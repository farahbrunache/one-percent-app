// The four facts a call is decided from: their trade, their rate, what's in the way, and who
// their first customer could be.
//
// A 30-minute transcript takes minutes to read and there are going to be thousands of them. Four
// lines take seconds, so the call is decided from these and the transcript is opened when one of
// them is unclear.
//
// Human first. The owner can type all four and nothing costs anything. The model is a button
// that reads one call's transcript and puts its answers in the boxes; nothing is saved until the
// owner presses Save, and with no model set up the button is gone and the boxes still work. That
// call's transcript is the only thing the model is given, so one person's words never reach
// another person's fields.

import { ensureSchema, sql } from './db.js';
import { readChoice } from './settings.js';
import { decrypt, encrypt } from './crypto.js';
import { requireAdmin } from './auth.js';
import { HttpError, readJson, send } from './http.js';
import { orderId, record } from './desk-events.js';
import { askAndRecord, MODEL_CHOICE } from './desk-drafts.js';

export const CALL_FIELDS = [
  ['trade', 'Trade'],
  ['rate', 'Rate'],
  ['inTheWay', "What's in the way"],
  ['firstCustomer', 'First customer'],
];
const MAX_FIELD = 300;

export function readFields(stored) {
  if (!stored) return null;
  try {
    const raw = JSON.parse(decrypt(stored));
    return Object.fromEntries(CALL_FIELDS.map(([key]) => [key, String(raw[key] || '')]));
  } catch {
    return null;
  }
}

function callId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Say which call these are for.');
  return id;
}

// Saving is the owner's step, whether the words came from the keyboard or from the model.
export async function saveCallFields(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const call = callId(body.call);
  const fields = Object.fromEntries(CALL_FIELDS.map(([key]) =>
    [key, String(body.fields?.[key] || '').trim().slice(0, MAX_FIELD)]));
  const empty = CALL_FIELDS.every(([key]) => !fields[key]);
  const saved = await sql()`
    update calls set fields_encrypted = ${empty ? null : encrypt(JSON.stringify(fields))}
     where id = ${call} and order_id = ${id}
     returning id
  `;
  if (!saved.length) throw new HttpError(404, 'That call isn\'t on this order.');
  await record(id, 'call-fields', empty ? 'Cleared the four lines on a call.' : 'Saved the four lines on a call.');
  send(res, 200, { fields: empty ? null : fields });
}

const FIELDS_PROMPT = [
  'You read the transcript of one call with somebody who wants to earn more from their skills.',
  'Fill in four short fields about the caller. Answer with exactly these four lines and nothing',
  'else:',
  'Trade: what work they do, in a few words',
  'Rate: what they charge, with the unit, as they said it',
  "In the way: the main thing stopping them, in one sentence",
  'First customer: who their first or next paying customer could be, in one sentence',
  "Use only what the caller said. Never invent a fact. If they didn't say, write: not said.",
  'Keep each line under 25 words. Plain words, no lists, no quotation marks.',
].join('\n');

// Four labeled lines rather than JSON, because the drafting worker takes plain chat and a
// model that drifts from JSON fails all four at once. A line the model leaves out stays empty.
export function parseFields(text) {
  const labels = { trade: 'trade', rate: 'rate', inTheWay: 'in the way', firstCustomer: 'first customer' };
  const out = {};
  for (const [key, label] of Object.entries(labels)) {
    // Bold markers are dropped first: a model that writes **Rate:** still means Rate.
    const plain = String(text || '').replace(/\*/g, '');
    const found = plain.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'));
    out[key] = found ? found[1].trim().slice(0, MAX_FIELD) : '';
  }
  return out;
}

// The paid half. Reads the one call it's asked about and hands back what it read, unsaved.
export async function draftCallFields(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const call = callId(body.call);
  const rows = await sql()`
    select transcript_encrypted from calls
     where id = ${call} and order_id = ${id} and transcript_encrypted is not null
  `;
  if (!rows.length) {
    throw new HttpError(409, 'That call has no transcript, so there\'s nothing to read the four lines from.');
  }
  const messages = [
    { role: 'system', content: FIELDS_PROMPT },
    { role: 'user', content: decrypt(rows[0].transcript_encrypted) },
  ];
  const answer = await askAndRecord(id, messages, await readChoice(MODEL_CHOICE));
  send(res, 200, { fields: parseFields(answer.content), model: answer.model, seconds: answer.seconds });
}
