// One person's record.
//
// Everything here is about the person whose reference is at the top: what's owed on them, what
// they bought, the calls, the decision, the sheet, and the conversation a go opens. The work
// they're doing -- the path, the milestones, the quotes, the introductions -- is its own module,
// imported and rendered in place.

import { el, link, msg, get, post, when, day, minutes, money, owed, mpage, here }
  from '/desk-ui.js';
import { renderPlan, renderSteps, renderQuotes, renderIntroductions, pathLabel }
  from '/desk-work.js';
import { SHEET_LINKS, SHEET_RULES, SHEET_TEMPLATE, unfilledSlots } from '/sheet.js';

// Where in the conversation this is. Same shape as the queue's pager, and the page number
// goes in the address for the same reason: a place in a list has to be linkable and the
// back button has to work. A conversation rendered in full grows without end, which leaves
// a keyboard or a screen reader no way past it.
function renderThreadPager(person) {
  const box = document.getElementById('threadpager');
  box.textContent = '';
  const total = person.messageCount;
  const perPage = person.messagesPerPage;
  const at = person.messagePage;
  const last = Math.max(1, Math.ceil(total / perPage));
  box.hidden = total <= perPage;
  if (box.hidden) return;

  const first = (at - 1) * perPage + 1;
  const upTo = Math.min(at * perPage, total);
  const to = (n) => {
    const url = new URL(window.location.href);
    url.searchParams.set('mpage', String(n));
    return url.pathname + url.search;
  };
  if (at > 1) box.append(link('Older', to(at - 1), 'button quiet-link'));
  box.append(el('span', `${first}–${upTo} of ${total} · page ${at} of ${last}`, 'meta'));
  if (at < last) box.append(link('Newer', to(at + 1), 'button quiet-link'));
}


function renderOwed(person) {
  const box = document.getElementById('owed');
  box.textContent = '';
  const items = owed(person);
  if (!items.length) {
    box.append(el('p', "Nothing. You've read them, decided, and written their sheet.", 'meta'));
    return;
  }
  for (const item of items) {
    const row = el('div', null, 'row');
    row.append(el('div', item.what, item.yours ? null : 'meta'));
    box.append(row);
  }
}

function renderDecision(person) {
  const box = document.getElementById('decide');
  const said = document.getElementById('decided');
  box.textContent = '';
  if (person.decision) {
    said.hidden = false;
    said.textContent = `${person.decision === 'go' ? 'Go' : 'No-go'}, ${when(person.decidedAt)}.`;
  } else {
    said.hidden = true;
  }
  // Equal weight, both ways. A no-go is a sheet and a path, not a rejection, so the
  // screen must not make one of the two the easy press.
  for (const [value, label, tone] of [['go', 'Go', 'yes'], ['no-go', 'No-go', 'no']]) {
    const on = value === person.decision;
    const button = el('button', label, `quiet decide ${tone}${on ? ' on' : ''}`);
    button.type = 'button';
    button.style.flex = '1';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await post('decide', { id: person.id, decision: value });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    box.append(button);
  }
}

// Every call against this order, newest first. Two of them means a session dropped and was
// restarted, which is worth seeing rather than hiding behind whichever one arrived last.
// Only the calls that came back. A start that produced no words is a row with nothing in
// it to read, decide on or copy, and a screen that lists three of them is asking somebody
// to scroll past the same non-event on the way to the one call that happened.
//
// They are still rows in the database. The starts count against the three-in-a-day limit
// and the hourly job keeps trying for a record while the voice service still holds one;
// neither of those is work for a person, so neither is on this screen.
// Every order this person bought. An order is one purchase -- a payment, a code, a call and
// the sheet written from that call. A case is the person, and it exists from the moment they
// sign in. So this panel says which purchases belong to whoever is on screen, and says
// plainly when nobody has signed in yet rather than leaving the screen to imply it.
function renderOrders(person) {
  const box = document.getElementById('orders');
  const note = document.getElementById('ordersnote');
  box.textContent = '';

  if (!person.linkedCase) {
    note.textContent = "Nobody has signed in against this order yet, so it's interest and "
      + 'nothing more. It becomes a person the moment they open their claim link while '
      + 'signed in to Skills Economy.';
    return;
  }

  note.textContent = person.orders.length === 1
    ? 'One session so far.'
    : `${person.orders.length} sessions, one person.`;

  for (const order of person.orders) {
    const row = el('div', null, order.thisOne ? 'row said us' : 'row');
    row.append(el('div', 'Reference code', 'label'));
    row.append(el('div', order.reference, 'code'));
    if (order.calledAt) row.append(el('div', `Called ${when(order.calledAt)}`, 'meta'));
    else row.append(el('div', 'No call came back', 'meta'));
    if (order.decision) {
      row.append(el('div', order.decision === 'go' ? 'Go' : 'No-go',
        `badge ${order.decision === 'go' ? 'go' : 'nogo'}`));
    }
    if (order.recommendedAt) row.append(el('div', `Sheet written ${when(order.recommendedAt)}`, 'meta'));
    if (!order.thisOne) {
      const go = link('Open this one', `/desk?id=${order.id}`, 'button quiet-link');
      row.append(go);
    }
    box.append(row);
  }
}

