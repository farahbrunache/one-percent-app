// Who somebody is going to approach, and what happened when they did.
//
// The method ends at a first paying customer, and that customer is a person somebody spoke to.
// This is the list that produces one.
//
// Nothing on this screen sends anything and nothing on it should ever learn how. The message
// goes out on Quora, in Signal, or across a counter, and what came back is typed in here
// afterwards. That gap is the product's position, not a gap waiting to be closed.

import { el, get, link, msg, post, when } from '/desk-ui.js';
import { once, settled, wasBefore } from '/desk-after.js';

const STATUSES = ['to approach', 'reached out', 'talking', 'said no', 'paying customer'];

// Said no is on the list and is drawn like every other state. Most people approached say no —
// that is what approaching people is — and a list that only records the yeses would teach
// somebody that approaching people does not work.
function moveForm(person, contact) {
  const form = el('form', null, 'fields');

  const field = el('div', null, 'field');
  const label = el('label', 'Where it got to');
  const pick = el('select');
  pick.id = `contactstatus-${contact.id}`;
  label.htmlFor = pick.id;
  for (const status of STATUSES) {
    const option = el('option', status);
    option.value = status;
    if (status === contact.status) option.selected = true;
    pick.append(option);
  }
  field.append(label, pick);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Move it', 'quiet');
  save.type = 'submit';
  actions.append(save);

  form.append(field, actions);
  once(form, 'submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const was = contact.status;
      await post('contact-move', { id: person.id, contactId: contact.id, status: pick.value });
      await settled(`Now ${pick.value}.`,
        wasBefore('contact-move', { id: person.id, contactId: contact.id, status: was }));
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// Reaching out, written down after it happened. Both halves are optional on their own because
// the ordinary case is sending something today and hearing nothing for a week.
function reachForm(person, contact) {
  const form = el('form', null, 'fields');

  const saidField = el('div', null, 'field');
  const saidLabel = el('label', 'What they said');
  const said = el('textarea');
  said.rows = 2;
  said.id = `contactsaid-${contact.id}`;
  saidLabel.htmlFor = said.id;
  saidField.append(saidLabel, said);

  const backField = el('div', null, 'field');
  const backLabel = el('label', 'What came back');
  const hint = el('span', 'Leave it empty if nothing has yet.', 'hint');
  const back = el('textarea');
  back.rows = 2;
  back.id = `contactback-${contact.id}`;
  backLabel.htmlFor = back.id;
  backField.append(backLabel, hint, back);

  const actions = el('div', null, 'actions');
  const save = el('button', 'Write it down', 'quiet');
  save.type = 'submit';
  actions.append(save);

  form.append(saidField, backField, actions);
  once(form, 'submit', async (event) => {
    event.preventDefault();
    if (!said.value.trim() && !back.value.trim()) return;
    save.disabled = true;
    try {
      await post('contact-reach', {
        id: person.id,
        contactId: contact.id,
        said: said.value,
        back: back.value,
      });
      await settled('Written down.');
    } catch (error) {
      save.disabled = false;
      msg('rmsg', error.message, 'bad');
    }
  });
  return form;
}

// What the Directory says about a contact who came from it, read now and never stored. The row is
// drawn first and this fills in when the answer comes back; a failure says what failed in the same
// place, and the contact stays on the list either way.
function directoryLine(person, contact) {
  const line = el('div', null, 'meta');
  get(`directory-profile&id=${encodeURIComponent(person.id)}&contact=${contact.id}`).then(({ profile }) => {
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    const trade = profile.jobTitle || profile.headline;
    const place = [profile.city, profile.state, profile.country].filter(Boolean).join(', ');
    line.append(el('div', [name, trade].filter(Boolean).join(' · '), null));
    if (profile.skills && profile.skills.length) line.append(el('div', profile.skills.join(', '), 'meta'));
    if (place) line.append(el('div', place, 'meta'));
    // Only an address that opens a page. Anything else is shown as text rather than made a link.
    if (profile.profileUrl && /^https?:\/\//i.test(profile.profileUrl)) {
      const away = link(profile.profileUrl, profile.profileUrl, null);
      away.rel = 'noopener noreferrer';
      away.target = '_blank';
      line.append(away);
    } else if (profile.profileUrl) {
      line.append(el('div', profile.profileUrl, 'meta'));
    }
  }).catch((error) => {
    line.append(el('div', error.message, 'msg bad'));
  });
  return line;
}

// The form that adds somebody. Wired here rather than on the record screen, with every other
// control this panel owns, so the panel is one file to read or delete.
function wireAdd(person) {
  const form = document.getElementById('addcontact');
  once(form, 'submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('contactname');
    const directory = document.getElementById('contactdirectory');
    if (!name.value.trim() && !directory.value.trim()) return;
    try {
      await post('contact-add', {
        id: person.id,
        name: name.value,
        directory: directory.value,
        where: document.getElementById('contactwhere').value,
        why: document.getElementById('contactwhy').value,
      });
      await settled(`${name.value.trim() || 'Directory profile'} added.`);
    } catch (error) {
      msg('rmsg', error.message, 'bad');
    }
  });
}

export function renderContacts(person) {
  const list = document.getElementById('contacts');
  list.textContent = '';
  wireAdd(person);
  // A contact hangs off the case, so there is nowhere to put one until somebody has signed in.
  document.getElementById('addcontact').hidden = !person.linkedCase;
  document.getElementById('contactdirectoryfield').hidden = !person.directoryRead;
  if (!person.linkedCase) {
    list.append(el('p', 'Nobody has signed in against this order yet, so there is nobody to '
      + 'keep a list for.', 'meta'));
    return;
  }

  const contacts = person.contacts || [];
  if (!contacts.length) list.append(el('p', 'Nobody on the list yet.', 'meta'));

  for (const contact of contacts) {
    const row = el('div', null, contact.status === 'paying customer' ? 'row said us' : 'row');
    row.append(el('div', contact.name || 'From the Directory', null));
    if (contact.fromDirectory) row.append(directoryLine(person, contact));

    const parts = [contact.status];
    if (contact.where) parts.push(contact.where);
    parts.push(when(contact.movedAt));
    row.append(el('div', parts.join(' · '), 'meta'));
    if (contact.why) row.append(el('div', contact.why, 'meta'));

    // Every time they were approached, newest first. A status says where it got to; these say
    // what it took, which is the part worth reading when the next sheet is written.
    for (const reach of contact.reaches) {
      const line = el('div', null, 'said');
      line.append(el('div', when(reach.at), 'label'));
      if (reach.said) line.append(el('div', reach.said, null));
      if (reach.back) line.append(el('div', `Back: ${reach.back}`, 'meta'));
      row.append(line);
    }

    row.append(reachForm(person, contact));
    row.append(moveForm(person, contact));
    list.append(row);
  }
}
