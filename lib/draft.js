// Drafting what the operator writes: the sheet somebody is told, and a reply in the
// conversation that opens after it.
//
// A draft is never filed and never sent. It appears in the box the operator writes in, they
// read it, rewrite it or throw it away, and press the button themselves. That is the safety
// model and it is why this can run on a small model: nothing it writes reaches anybody
// unread.
//
// It must never become a dependency either. When the model is cold, slow or gone, the draft
// button reports what happened and the operator writes the sheet themselves. Nothing else
// about the desk changes.
//
// The model runs on this project's own GPU worker, not on a third party's API. What it is
// given is a transcript — somebody's trade, their rate, their first customer and what is
// standing in their way. That does not leave.

import { SHEET_RULES } from './sheet.js';
import { HttpError } from './http.js';

// Two slots, fixed, because the deploy script's settings list is checked against the code in
// both directions and a variable number of settings would have to be excused from that check.
// A slot with no address is not configured and is not offered anywhere.
// Written out rather than built from the letter, because the deploy script's settings list is
// checked against the names the code mentions, and a name assembled at runtime is invisible to
// that check. A setting the check cannot see is a setting that never reaches the service.
const SLOT_SETTINGS = {
  A: { name: 'DRAFT_MODEL_A_NAME', url: 'DRAFT_MODEL_A_URL', key: 'DRAFT_MODEL_A_KEY' },
  B: { name: 'DRAFT_MODEL_B_NAME', url: 'DRAFT_MODEL_B_URL', key: 'DRAFT_MODEL_B_KEY' },
};

export const SLOTS = Object.keys(SLOT_SETTINGS);

// Cold starts run tens of seconds. Past this the operator is better served by an empty box
// than by a spinner, so the wait is bounded and the failure says which model was asked.
export const DRAFT_BUDGET_MS = 45_000;
const POLL_EVERY_MS = 1_500;

// A draft costs money and the button is one press. Ten a day against one order is far more
// than the work needs and far less than a stuck finger can spend.
export const DRAFTS_PER_ORDER = 10;
export const DRAFT_WINDOW_SECONDS = 24 * 60 * 60;

// Two jobs, two prompts. What they share is the product, the voice and the rule about
// numbers; what differs is what the model is given and what it is writing.
const SHARED = [
  'One Percent is one paid half-hour conversation about what somebody would charge one',
  'person, once, and what it would take to have a first paying customer.',
  '',
  'Plain words, no greeting, no sign-off, no pleasantries, no first-person feelings. Where',
  'what you are given names a number, a rate, a trade or a date, use it exactly as it is and',
  'never invent one. Where it does not say something you need, leave that out rather than',
  'filling the gap.',
  '',
  'Say nothing about being a model and never apologize.',
  '',
  'Credits in this project are not money and are never described in money terms. Real money',
  'is what somebody actually charges a client, and that is described plainly as money.',
];

export const REPLY_PROMPT = [
  'You draft a reply for the operator of One Percent to read, edit and send. You are not',
  'talking to the client and nothing you write reaches them unread.',
  '',
  'What you are given is the conversation so far. It opens after the call has been read and',
  'the answer was yes, and it is where the work actually happens: carrying the',
  'recommendations out, and quoting for paid work when there is any.',
  '',
  'Answer what was actually asked. If the conversation does not contain what an answer needs,',
  'write the question the operator should ask instead.',
  '',
  ...SHARED,
].join('\n');

export const SYSTEM_PROMPT = [
  'You draft a sheet for the operator of One Percent to read, rewrite and file. You are not',
  'talking to the caller and nothing you write reaches them unread.',
  '',
  'What you are given is the transcript of that conversation.',
  '',
  'Write what this person should do next, addressed to them: things worth doing in their own',
  'situation, in the order they would do them.',
  '',
  'Everybody who calls gets a sheet, whichever way the decision went, and a sheet is never a',
  'rejection and must not read as one. Do not say whether they were accepted, do not rank',
  'them, and do not tell them what they are. Write only what to do.',
  '',
  // The same rules the operator's template is built from. One list, so a drafted sheet and a
  // typed one are the same shape and a model has nothing to drift away from.
  'The sheet is written to these rules:',
  ...SHEET_RULES.map((rule) => `- ${rule}`),
  '',
  ...SHARED,
].join('\n');

function settingsFor(slot) {
  const names = SLOT_SETTINGS[slot];
  return {
    slot,
    name: process.env[names.name] || `Model ${slot}`,
    url: (process.env[names.url] || '').replace(/\/+$/, ''),
    key: process.env[names.key] || '',
  };
}

// What is readable about a model from outside this file. Never the key.
function describe(slot) {
  return { slot, name: settingsFor(slot).name };
}

