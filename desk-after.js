// What happens after a write lands.
//
// Every form on the desk used to end by reloading the page. Writing one line against the third
// contact on a long record put you back at the top of that record with nothing saying anything had
// happened — a white flash, a re-fetch, and a scroll hunt back to where you were. On a phone that
// is most of the cost of using this.
//
// So a write now redraws the screen where it stands, keeps the reader where they were, and says
// what happened in a line at the bottom. Where the write can be put back, that line carries the
// control to put it back.
//
// Undo here is real rather than decorative. It is offered only when the inverse is one call with a
// value this screen already holds — a status moving back to what it was. It is never offered for
// writing a row or appending text, because undoing those would mean deleting, and the only delete
// in this product refuses anything not marked as demo data. A control that would fail is worse
// than no control.

import { call } from '/desk-ui.js';

// How long the line stays, and the chance to put something back with it.
const STAYS_MS = 6000;

// Who knows how to draw the screen that is open. Registered by the page rather than imported,
// because the drawing lives in the page and the page already imports this.
let redraw = null;

export function drawnBy(fn) {
  redraw = fn;
}

// Read the screen again and draw it, leaving the reader where they were.
//
// Two things make that true and both were missing at first. The scroll position is taken before
// and put back after, or this is a reload with extra steps: the content is correct and the reader
// is at the top of it.
//
// And the sections they had opened stay open. Which sections open on arrival is decided by the
// state of the row, which is right for the first draw and wrong for every one after it: writing
// against a contact snapped the contacts section shut, because the draw after the write made the
// same decision the first draw did and the reader's own choice was not part of it.
function openNow() {
  return [...document.querySelectorAll('details[id]')].filter((d) => d.open).map((d) => d.id);
}

export async function again() {
  if (!redraw) return;
  const was = window.scrollY;
  const wasOpen = openNow();
  await redraw();
  for (const id of wasOpen) {
    const section = document.getElementById(id);
    if (section) section.open = true;
  }
  window.scrollTo(0, was);
}

// Attach a listener at most once for a given element and event.
//
// The screen is drawn again after every write, and the controls written into the page's own markup
// survive that. Attaching to one of those on every draw means two listeners after the first write
// and three after the second, so one press writes three times. Rows built during a draw are new
// elements each time and are unaffected either way, so every listener on the desk goes through
// this rather than anybody having to work out which kind they are looking at.
const wired = new WeakMap();

export function once(node, type, handler) {
  if (!node) return;
  let types = wired.get(node);
  if (!types) {
    types = new Set();
    wired.set(node, types);
  }
  if (types.has(type)) return;
  types.add(type);
  node.addEventListener(type, handler);
}

function line() {
  let box = document.getElementById('after');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'after';
  box.className = 'after';
  // Spoken by a screen reader when it changes, rather than only drawn. polite rather than
  // assertive: it reports something that already happened and nothing waits on it.
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  document.body.append(box);
  return box;
}

let hideAt = null;

function show(said, putBack) {
  const box = line();
  box.textContent = '';
  box.hidden = false;
  const words = document.createElement('span');
  words.textContent = said;
  box.append(words);

  if (putBack) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'undo';
    button.textContent = 'Undo';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Putting it back…';
      try {
        await putBack();
        await again();
        show('Put back.');
      } catch (error) {
        box.hidden = true;
        throw error;
      }
    });
    box.append(button);
  }

  // One timer, not one per line. A second write while the first line is still up would otherwise
  // leave the earlier timer running and hide the newer line early.
  if (hideAt) window.clearTimeout(hideAt);
  hideAt = window.setTimeout(() => {
    box.hidden = true;
    hideAt = null;
  }, STAYS_MS);
}

// A write landed: say so, draw the screen again, and offer the way back where there is one.
//
// The line comes first and the draw second, because the draw is a round trip and the point of all
// of this is that the press is answered immediately.
export async function settled(said, putBack) {
  show(said, putBack);
  await again();
}

// The way back for a status that moved: one call, with the value it held before.
//
// Written here rather than at each site so that every one of them sends the same shape, and so
// that an action with no previous value — a row that did not exist until now — has nowhere to
// accidentally pass one.
export function wasBefore(action, body) {
  if (body === null || body === undefined) return null;
  return () => call(`/api/desk?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
