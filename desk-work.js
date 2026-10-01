// The work itself: the path, the milestones under it, the quotes and the introductions.
//
// These four are one subject -- what happens after a go. Where somebody is headed, the steps on
// the way, what paid work was offered, and who they were put in touch with. The rest of the
// record screen is about the call and the conversation, which is why it lives elsewhere.

import { el, link, msg, post, money, when } from '/desk-ui.js';
import { renderActions } from '/desk-actions.js';
import { renderQuotePayment } from '/desk-payments.js';

const STATUSES = ['planned', 'in progress', 'worked', 'changed direction', 'stalled', 'ghosted'];

// Both paths, always both on screen and the same size, with the one in force outlined.
// Hiding the path somebody is already on made the screen offer one option and read as a
// recommendation, which is the opposite of what two paths neither above the other means.
const PATHS = [
  ['reach', 'Reaching past the average',
    'What the work is worth to the person who needs it, not what the going rate is.'],
  ['smallest', 'The smallest number',
    'One price, one person, one time. A solid step they can actually take.'],
];

// What the path is called, for a section that is shut. Read from the same table the buttons
// are built from, so a rename moves both.
export function pathLabel(path) {
  return (PATHS.find(([value]) => value === path) || [])[1] || '';
}

export function renderPlan(person) {
  const box = document.getElementById('plan');
  box.textContent = '';
  // A path is about working with somebody, and there is nobody to work with until they
  // sign in. The endpoint refuses it for the same reason, so the screen says so rather
  // than offering two buttons that both come back with an error.
  if (!person.linkedCase) {
    box.append(el('p', "A path is set once they've signed in. Until then this is an order, "
      + 'not a person.', 'meta'));
    return;
  }
  for (const [value, label, why] of PATHS) {
    const on = Boolean(person.plan && person.plan.path === value);
    const button = el('button', null, on ? 'path on' : 'path');
    button.type = 'button';
    button.append(document.createTextNode(label));
    button.append(el('span', why, 'why'));
    if (on) button.append(el('span', `Set on ${when(person.plan.setAt)}.`, 'why'));
    button.disabled = on;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await post('plan', { id: person.id, path: value });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    box.append(button);
  }
  for (const former of person.formerPlans) {
    box.append(el('p', `Was on ${former.label} starting ${when(former.setAt)}.`, 'meta'));
  }
}

