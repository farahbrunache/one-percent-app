// Work the operator owes somebody.
//
// Everything else on this screen is work they owe themselves: the path, the steps, the people to
// approach. This is the other direction, and nothing was tracking it. Somebody agrees to four
// hundred dollars for a rate card, pays it, and the quote reads agreed and paid while nothing
// says whether the rate card was ever written.

import { el, msg, post, when } from '/desk-ui.js';
import { once, settled, wasBefore } from '/desk-after.js';

const STATES = ['to do', 'doing', 'delivered', 'dropped'];

function moveForm(person, work) {
  const form = el('form', null, 'fields');

  const pickField = el('div', null, 'field');
  const pickLabel = el('label', 'Where it got to');
  const pick = el('select');
  pick.id = `workstate-${work.id}`;
  pickLabel.htmlFor = pick.id;
  for (const state of STATES) {
    const option = el('option', state);
    option.value = state;
    if (state === work.state) option.selected = true;
    pick.append(option);
  }
  pickField.append(pickLabel, pick);

  const noteField = el('div', null, 'field');
  const noteLabel = el('label', 'What happened');
  const note = el('textarea');
  note.rows = 2;
  note.value = work.note || '';
  note.id = `worknote-${work.id}`;
  noteLabel.htmlFor = note.id;
  noteField.append(noteLabel, note);

  const dueField = el('div', null, 'field');
  const dueLabel = el('label', 'Due');
  const dueHint = el('span', 'Empty means no date was agreed.', 'hint');
  const due = el('input');
  due.type = 'date';
  due.id = `workdue-${work.id}`;
  if (work.dueAt) due.value = String(work.dueAt).slice(0, 10);
  dueLabel.htmlFor = due.id;
  dueField.append(dueLabel, dueHint, due);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Record it', 'quiet');
  save.type = 'submit';
  const date = el('button', 'Set the date', 'quiet');
  date.type = 'button';
  once(date, 'click', async () => {
    date.disabled = true;
    try {
      const was = work.dueAt ? String(work.dueAt).slice(0, 10) : '';
      await post('work-due', { id: person.id, projectId: work.id, dueAt: due.value });
      await settled(due.value ? `Due ${due.value}.` : 'No date on it now.',
        wasBefore('work-due', { id: person.id, projectId: work.id, dueAt: was }));
    } catch (error) {
      date.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  actions.append(save, date);

  form.append(pickField, noteField, dueField, actions);
  once(form, 'submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const was = { state: work.state, note: work.note || '' };
      await post('work-move', {
        id: person.id, projectId: work.id, state: pick.value, note: note.value,
      });
      await settled(`Now ${pick.value}.`,
        wasBefore('work-move', { id: person.id, projectId: work.id, ...was }));
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// The form that takes work on. Wired here with everything else this panel owns, so the panel is
// one file to read or delete.
function wireAdd(person) {
  const form = document.getElementById('addwork');
  const pick = document.getElementById('workquote');
  // The quotes to hang work on, rebuilt each draw so a quote written a moment ago is there.
  pick.textContent = '';
  const none = el('option', 'Nothing quoted');
  none.value = '';
  pick.append(none);
  for (const quote of person.quotes || []) {
    const option = el('option', `${quote.scope.slice(0, 60)} · ${quote.status}`);
    option.value = String(quote.id);
    pick.append(option);
  }

  if (form.dataset.wired) return;
  form.dataset.wired = 'yes';
  once(form, 'submit', async (event) => {
    event.preventDefault();
    const title = document.getElementById('worktitle');
    if (!title.value.trim()) return;
    try {
      await post('work-take', {
        id: person.id,
        title: title.value,
        quoteId: pick.value || undefined,
        dueAt: document.getElementById('workdue').value,
      });
      await settled('Added to what you owe them.');
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });
}

export function renderWork(person) {
  const list = document.getElementById('work');
  list.textContent = '';
  // Work hangs off the case, so there is nowhere to put it until somebody has signed in.
  document.getElementById('addwork').hidden = !person.linkedCase;
  if (!person.linkedCase) {
    list.append(el('p', 'Nobody has signed in against this order yet, so there is nobody to owe '
      + 'work to.', 'meta'));
    return;
  }
  wireAdd(person);

  const items = person.projects || [];
  if (!items.length) list.append(el('p', 'Nothing taken on yet.', 'meta'));

  for (const work of items) {
    const row = el('div', null, work.late ? 'row said us' : 'row');
    row.append(el('div', work.title, null));

    const parts = [work.state];
    if (work.deliveredAt) parts.push(`handed over ${when(work.deliveredAt)}`);
    else if (work.dueAt) parts.push(work.late ? `was due ${when(work.dueAt)}` : `due ${when(work.dueAt)}`);
    // Which quote paid for it, so the money and the work are read together.
    const quote = (person.quotes || []).find((q) => q.id === work.quoteId);
    if (quote) parts.push(`against ${quote.scope.slice(0, 40)}`);
    row.append(el('div', parts.join(' · '), work.late ? 'flag' : 'meta'));

    if (work.note) row.append(el('div', work.note, 'meta'));
    row.append(moveForm(person, work));
    list.append(row);
  }
}