function renderCalls(person) {
  const box = document.getElementById('calls');
  const calls = person.calls.filter((call) => call.transcript);
  box.textContent = '';
  if (!calls.length) {
    box.append(el('p', person.calls.length
      ? 'The session started but nothing was recorded.'
      : "No call has started on this order.", 'meta'));
    return;
  }
  for (const call of calls) {
    const row = el('div', null, 'row');
    row.append(el('div', call.kind === 'intake' ? 'Intake' : 'Follow-up', 'label'));
    row.append(el('div', `${when(call.endedAt || call.startedAt)} · ${minutes(call.seconds)}`, 'meta'));
    const open = el('details');
    open.append(el('summary', 'Read it'));
    const wrap = el('div', null, 'transcript');
    wrap.append(el('pre', call.transcript, null));
    open.append(wrap);

    // The next conversation gets started somewhere else, so getting the words out as plain
    // text is the point rather than a convenience.
    const actions = el('div', null, 'actions');
    const copy = el('button', 'Copy it', 'quiet');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(call.transcript);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Select it and copy';
      }
      setTimeout(() => { copy.textContent = 'Copy it'; }, 2000);
    });
    actions.append(copy);

    // The voice service's own record of the call, whole. It is what a test case for a
    // conversation has to be written from: what actually happened, rather than what this
    // side remembered of it.
    if (call.callId) {
      const everything = el('button', 'Everything the voice service has', 'quiet');
      everything.type = 'button';
      everything.addEventListener('click', async () => {
        everything.disabled = true;
        everything.textContent = 'Asking…';
        try {
          const record = await get(`call-record&call=${encodeURIComponent(call.callId)}`);
          const text = JSON.stringify(record, null, 2);
          const shown = el('pre', text, null);
          wrap.append(shown);
          try {
            await navigator.clipboard.writeText(text);
            everything.textContent = 'Copied, and shown below';
          } catch {
            everything.textContent = 'Shown below — copy it from there';
          }
        } catch (error) {
          everything.textContent = 'Everything the voice service has';
          everything.disabled = false;
          msg('rmsg', error.message, 'bad');
        }
      });
      actions.append(everything);
    }

    open.append(actions);
    row.append(open);
    box.append(row);
  }
}

// Written once and edited afterwards, because what somebody should do next is not settled in
// one sitting and the sheet is theirs to read whenever they come back.
// The sheet, and the shape it is written in.
//
// The template is a button rather than the box's starting contents. A box that fills itself
// produces sheets with a bracket left in them, because the structure was there before anybody
// decided to use it. Pressing for it is a decision, and the guard below catches the rest.
function renderRecommendations(person) {
  const input = document.getElementById('recommendbody');
  const form = document.getElementById('recommendform');

  if (person.recommendations) input.value = person.recommendations;

  // The same rules the model is given, where the person typing can read them.
  const rules = document.getElementById('sheetrules');
  rules.textContent = '';
  for (const rule of SHEET_RULES) rules.append(el('li', rule, null));
  document.getElementById('sheetlinks').textContent =
    'Addresses worth naming: ' + SHEET_LINKS.map(([name, href]) => `${name} ${href}`).join(' · ');

  const template = document.getElementById('usetemplate');
  template.addEventListener('click', () => {
    if (input.value.trim() && !window.confirm('Replace what is in the box with the template?')) {
      return;
    }
    input.value = SHEET_TEMPLATE;
    input.focus();
    input.setSelectionRange(0, 0);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // A bracket left in is the template showing through. They read this word for word, so it
    // is caught here rather than in the sheet somebody opens tomorrow.
    const left = unfilledSlots(input.value);
    if (left && !window.confirm(
      `${left} part${left === 1 ? ' is' : 's are'} still in square brackets. Send it anyway?`,
    )) {
      return;
    }
    try {
      await post('recommend', { id: person.id, body: input.value });
      window.location.reload();
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });

  renderDrafting(person);
}

// The conversation, which exists only on a go. Before a decision and after a no-go there
// is nothing decided to talk about, and the screen says which of the two it is rather than
// showing a form that would be refused.
function renderThread(person) {
  const list = document.getElementById('thread');
  const note = document.getElementById('threadnote');
  const form = document.getElementById('reply');
  list.textContent = '';

  if (!person.linked) {
    note.textContent =
      "No account is linked to this order yet, so there's nowhere to send a message. "
      + 'They link it by opening their claim link while signed in.';
    form.hidden = true;
    return;
  }
  if (!person.conversationOpen) {
    note.textContent = person.decision === 'no-go'
      ? 'No-go and nothing quoted, so the conversation is closed. They keep their sheet and '
        + 'everything they already had. Change the decision, or quote them, and it opens.'
      : "Not decided yet, so there's no conversation. A go opens it, and the opening line "
        + 'goes out once you write the sheet.';
    form.hidden = true;
    return;
  }
  note.textContent = person.approvedAt
    ? 'Open since ' + when(person.approvedAt) + '. This is where the work happens after the sheet.'
    : 'Open because you quoted them. Quoting somebody is choosing to work with them, so it opens '
      + 'the same door a go does.';
  form.hidden = false;

  if (!person.messages.length) {
    list.append(el('p', 'Nothing said yet. The opening line goes out once you write the '
      + 'sheet.', 'meta'));
  }
  for (const message of person.messages) {
    const theirs = message.author === 'client';
    const scripted = message.author === 'opening';
    const row = el('div', null,
      scripted ? 'row' : theirs ? 'row said them' : 'row said us');
    row.append(el('div',
      theirs ? 'Them' : message.author === 'opening' ? 'Opening line' : 'You', 'label'));
    row.append(el('div', message.body, null));
    row.append(el('div', when(message.at), 'meta'));
    list.append(row);
  }

  renderThreadPager(person);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('replybody');
    try {
      await post('reply', { id: person.id, body: input.value });
      const back = new URL(window.location.href);
      back.searchParams.delete('mpage');
      window.location.replace(back);
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });

  renderReplyDrafting(person);
}

