// The pieces every desk screen is built from.
//
// Three screens share this file: the first screen, the queue and a person's record. They were one
// file until the record screen got a shell of its own, and what stayed behind is everything that
// isn't about any one of them -- making an element, talking to the endpoint, and the handful of
// ways a value gets written for a reader.
//
// Where the screen is, is here too. One parse of the address, so two modules can't disagree about
// which person is open or which page of a conversation is showing.
//
// What is owed on somebody is here for the same reason: the queue flags it on every row and the
// record screen lists it, and those two have to say the same thing about the same person. It was
// in the record module and the queue could not reach it, which broke the queue.

export const here = new URL(window.location.href);
export const personId = here.searchParams.get('id');
export const state = here.searchParams.get('state') || 'waiting';
export const page = Math.max(1, Number(here.searchParams.get('page')) || 1);
// Which page of the conversation. Absent means the newest, which the endpoint decides,
// because only it knows how many there are.
export const mpage = here.searchParams.get('mpage');
// A search, which is a queue of its own: everybody whose code or name has these letters in it.
export const asked = (here.searchParams.get('q') || '').trim();
export const askedForQueue = here.searchParams.has('state') || here.searchParams.has('page')
  || Boolean(asked);

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function link(text, href, className) {
  const a = el('a', text, className);
  a.href = href;
  return a;
}

export function msg(id, text, kind) {
  const box = document.getElementById(id);
  box.hidden = false;
  box.className = 'msg ' + (kind || '');
  box.textContent = text;
}

export async function call(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `The server returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function get(action) {
  return call(`/api/desk?action=${action}`);
}

// A write on a person's record says which record it came from, so the desk can time the step.
// The body already names the order, but the server times the step after the body is spent.
export function post(action, body) {
  const on = personId ? `&on=${encodeURIComponent(personId)}` : '';
  return call(`/api/desk?action=${action}${on}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// A date short enough to sit on a shut section's line beside its count. The full one is for
// inside a section, where there is room for a time of day.
export function day(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export function when(value) {
  return value ? new Date(value).toLocaleString() : 'not yet';
}

export function minutes(seconds) {
  return seconds ? `${Math.round(seconds / 60)} min` : 'length not recorded';
}

// Demo records sit on production beside the real ones, so every screen that lists a record
// says which it is. Four letters rather than a word, because it shares a row with a ten
// character reference on a 390 pixel screen.
export function demoChip(row, into) {
  if (row.isDemo) into.append(el('div', 'DEMO', 'badge demo'));
}

export function hours(n) {
  if (n === null || n === undefined) return '';
  if (n < 1) return 'just now';
  if (n < 72) return `${Math.floor(n)}h waiting`;
  return `${Math.floor(n / 24)}d waiting`;
}

export function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

// What is owed on somebody, in the order it has to happen.
//
// These are steps in a piece of work, not controls that happen to be on a screen. A control
// that is simply there gets pressed when somebody remembers; a step that is named and
// counted gets done. Everybody who called is owed a decision and a sheet, and neither is
// optional.
//
// Keeping the call's record is on the list and is usually not work: an hourly job takes it.
// So it says so quietly while that job has not caught up, and loudly once a day has passed,
// because the voice service forgets a call after seven.
export function owed(person) {
  const out = [];
  // First, because it is a person waiting on an answer rather than a job waiting on you.
  // Their messages land in the conversation, which is seven panels down a phone screen, so
  // without this line they wrote and the screen said nothing was owed.
  if (person.awaitingReply) {
    out.push({ what: 'They wrote to you and are waiting on a reply.', yours: true });
  }
  if (person.recordMissing) {
    const aDayOn = person.calledAt
      && Date.now() - new Date(person.calledAt).getTime() > 24 * 3600 * 1000;
    out.push({
      what: aDayOn
        ? "It's been over a day and the call record still isn't saved. Open the call and "
          + 'save it yourself.'
        : "The call record isn't saved yet. The hourly job picks it up. Nothing to do.",
      yours: Boolean(aDayOn),
    });
  }
  // A quote they answered, where the answer handed it back. Agreeing and asking for a change
  // both do. Neither ends by itself: one waits on the work starting, the other on a counter.
  if (person.quoteWaiting) {
    out.push({ what: 'They answered a quote and it is back with you.', yours: true });
  }
  if (!person.decision) out.push({ what: "Go or no-go, once you've read the call.", yours: true });
  if (!person.recommendedAt) {
    out.push({ what: 'Write their sheet. Everyone who calls gets one.', yours: true });
  }
  return out;
}

// The one way a desk screen asks the drafting model for something.
//
// Every press of a button that reaches the model is a bill, so those buttons look different
// before they're pressed: a color nothing else uses and a 💸 mark, which a screen reader
// says as "Costs money". This refuses a press from a button without that look, so a new
// paid button can't ship looking like a free one. scripts/checks.mjs fails the build on a
// request for any of these actions made anywhere else.
export const MODEL_ACTIONS = ['draft', 'quote-worth', 'call-fields-draft'];

export function askModel(button, body, action = 'draft') {
  if (!MODEL_ACTIONS.includes(action)) {
    return Promise.reject(new Error(`${action} isn't one of the actions that run the model.`));
  }
  if (!button.classList.contains('paid')) {
    return Promise.reject(new Error(
      'This button runs the drafting model and isn\'t marked as costing money, so nothing was sent.'));
  }
  return post(action, body);
}

// A paid button made in code rather than written into the page: the same purple and the same
// 💸 as the ones in desk.html. Its words sit in their own span so they can change while it
// works without taking the mark with them.
export function paidButton(label) {
  const button = el('button', null, 'quiet paid');
  button.type = 'button';
  const mark = el('span', '💸', 'paidmark');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', 'Costs money');
  mark.title = 'Costs money';
  button.append(el('span', label, 'paidlabel'), mark);
  return button;
}