export function configuredSlots() {
  return SLOTS.filter((slot) => {
    const model = settingsFor(slot);
    return model.url.length > 0 && model.key.length > 0;
  });
}

export function models() {
  return configuredSlots().map(describe);
}

// A slot can disappear between one draft and the next, because clearing it is how a model is
// retired. So a chosen slot that is no longer configured falls back to the first one that is,
// and the caller is told, rather than the button simply going dead.
export function resolve(chosen) {
  const available = configuredSlots();
  if (!available.length) {
    throw new HttpError(
      503,
      'No drafting model is configured. A slot needs its address and its key set in the ' +
        'secrets store. The slots are: ' + SLOTS.join(', ') + '.',
    );
  }
  const slot = available.includes(chosen) ? chosen : available[0];
  return { ...settingsFor(slot), fellBack: slot !== chosen && Boolean(chosen) };
}

async function ask(model, path, init) {
  const response = await fetch(`${model.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${model.key}`, 'content-type': 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) {
    // A scoped RunPod key aimed at an endpoint it does not cover fails rather than falling
    // back, and the failure is quiet. Naming the endpoint is what separates that from a
    // model that is merely cold.
    throw new HttpError(
      502,
      `${model.name} answered ${response.status} at ${model.url}${path}. If that is a refusal ` +
        `rather than an outage, the key for slot ${model.slot} may not cover that endpoint. ` +
        `It said: ${text.slice(0, 300)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(502, `${model.name} answered something that is not JSON: ${error.message}`);
  }
}

// RunPod Serverless is a queue: submit a job, then poll until it reaches a terminal state.
// The budget covers both, because a cold worker spends it before the job is even picked up.
// `on` carries two things the caller needs and this function should not know about: `resume`,
// a job already submitted and still running, and `submitted`, called with the job's name the
// moment there is one.
//
// Both exist because a job outlives the wait for it. Giving up at the budget stops the polling
// here; it does not stop the worker, and the worker is what costs money. So the name is handed
// out before the first poll rather than after the last one, and a second press picks the same
// job back up instead of paying for another.
export async function draft(messages, chosen, now = () => Date.now(), on = {}) {
  const model = resolve(chosen);
  const started = now();

  let job = on.resume || null;
  if (!job) {
    const submitted = await ask(model, '/run', {
      method: 'POST',
      body: JSON.stringify({ input: { messages, options: { temperature: 0.4 } } }),
    });
    job = submitted.id;
    if (!job) {
      throw new HttpError(502, `${model.name} accepted the job but named no job to watch.`);
    }
    if (on.submitted) await on.submitted(job, model);
  }

  // The last thing the job said it was doing, which is the difference between two failures that
  // read identically and are nothing alike.
  //
  // Running out of money fails at the submit above, loudly, with a status code -- so a job that
  // got an id is a job the account could pay for. What is left is whether a worker ever picked
  // it up. Still queued at the end of the budget means nothing started: cold, or no capacity.
  // In progress means a worker is running and is slow. One is worth pressing again in a minute;
  // the other is worth writing the sheet yourself.
  let seen = 'IN_QUEUE';

  for (;;) {
    if (now() - started > DRAFT_BUDGET_MS) {
      const seconds = Math.round(DRAFT_BUDGET_MS / 1000);
      throw new HttpError(
        504,
        seen === 'IN_PROGRESS'
          ? `${model.name} started on it and was still going after ${seconds} seconds. The job ` +
            'was taken and paid for, so this is a slow answer rather than a refusal. Write the ' +
            'sheet, or press it again.'
          : `${model.name} took the job and nothing started it within ${seconds} seconds. It sat ` +
            'queued the whole time, which is what a worker starting from cold looks like, and ' +
            'also what no free worker looks like. The account paid for the job, so this is not ' +
            'a billing refusal. Write the sheet, or press it again in a minute.',
      );
    }

    const state = await ask(model, `/status/${job}`, { method: 'GET' });
    const status = String(state.status || '').toUpperCase();
    if (status) seen = status;

    if (status === 'COMPLETED') {
      const out = state.output || {};
      if (out.error) throw new HttpError(502, `${model.name} refused the job: ${out.error}`);
      const content = String(out.content || '').trim();
      if (!content) throw new HttpError(502, `${model.name} answered with nothing in it.`);
      return {
        content,
        model: out.model || model.name,
        slot: model.slot,
        job,
        fellBack: model.fellBack,
        promptTokens: Number(out.prompt_tokens) || null,
        completionTokens: Number(out.completion_tokens) || null,
        seconds: Math.round((now() - started) / 1000),
      };
    }

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      throw new HttpError(502, `${model.name} ended the job as ${status.toLowerCase()}.`);
    }

    await new Promise((done) => setTimeout(done, POLL_EVERY_MS));
  }
}