// Drafting, pointed at the reply rather than at the sheet. Same model, same limit, same
// rule that nothing it writes is sent until it has been read.
function renderReplyDrafting(person) {
  const drafting = person.drafting || { models: [], chosen: null };
  const button = document.getElementById('draftreply');
  const note = document.getElementById('replydraftnote');
  if (!drafting.models.length) {
    button.hidden = true;
    note.textContent = 'No drafting model is set up, so you write the reply yourself.';
    return;
  }
  button.addEventListener('click', async () => {
    const input = document.getElementById('replybody');
    button.disabled = true;
    note.textContent = 'Asking. A worker starting from cold takes up to a minute.';
    try {
      const written = await post('draft', { id: person.id, of: 'reply' });
      input.value = written.content;
      input.focus();
      note.textContent = 'Read it before you send it. '
        + [written.model, written.seconds + 's'].filter(Boolean).join(' · ');
    } catch (error) {
      note.textContent = '';
      msg('rmsg', error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  });
}

// The draft button writes into the sheet box and stops there. Nothing it produces reaches
// the person until it has been read and the operator presses Write it.
function renderDrafting(person) {
  const drafting = person.drafting || { models: [], chosen: null };
  const button = document.getElementById('draftit');
  const note = document.getElementById('draftnote');
  const row = document.getElementById('models');
  row.textContent = '';

  if (!drafting.models.length) {
    button.hidden = true;
    note.textContent = 'No drafting model is set up, so you write the sheet yourself.';
    return;
  }

  if (drafting.models.length > 1) {
    row.append(document.createTextNode('Drafting with: '));
    for (const model of drafting.models) {
      const chosen = model.slot === drafting.chosen;
      const pick = el('button', model.name + (chosen ? ' (in use)' : ''), 'quiet');
      pick.type = 'button';
      pick.disabled = chosen;
      pick.addEventListener('click', async () => {
        try {
          await post('model', { slot: model.slot });
          window.location.reload();
        } catch (error) {
          msg('rmsg', error.message, 'bad');
        }
      });
      row.append(pick);
    }
  }

  button.addEventListener('click', async () => {
    const input = document.getElementById('recommendbody');
    button.disabled = true;
    note.textContent = 'Asking. A worker starting from cold takes up to a minute.';
    try {
      const written = await post('draft', { id: person.id });
      input.value = written.content;
      input.focus();
      const cost = [
        written.model,
        written.seconds + 's',
        written.promptTokens ? written.promptTokens + ' in' : null,
        written.completionTokens ? written.completionTokens + ' out' : null,
      ].filter(Boolean).join(' · ');
      note.textContent = 'Read it before you file it. ' + cost +
        (written.fellBack ? ' — the chosen model is no longer configured, so this is the one that is.' : '');
    } catch (error) {
      note.textContent = '';
      msg('rmsg', error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  });
}

function renderFirstCustomer(person) {
  const box = document.getElementById('firstcustomer');
  const said = document.getElementById('earned');
  box.textContent = '';
  if (!person.linkedCase) {
    said.hidden = true;
    box.append(el('p', "This is the end of the work, and it belongs to a person. It opens "
      + "once they've signed in.", 'meta'));
    return;
  }
  said.hidden = !person.firstCustomerAt;
  if (person.firstCustomerAt) {
    said.textContent = `Had a paying customer by ${when(person.firstCustomerAt)}.`;
  }
  const reached = !person.firstCustomerAt;
  // The one filled control on the screen. It is the end of the work, and the design
  // spends its single solid fill on the thing that finishes something.
  const button = el('button', reached ? 'They have a paying customer' : 'Take that back',
    reached ? 'go-on' : 'quiet');
  button.type = 'button';
  button.style.flex = '1';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await post('first-customer', { id: person.id, reached });
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  box.append(button);
}

function renderEvents(person) {
  const list = document.getElementById('events');
  list.textContent = '';
  if (!person.events.length) {
    list.append(el('p', 'Nothing written down yet.', 'meta'));
    return;
  }
  for (const event of person.events) {
    const row = el('div', null, 'row');
    row.append(el('div', event.label, null));
    row.append(el('div', when(event.at), 'meta'));
    if (event.detail) row.append(el('div', event.detail, 'meta'));
    list.append(row);
  }
}

// A record is a dozen sections and one of them is the work in hand. So eleven are shut, and
// what a shut one says is its own state -- a count, a date, the last thing that happened --
// which is how the screen gets read without opening anything.
//
// Which one is open is decided by the record, never remembered from last time. A section left
// open by whoever was here yesterday is noise; one left shut is a step somebody stops seeing.
function sofar(name, text) {
  document.getElementById(`sofar-${name}`).textContent = text;
}

function foldLines(person) {
  const done = person.milestones.filter((step) => step.status === 'worked').length;
  const openQuotes = person.quotes.filter((quote) => quote.status === 'offered');
  const last = person.messages[person.messages.length - 1];

  sofar('decide', person.decision
    ? `${person.decision === 'go' ? 'Go' : 'No-go'} · ${day(person.decidedAt)}`
    : 'not yet');
  sofar('sheet', person.recommendedAt ? `written ${day(person.recommendedAt)}` : 'not written');
  sofar('thread', !person.conversationOpen
    ? (person.decision === 'no-go' ? 'closed' : 'opens on a go')
    : person.messageCount
      ? `${person.messageCount} · last from ${last && last.author === 'client' ? 'them' : 'you'}`
      : 'nothing said yet');
  sofar('plan', person.plan ? pathLabel(person.plan.path) : 'not set');
  sofar('steps', person.milestones.length ? `${done} of ${person.milestones.length} done` : 'none');
  sofar('quotes', person.quotes.length
    ? `${openQuotes.length} open of ${person.quotes.length}`
    : 'none');
  sofar('intros', person.introductions.length ? String(person.introductions.length) : 'none');
  sofar('calls', person.calls.length ? `${person.calls.length} · ${minutes(person.calls[0].seconds)}` : 'none');
  sofar('orders', String(person.orders.length));
  sofar('earned', person.firstCustomerAt ? day(person.firstCustomerAt) : 'not yet');
  sofar('events', String(person.events.length));
}

// The next thing, and nothing else. A no-go with its sheet written has nothing waiting, so
// nothing opens -- which says so more plainly than a section standing open with no work in it.
//
// The one pair is the call and the decision. You cannot decide without reading, so a record
// with no decision on it opens both, in that order, and the buttons are under the words they
// are about.
function openWhatIsNext(person) {
  const next = !person.decision ? ['calls', 'decide']
    : !person.recommendedAt ? ['sheet']
    : person.conversationOpen ? ['thread']
      : [];
  for (const fold of document.querySelectorAll('#record details.fold')) {
    fold.open = next.includes(fold.id.slice('fold-'.length));
  }
}

export function renderPerson(person) {
  const heading = document.getElementById('ref');
  heading.textContent = person.reference || `Order ${person.id}`;
  if (person.isDemo) heading.append(el('span', 'DEMO', 'badge demo'));
  const latest = person.calls[0];
  document.getElementById('called').textContent =
    (latest ? `Called ${when(latest.endedAt || latest.startedAt)}` : 'No call yet') +
    (person.linked ? '' : ' · no account linked yet');
  renderCalls(person);
  renderOwed(person);
  renderDecision(person);
  renderRecommendations(person);
  renderOrders(person);
  renderThread(person);
  renderPlan(person);
  renderSteps(person);
  renderQuotes(person);
  renderIntroductions(person);
  renderFirstCustomer(person);
  renderEvents(person);
  foldLines(person);
  openWhatIsNext(person);

  document.getElementById('addstep').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('steptitle');
    try {
      await post('milestone-add', { id: person.id, title: input.value });
      window.location.reload();
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });

  document.getElementById('addnote').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('note');
    try {
      await post('note', { id: person.id, note: input.value });
      window.location.reload();
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });
}
