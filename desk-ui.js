// The pieces every desk screen is built from.
//
// Three screens share this file: the first screen, the queue and a person's record. They were one
// file until the record screen got a shell of its own, and what stayed behind is everything that
// isn't about any one of them -- making an element, talking to the endpoint, and the handful of
// ways a value gets written for a reader.
//
// Where the screen is, is here too. One parse of the address, so two modules can't disagree about
// which person is open or which page of a conversation is showing.

export const here = new URL(window.location.href);
export const personId = here.searchParams.get('id');
export const state = here.searchParams.get('state') || 'waiting';
export const page = Math.max(1, Number(here.searchParams.get('page')) || 1);
// Which page of the conversation. Absent means the newest, which the endpoint decides,
// because only it knows how many there are.
export const mpage = here.searchParams.get('mpage');
export const askedForQueue = here.searchParams.has('state') || here.searchParams.has('page');

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

export function post(action, body) {
  return call(`/api/desk?action=${action}`, {
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
