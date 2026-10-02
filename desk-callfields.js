// The four lines on a call: trade, rate, what's in the way, first customer.
//
// Typed by the owner, or filled by the model and then read and saved by the owner. The model's
// button costs money and is marked so; without a model set up it isn't there and the boxes work
// the same. The server side, and why these four, is lib/desk-callfields.js.

import { askModel, el, msg, paidButton, post } from '/desk-ui.js';
import { once, settled } from '/desk-after.js';

const FIELDS = [
  ['trade', 'Trade'],
  ['rate', 'Rate'],
  ['inTheWay', "What's in the way"],
  ['firstCustomer', 'First customer'],
];

export function renderCallFields(person, call) {
  const form = el('form', null, 'fields callfields');
  form.noValidate = true;
  const inputs = {};
  for (const [key, label] of FIELDS) {
    const field = el('div', null, 'field');
    const id = `cf-${call.id}-${key}`;
    const name = el('label', label);
    name.htmlFor = id;
    // A box that wraps rather than a one-line field: a line cut off at the edge has to be
    // tapped into to be read, and reading them at a glance is what they're for.
    const input = el('textarea');
    input.id = id;
    input.rows = 2;
    input.maxLength = 300;
    input.value = call.fields?.[key] || '';
    inputs[key] = input;
    field.append(name, input);
    form.append(field);
  }

  const note = el('p', null, 'meta');
  const actions = el('div', null, 'actions');
  const save = el('button', 'Save', 'quiet');
  save.type = 'submit';
  actions.append(save);

  once(form, 'submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const fields = Object.fromEntries(FIELDS.map(([key]) => [key, inputs[key].value]));
      await post('call-fields', { id: person.id, call: call.id, fields });
      await settled('Saved the four lines.');
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    } finally {
      save.disabled = false;
    }
  });

  // Reading the transcript for them is the model's work, so it's the paid button. What it
  // writes goes into the boxes, not the record: nothing is saved until Save is pressed.
  if ((person.drafting?.models || []).length && call.transcript) {
    const fill = paidButton('Fill from the call');
    const label = fill.querySelector('.paidlabel');
    once(fill, 'click', async () => {
      fill.disabled = true;
      label.textContent = 'Reading the call…';
      try {
        const answer = await askModel(fill, { id: person.id, call: call.id }, 'call-fields-draft');
        for (const [key] of FIELDS) {
          if (answer.fields?.[key]) inputs[key].value = answer.fields[key];
        }
        note.textContent = 'Filled from the call. Read them, change what\'s wrong, then Save. '
          + [answer.model, answer.seconds ? `${answer.seconds}s` : null].filter(Boolean).join(' · ');
      } catch (error) {
        msg('rmsg', error.message, 'bad');
      } finally {
        fill.disabled = false;
        label.textContent = 'Fill from the call';
      }
    });
    actions.append(fill);
  }

  form.append(actions, note);
  return form;
}
