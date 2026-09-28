// Drafting the operator's reply.
//
// A draft is never sent. It appears in the reply box, the operator reads it, edits it or
// throws it away, and presses send themselves. That is the whole safety model and it is why
// this can run on a small model: nothing it writes reaches anybody unread.
//
// It must never become a dependency either. When the model is cold, slow or gone, the draft
// button reports what happened and the operator writes the reply themselves. Nothing else
// about the desk changes.
//
// The model runs on this project's own GPU worker, not on a third party's API. A thread here
// is somebody's trade, their rate, their first customer and what is standing in their way.
// That does not leave.

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

export const SYSTEM_PROMPT = [
  'You draft a reply for the operator of One Percent to read, edit and send. You are not',
  'talking to the customer and nothing you write reaches them unread.',
  '',
  'One Percent is one paid half-hour conversation about what somebody would charge one person',
  'once, and what it would take to have a first paying customer. The operator has already had',
  'that conversation with this person.',
  '',
  'Write the reply the operator would write: plain words, no greeting, no sign-off, no',
  'pleasantries, no first-person feelings. Answer what was actually asked. Where the thread',
  'names a number, a rate or a date, use it exactly as written and never invent one.',
  '',
  'Say nothing about being a model and never apologize. If the thread does not contain what',
  'an answer needs, write the question the operator should ask instead.',
  '',
  'Credits in this project are not money and are never described in money terms. Real money',
  'is what somebody actually charges a client, and that is described plainly as money.',
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
export async function draft(messages, chosen, now = () => Date.now()) {
  const model = resolve(chosen);
  const started = now();

  const submitted = await ask(model, '/run', {
    method: 'POST',
    body: JSON.stringify({ input: { messages, options: { temperature: 0.4 } } }),
  });

  const job = submitted.id;
  if (!job) throw new HttpError(502, `${model.name} accepted the job but named no job to watch.`);

  for (;;) {
    if (now() - started > DRAFT_BUDGET_MS) {
      throw new HttpError(
        504,
        `${model.name} did not answer within ${Math.round(DRAFT_BUDGET_MS / 1000)} seconds. ` +
          'A worker starting from cold takes about that long. Write the reply, or press it ' +
          'again in a minute when the worker is warm.',
      );
    }

    const state = await ask(model, `/status/${job}`, { method: 'GET' });
    const status = String(state.status || '').toUpperCase();

    if (status === 'COMPLETED') {
      const out = state.output || {};
      if (out.error) throw new HttpError(502, `${model.name} refused the job: ${out.error}`);
      const content = String(out.content || '').trim();
      if (!content) throw new HttpError(502, `${model.name} answered with nothing in it.`);
      return {
        content,
        model: out.model || model.name,
        slot: model.slot,
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
