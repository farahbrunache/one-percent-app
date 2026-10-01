// Where this relationship stands, on one press.
//
// The record grows past a screen -- a plan, milestones, actions under them, people approached,
// quotes, work owed, a conversation -- and the operator opens it cold weeks later needing three
// things out of all of it: what was agreed, what has moved, what is waiting on them.
//
// It is a read rather than a record. Nothing is saved, because a saved recap is wrong the moment
// somebody types another line, and a recap that is quietly out of date is worse than none.

import { msg, post } from '/desk-ui.js';

export function renderRecap(person) {
  const drafting = person.drafting || { models: [], chosen: null };
  const button = document.getElementById('recapit');
  const note = document.getElementById('recapnote');
  const out = document.getElementById('recapout');
  if (!button) return;

  if (!drafting.models.length) {
    button.hidden = true;
    note.textContent = 'No drafting model is set up, so the record below is the recap.';
    return;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    note.textContent = 'Reading the record. A worker starting from cold takes up to a minute.';
    try {
      const written = await post('draft', { id: person.id, of: 'recap' });
      out.textContent = written.content;
      out.hidden = false;
      note.textContent = 'Nothing here is saved, and nobody else sees it. '
        + [written.model, written.seconds + 's'].filter(Boolean).join(' · ');
    } catch (error) {
      note.textContent = '';
      msg('rmsg', error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  });
}
