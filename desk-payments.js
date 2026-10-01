// What a quote was actually paid, when it was due, and why it differs from what was quoted.
//
// Its own file rather than more of desk-work.js, which already carries four subjects and is
// close to its limit.
//
// This is real money. What somebody charges a client is dollars and reads as dollars, which is
// the opposite of the in-app credits unit the other product uses and must never be confused
// with it.

import { el, money, msg, post, when } from '/desk-ui.js';

// When it is expected. Optional, because plenty of paid work has no date on it and a date
// invented to make a row look complete is a deadline nobody agreed to.
function dueForm(person, quote) {
  const form = el('form', null, 'fields');

  const field = el('div', null, 'field');
  const label = el('label', 'Due');
  const hint = el('span', 'Leave it empty if nothing was agreed. A date makes it show up on the '
    + 'first screen once it passes.', 'hint');
  const input = el('input');
  input.type = 'date';
  input.id = `quotedue-${quote.id}`;
  if (quote.dueAt) input.value = String(quote.dueAt).slice(0, 10);
  label.htmlFor = input.id;
  field.append(label, hint, input);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Set the date', 'quiet');
  save.type = 'submit';
  actions.append(save);

  form.append(field, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await post('quote-due', { id: person.id, quoteId: quote.id, dueAt: input.value });
      window.location.reload();
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// Money arrived. How much, and when. Less than quoted asks for a line saying why, because a
// discount is a decision and it is the kind nobody remembers making.
function paidForm(person, quote) {
  const form = el('form', null, 'fields');

  const amountField = el('div', null, 'field');
  const amountLabel = el('label', 'What actually arrived, in dollars');
  const amount = el('input');
  amount.type = 'number';
  amount.inputMode = 'decimal';
  amount.min = '0';
  amount.step = 'any';
  amount.id = `quotepaid-${quote.id}`;
  amount.value = String(quote.amount);
  amountLabel.htmlFor = amount.id;
  amountField.append(amountLabel, amount);

  const whenField = el('div', null, 'field');
  const whenLabel = el('label', 'When');
  const whenHint = el('span', 'Empty means today.', 'hint');
  const at = el('input');
  at.type = 'date';
  at.id = `quotepaidat-${quote.id}`;
  whenLabel.htmlFor = at.id;
  whenField.append(whenLabel, whenHint, at);

  const whyField = el('div', null, 'field');
  const whyLabel = el('label', 'Why less than quoted');
  const whyHint = el('span', 'Needed only when it came in under. A difference with no reason is '
    + 'a figure nobody can explain later.', 'hint');
  const why = el('input');
  why.type = 'text';
  why.maxLength = 500;
  why.autocomplete = 'off';
  why.id = `quotediscount-${quote.id}`;
  whyLabel.htmlFor = why.id;
  whyField.append(whyLabel, whyHint, why);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Write down what arrived', 'quiet');
  save.type = 'submit';
  actions.append(save);

  form.append(amountField, whenField, whyField, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await post('quote-paid', {
        id: person.id,
        quoteId: quote.id,
        amount: amount.value,
        at: at.value,
        discount: why.value,
      });
      window.location.reload();
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// What a quote reads as once money has been involved, drawn into the row the quote made.
export function renderQuotePayment(person, quote, into) {
  if (quote.paidAt) {
    const short = quote.amount - quote.paid;
    into.append(el('div',
      short > 0
        ? `${money(quote.paid)} of ${money(quote.amount)}, ${when(quote.paidAt)}`
        : `${money(quote.paid)} paid, ${when(quote.paidAt)}`,
      'badge go'));
    // The reason stays visible for as long as the quote does. It is the half of a discount that
    // is worth anything later.
    if (quote.discount) into.append(el('div', quote.discount, 'sheet'));
    return;
  }

  if (quote.dueAt) {
    into.append(el('div',
      quote.late ? `Owed. Was due ${when(quote.dueAt)}` : `Due ${when(quote.dueAt)}`,
      quote.late ? 'flag' : 'meta'));
  }

  // Dating and recording a payment only make sense once they have agreed. Before that there is
  // no amount anybody owes.
  if (quote.status === 'agreed') {
    into.append(dueForm(person, quote));
    into.append(paidForm(person, quote));
  }
}