export function renderSteps(person) {
  const list = document.getElementById('steps');
  list.textContent = '';
  document.getElementById('addstep').hidden = !person.plan;
  if (!person.plan) {
    list.append(el('p', 'Pick a path first. Every milestone belongs to one.', 'meta'));
    return;
  }
  if (!person.milestones.length) {
    list.append(el('p', 'No steps yet.', 'meta'));
  }
  for (const step of person.milestones) {
    const row = el('div', null, 'row');
    row.append(el('div', `${step.position}. ${step.title}`, null));
    row.append(el('div', `${step.status} · ${when(step.updatedAt)}`, 'meta'));
    if (step.outcome) row.append(el('div', step.outcome, 'meta'));

    const form = el('form', null, 'fields');
    const field = el('div', null, 'field');
    const label = el('label', 'What happened');
    const outcome = el('textarea');
    outcome.rows = 2;
    outcome.value = step.outcome || '';
    outcome.id = `outcome-${step.id}`;
    label.htmlFor = outcome.id;
    field.append(label, outcome);

    const pickField = el('div', null, 'field');
    const pickLabel = el('label', 'Status');
    const pick = el('select');
    pick.id = `status-${step.id}`;
    pickLabel.htmlFor = pick.id;
    for (const status of STATUSES) {
      const option = el('option', status);
      option.value = status;
      if (status === step.status) option.selected = true;
      pick.append(option);
    }
    pickField.append(pickLabel, pick);

    const actions = el('div', null, 'actions');
    const save = el('button', 'Record it', 'quiet');
    save.type = 'submit';
    actions.append(save);
    form.append(pickField, field, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await post('milestone-record', {
          id: person.id,
          milestoneId: step.id,
          status: pick.value,
          outcome: outcome.value,
        });
        window.location.reload();
      } catch (error) {
        save.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    row.append(form);
    // The things to do under this step. Nested rather than a list of their own, because an
    // action with no milestone over it is a note, and a note is what this screen already has.
    renderActions(person, step, row);
    list.append(row);
  }
}

const INTRO_OUTCOMES = ['waiting', 'worked', 'went nowhere'];

// Three at once. More than that stops being a choice and starts being a catalogue, and a
// list of prices arriving unasked is what a sales pitch looks like. The endpoint counts
// the same way; this is so the screen says where it stands before somebody types.
const MAX_OPEN_QUOTES = 3;

// Written for the person in front of you, against what the work is. No tier is picked here
// because there are none, and a quote turns nothing on — it records what two people agreed.
export function renderQuotes(person) {
  const list = document.getElementById('quotes');
  const note = document.getElementById('quotenote');
  const form = document.getElementById('writequote');
  const countering = document.getElementById('countering');
  // Which quote the form is answering, if any. Null means a new one.
  let replacing = null;
  countering.hidden = true;
  list.textContent = '';

  if (!person.linked) {
    note.textContent =
      "No account is linked to this order yet, so there's nobody to quote. They link it by " +
      'opening their claim link while signed in.';
    form.hidden = true;
    return;
  }
  // A quote is for paid work, and a no-go said this is not somebody to go on with. The
  // two are not impossible together -- somebody turned down for the method can still be
  // the right person for one piece of work -- but it is a thing to notice rather than a
  // thing to do by reflex, so the screen says so before the form and asks again after it.
  // Three at once, because three is a choice somebody reads in one go and a fourth makes
  // it a list. Each one is answered on its own -- saying no to a price for one piece of
  // work says nothing about the next, so the count is what is waiting rather than what has
  // ever been written.
  const open = person.quotes.filter((q) => q.status === 'offered').length;
  const room = MAX_OPEN_QUOTES - open;

  const lines = [];
  if (person.decision === 'no-go') {
    lines.push('This was a no-go. A quote is for paid work, so think it over before you '
      + 'quote someone you turned down. Nothing stops you.');
  }
  lines.push(room > 0
    ? `In dollars, against what the work actually is. ${open} of ${MAX_OPEN_QUOTES} `
      + 'waiting on an answer.'
    : `${MAX_OPEN_QUOTES} are already waiting on an answer. That's as many as anyone can `
      + 'choose between. Withdraw one, or wait.');
  note.textContent = lines.join(' ');
  form.hidden = room <= 0;

  // The floor under a price, before a number is typed. Arithmetic, so it is here whether or not
  // a model is configured.
  const floor = document.getElementById('breakeven');
  const b = person.breakEven;
  floor.textContent = !b
    ? ''
    : b.breakEven > 0
      ? `Break-even on this person is ${money(b.breakEven)}. ${money(b.theirs)} spent on them`
        + `${b.share ? `, plus ${money(b.share)} of what running the project costs` : ''}`
        + `, less the ${money(b.coveredBySession)} their session brought in.`
      : `Their session already covered what they have cost. Anything quoted is above the floor.`;
  if (b && !b.monthlyKnown) {
    floor.textContent += ' Nothing is listed as a monthly cost, so the project\'s share is not '
      + 'in that.';
  }

  // The other half, and it is not arithmetic. What a piece of work is worth depends on what
  // they said they do and what reaching one more customer would mean for them, so it is a
  // reading rather than a sum. A button, never a step: the form below works the same without it.
  const worth = document.getElementById('worth');
  const worthSaid = document.getElementById('worthsaid');
  worth.textContent = '';
  worthSaid.textContent = '';
  if ((person.drafting?.models || []).length && person.calls.some((call) => call.transcript)) {
    const ask = el('button', 'What is this worth to them?', 'quiet');
    ask.type = 'button';
    ask.addEventListener('click', async () => {
      ask.disabled = true;
      ask.textContent = 'Reading the call…';
      try {
        const answer = await post('quote-worth', { id: person.id });
        worthSaid.textContent = answer.content;
        ask.textContent = 'Read it again';
      } catch (error) {
        worthSaid.textContent = '';
        msg('rmsg', error.message, 'bad');
      } finally {
        ask.disabled = false;
        if (ask.textContent === 'Reading the call…') ask.textContent = 'What is this worth to them?';
      }
    });
    worth.append(ask);
  }

  if (!person.quotes.length) list.append(el('p', 'Nothing quoted yet.', 'meta'));
  for (const quote of person.quotes) {
    const row = el('div', null, 'row');
    row.append(el('div', money(quote.amount), 'value'));
    row.append(el('div', `Written ${when(quote.writtenAt)}`, 'meta'));
    row.append(el('div', quote.scope, null));

    // What they said back. A quote answered by the person it was written for is a fact
    // with a time on it, so it reads as one rather than as a status that moved.
    if (quote.answeredAt) {
      const tone = quote.status === 'agreed' ? 'go' : quote.status === 'declined' ? 'nogo' : 'open';
      row.append(el('div', `They said: ${quote.status}`, `badge ${tone}`));
      row.append(el('div', `Answered ${when(quote.answeredAt)}`, 'meta'));
      if (quote.reason) row.append(el('div', quote.reason, 'sheet'));
    } else if (quote.status === 'offered') {
      row.append(el('div', 'Waiting on them', 'badge open'));
    } else {
      row.append(el('div', `${quote.status} · moved ${when(quote.movedAt)}`, 'meta'));
    }

    // What was actually paid, when it is due, and why it differs. Drawn before the controls
    // because it is the state of the quote rather than something to do about it.
    renderQuotePayment(person, quote, row);

    // Only the moves that belong to this end. Agreeing, declining and asking for a change
    // are the other person's to make, and a control here that does any of them would put
    // their answer on the record in somebody else's hand.
    const actions = el('div', null, 'actions');
    // Countering, on the one answer that asks for it. They said the price is wrong, and the
    // moves beside this -- paid, withdrawn -- are not answers to that. This fills the form
    // below with what was quoted, so the new number is typed against the old one rather than
    // from memory, and sending it closes this quote in the same action.
    if (quote.status === 'changes asked') {
      const counter = el('button', 'Counter it', 'quiet go-on');
      counter.type = 'button';
      counter.addEventListener('click', () => {
        document.getElementById('amount').value = quote.amount;
        document.getElementById('scope').value = quote.scope;
        replacing = quote.id;
        countering.textContent = `Countering ${money(quote.amount)}, written `
          + `${when(quote.writtenAt)}. Sending closes it.`;
        countering.hidden = false;
        document.getElementById('amount').focus();
      });
      actions.append(counter);
    }
    for (const status of ['paid', 'withdrawn']) {
      if (status === quote.status) continue;
      const button = el('button', status, 'quiet');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await post('quote-move', { id: person.id, quoteId: quote.id, status });
          window.location.reload();
        } catch (error) {
          button.disabled = false;
          msg('rmsg', error.message, 'bad');
        }
      });
      actions.append(button);
    }
    row.append(actions);
    list.append(row);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = document.getElementById('amount').value;
    if (person.decision === 'no-go'
      && !window.confirm(`This person was a no-go. Write them a quote for $${amount}?`)) {
      return;
    }
    try {
      await post('quote', {
        id: person.id,
        amount,
        scope: document.getElementById('scope').value,
        replaces: replacing,
      });
      window.location.reload();
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });
}

