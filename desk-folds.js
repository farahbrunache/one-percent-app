// What a shut section says, and which one opens.
//
// Out of desk-record.js because that file passed its size limit, and because this is one
// subject: a record is a dozen sections and only one of them is the work in hand.

import { day, minutes, money, when } from '/desk-ui.js';
import { pathLabel } from '/desk-work.js';

// A record is a dozen sections and one of them is the work in hand. So eleven are shut, and
// what a shut one says is its own state -- a count, a date, the last thing that happened --
// which is how the screen gets read without opening anything.
//
// Which one is open is decided by the record, never remembered from last time. A section left
// open by whoever was here yesterday is noise; one left shut is a step somebody stops seeing.
export function sofar(name, text) {
  document.getElementById(`sofar-${name}`).textContent = text;
}

export function foldLines(person) {
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
  const owed = (person.projects || []).filter((w) => w.state !== 'delivered' && w.state !== 'dropped').length;
  sofar('work', person.projects && person.projects.length
    ? `${owed} still owed of ${person.projects.length}`
    : 'none');
  const approached = (person.contacts || []).filter((c) => c.status !== 'to approach').length;
  sofar('contacts', person.contacts && person.contacts.length
    ? `${approached} approached of ${person.contacts.length}`
    : 'none');
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
export function openWhatIsNext(person) {
  const next = !person.decision ? ['calls', 'decide']
    : !person.recommendedAt ? ['sheet']
    : person.conversationOpen ? ['thread']
      : [];
  for (const fold of document.querySelectorAll('#record details.fold')) {
    fold.open = next.includes(fold.id.slice('fold-'.length));
  }
}
