// The things to do under a milestone, and coming back to ask about them.
//
// Its own file rather than more of desk-work.js, which already carries four subjects. A
// milestone says where the work is headed; these are what somebody picks up on a Tuesday.
//
// Nothing here reaches the client. These are the owner's working notes on somebody else's
// situation, and a screen that looked like it might be visible is a screen nobody writes in.

import { el, msg, post, when } from '/desk-ui.js';
import { once, settled, wasBefore } from '/desk-after.js';

const STATUSES = ['open', 'done', 'dropped'];

// The same four the server knows. Written out rather than fetched, because a select that waits
// on a request is a control that is empty for the moment somebody reaches for it.
const CADENCES = [
  ['none', 'No reminder'],
  ['weekly', 'Every week'],
  ['fortnightly', 'Every two weeks'],
  ['monthly', 'Every month'],
];

function closeOutForm(person, action) {
  const form = el('form', null, 'fields');

  const pickField = el('div', null, 'field');
  const pickLabel = el('label', 'Where it got to');
  const pick = el('select');
  pick.id = `actionstatus-${action.id}`;
  pickLabel.htmlFor = pick.id;
  for (const status of STATUSES) {
    const option = el('option', status);
    option.value = status;
    if (status === action.status) option.selected = true;
    pick.append(option);
  }
  pickField.append(pickLabel, pick);

  const field = el('div', null, 'field');
  const label = el('label', 'What happened');
  const outcome = el('textarea');
  outcome.rows = 2;
  outcome.value = action.outcome || '';
  outcome.id = `actionoutcome-${action.id}`;
  label.htmlFor = outcome.id;
  field.append(label, outcome);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Record it', 'quiet');
  save.type = 'submit';
  actions.append(save);

  // Asked and still going. Separate from recording an outcome because they are different
  // things: one closes the item, the other says it is alive and pushes the date out a full
  // cycle from today.
  if (action.status === 'open' && action.cadence !== 'none') {
    const asked = el('button', 'Asked, still going', 'quiet');
    asked.type = 'button';
    once(asked, 'click', async () => {
      asked.disabled = true;
      try {
        await post('action-push', { id: person.id, actionId: action.id });
        await settled('Pushed out a cycle.');
      } catch (error) {
        asked.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    actions.append(asked);
  }

  form.append(pickField, field, actions);
  once(form, 'submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const was = { status: action.status, outcome: action.outcome || '' };
      await post('action-record', {
        id: person.id,
        actionId: action.id,
        status: pick.value,
        outcome: outcome.value,
      });
      await settled(`Recorded as ${pick.value}.`,
        wasBefore('action-record', { id: person.id, actionId: action.id, ...was }));
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

function addForm(person, step) {
  const form = el('form', null, 'fields');

  const field = el('div', null, 'field');
  const label = el('label', 'What to do');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 300;
  input.autocomplete = 'off';
  input.id = `newaction-${step.id}`;
  label.htmlFor = input.id;
  field.append(label, input);

  const pickField = el('div', null, 'field');
  const pickLabel = el('label', 'Come back to it');
  const hint = el('span', 'No reminder is a real answer. Plenty of this has a date of its own.',
    'hint');
  const pick = el('select');
  pick.id = `newcadence-${step.id}`;
  pickLabel.htmlFor = pick.id;
  for (const [value, text] of CADENCES) {
    const option = el('option', text);
    option.value = value;
    pick.append(option);
  }
  pickField.append(pickLabel, hint, pick);

  const actions = el('div', null, 'actions');
  const add = el('button', 'Add it', 'quiet');
  add.type = 'submit';
  actions.append(add);

  form.append(field, pickField, actions);
  once(form, 'submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    add.disabled = true;
    try {
      await post('action-add', {
        id: person.id,
        milestoneId: step.id,
        title: input.value,
        cadence: pick.value,
      });
      await settled('Action added.');
    } catch (error) {
      add.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// Drawn under the milestone it belongs to, into the row that milestone made.
export function renderActions(person, step, into) {
  const box = el('div', null, 'rows');
  const items = step.actions || [];
  // A line saying where the milestone stops and its actions start. Without it the step's own
  // close-out form and the first action run together and read as one control.
  box.append(el('p', 'What to do under this step', 'label'));
  if (!items.length) box.append(el('p', 'Nothing yet.', 'meta'));

  for (const action of items) {
    const row = el('div', null, action.due ? 'row said us' : 'row');
    row.append(el('div', action.title, null));

    const parts = [action.status];
    if (action.status === 'open' && action.nextAt) {
      parts.push(action.due ? `due ${when(action.nextAt)}` : `ask ${when(action.nextAt)}`);
    }
    if (action.cadence !== 'none') parts.push(action.cadenceLabel);
    if (action.closedAt) parts.push(when(action.closedAt));
    row.append(el('div', parts.join(' · '), action.due ? 'flag' : 'meta'));

    if (action.outcome) row.append(el('div', action.outcome, 'meta'));
    row.append(closeOutForm(person, action));
    box.append(row);
  }

  box.append(addForm(person, step));
  into.append(box);
}