// Every row is something that happened. There is no state for a match that was considered and
// not made, because that did not happen to anybody and is nobody's record.
export function renderIntroductions(person) {
  const list = document.getElementById('intros');
  list.textContent = '';
  if (!person.introductions.length) {
    list.append(el('p', 'Nobody yet.', 'meta'));
  }
  for (const intro of person.introductions) {
    const row = el('div', null, 'row');
    row.append(link(intro.them.reference || `Order ${intro.them.id}`, `/desk?id=${intro.them.id}`, 'code'));
    row.append(el('div', `${intro.outcome} · introduced ${when(intro.madeAt)}`, 'meta'));
    if (intro.reason) row.append(el('div', intro.reason, 'meta'));
    if (intro.note) row.append(el('div', intro.note, 'meta'));

    const form = el('form', null, 'fields');
    const pickField = el('div', null, 'field');
    const pickLabel = el('label', 'What came of it');
    const pick = el('select');
    pick.id = `intro-${intro.id}`;
    pickLabel.htmlFor = pick.id;
    for (const outcome of INTRO_OUTCOMES) {
      const option = el('option', outcome);
      option.value = outcome;
      if (outcome === intro.outcome) option.selected = true;
      pick.append(option);
    }
    pickField.append(pickLabel, pick);

    const noteField = el('div', null, 'field');
    const noteLabel = el('label', 'In your words');
    const note = el('textarea');
    note.rows = 2;
    note.id = `intronote-${intro.id}`;
    note.value = intro.note || '';
    noteLabel.htmlFor = note.id;
    noteField.append(noteLabel, note);

    const actions = el('div', null, 'actions');
    const save = el('button', 'Record it', 'quiet');
    save.type = 'submit';
    actions.append(save);
    form.append(pickField, noteField, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await post('introduction-record', {
          id: person.id,
          introductionId: intro.id,
          outcome: pick.value,
          note: note.value,
        });
        window.location.reload();
      } catch (error) {
        save.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    row.append(form);
    list.append(row);
  }

  document.getElementById('introduce').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await post('introduce', {
        id: person.id,
        reference: document.getElementById('otherref').value,
        reason: document.getElementById('introreason').value,
      });
      window.location.reload();
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });
}
