// Trades and the introductions they suggest. On a record: their trade from Charging The
// Future's list, and the people in the same sector who could work with them, each one tap from
// an introduction. On Everybody: pairs worth introducing across everybody told yes.
//
// None of this costs anything: the list is a copy, and the suggestions are a query. Why it
// exists is in lib/trades.js.

import { el, get, link, msg, post } from '/desk-ui.js';
import { once, settled } from '/desk-after.js';

function who(person) {
  return person.name || person.reference;
}

function introduceButton(fromId, other, reason, box) {
  const button = el('button', 'Introduce', 'quiet');
  button.type = 'button';
  once(button, 'click', async () => {
    button.disabled = true;
    try {
      await post('introduce', { id: fromId, reference: other.reference, reason });
      await settled(`Introduced to ${who(other)}.`);
    } catch (error) {
      button.disabled = false;
      msg(box, error.message, 'bad');
    }
  });
  return button;
}

function suggestion(person, other, reason) {
  const row = el('div', null, 'row');
  const head = el('div', null, 'who-head');
  head.append(link(who(other), `/desk?id=${other.id}`, 'name'));
  if (other.isDemo) head.append(el('div', 'DEMO', 'badge demo'));
  row.append(head);
  row.append(el('div', other.title, 'meta'));
  const actions = el('div', null, 'actions');
  actions.append(introduceButton(person.id, other, reason, 'rmsg'));
  row.append(actions);
  return row;
}

function option(text, value, selected) {
  const item = el('option', text);
  item.value = value;
  item.selected = selected;
  return item;
}

export function renderTrades(person) {
  const box = document.getElementById('trades');
  box.textContent = '';

  if (!person.trades.length) {
    box.append(el('p', "The trade list hasn't been copied from Charging The Future yet. It's "
      + 'copied once a day, or now with this button. It costs nothing.', 'meta'));
    const copy = el('button', 'Copy the trade list', 'quiet');
    copy.type = 'button';
    once(copy, 'click', async () => {
      copy.disabled = true;
      try {
        const out = await post('trades-copy', {});
        await settled(`Copied ${out.titles} trades.`);
      } catch (error) {
        copy.disabled = false;
        msg('rmsg', error.message, 'bad');
      }
    });
    box.append(copy);
    return;
  }

  // One trade from the list, in their sectors. A native picker, so it scrolls the way the phone
  // already knows how to.
  const field = el('div', null, 'field');
  const label = el('label', 'Their trade');
  label.htmlFor = 'tradepick';
  const pick = el('select');
  pick.id = 'tradepick';
  pick.append(option('Not set', '', false));
  let group = null;
  for (const trade of person.trades) {
    if (!group || group.label !== trade.sector) {
      group = document.createElement('optgroup');
      group.label = trade.sector;
      pick.append(group);
    }
    group.append(option(trade.title, trade.id, person.trade?.id === trade.id));
  }
  once(pick, 'change', async () => {
    pick.disabled = true;
    try {
      const out = await post('trade', { id: person.id, trade: pick.value || null });
      await settled(out.title ? `Trade set: ${out.title}.` : 'Trade cleared.');
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    } finally {
      pick.disabled = false;
    }
  });
  field.append(label, pick);
  box.append(field);

  if (!person.trade) {
    box.append(el('p', 'Set their trade and the people who could work with them show here.', 'meta'));
    return;
  }
  const { sameTrade, sameSector } = person.couldWorkWith;
  if (!sameTrade.length && !sameSector.length) {
    box.append(el('p', `Nobody else told yes is in ${person.trade.sector} yet, or they've all been `
      + 'introduced already.', 'meta'));
    return;
  }
  if (sameTrade.length) {
    box.append(el('h3', `Also ${person.trade.title}`, 'groupname'));
    for (const other of sameTrade) {
      box.append(suggestion(person, other, `Both ${person.trade.title}: overflow work and what to charge.`));
    }
  }
  if (sameSector.length) {
    box.append(el('h3', `Elsewhere in ${person.trade.sector}`, 'groupname'));
    for (const other of sameSector) {
      box.append(suggestion(person, other,
        `${person.trade.title} and ${other.title}, both in ${person.trade.sector}: they can send each other work.`));
    }
  }
}

// Across everybody: the pairs worth introducing, newest first.
export async function renderPairs() {
  const box = document.getElementById('pairs');
  box.textContent = '';
  try {
    const data = await get('pairs');
    if (!data.pairs.length) {
      box.append(el('p', 'No pairs right now. Two people told yes, in the same sector, who '
        + "haven't been introduced, show here.", 'meta'));
      return;
    }
    for (const pair of data.pairs) {
      const row = el('div', null, 'row');
      const head = el('div', null, 'who-head');
      head.append(link(who(pair.a), `/desk?id=${pair.a.id}`, 'name'));
      head.append(el('span', 'and', 'meta'));
      head.append(link(who(pair.b), `/desk?id=${pair.b.id}`, 'name'));
      if (pair.isDemo) head.append(el('div', 'DEMO', 'badge demo'));
      row.append(head);
      row.append(el('div', `${pair.a.title} · ${pair.b.title} · ${pair.sector}`, 'meta'));
      const reason = pair.a.title === pair.b.title
        ? `Both ${pair.a.title}: overflow work and what to charge.`
        : `${pair.a.title} and ${pair.b.title}, both in ${pair.sector}: they can send each other work.`;
      const actions = el('div', null, 'actions');
      actions.append(introduceButton(pair.a.id, pair.b, reason, 'qmsg'));
      row.append(actions);
      box.append(row);
    }
  } catch (error) {
    box.append(el('p', error.message, 'nothing'));
  }
}
