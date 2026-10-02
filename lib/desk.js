// The vocabulary of the desk: the two paths a plan can take, what a milestone's status can
// be, and the kinds of thing that go on a person's record.
//
// These lists are closed on purpose. A screen that renders a label for every value can only
// do that while the values are known, and a status invented at a call site is a status no
// screen knows how to draw.

// The two paths come from the pitch templates and carry their names. Neither ranks above the
// other, and no screen may present one as the lesser choice — a person who wants a steady
// ordinary level picked a goal, not a smaller version of somebody else's.
export const PLAN_PATHS = {
  reach: {
    label: 'Reaching past the average',
    blurb: 'Wants to be well above the average, and the work is how far and in what order.',
  },
  smallest: {
    label: 'The smallest number',
    blurb: 'Wants steady and ordinary, and the work is the first customer and the first step.',
  },
};

export function isPlanPath(value) {
  return Object.prototype.hasOwnProperty.call(PLAN_PATHS, value);
}

// Stalled and ghosted describe a situation, never a person. Somebody going quiet is the most
// ordinary thing in this population, and a screen that reads like an accusation about it is
// wrong however accurate the field is.
export const MILESTONE_STATUSES = [
  'planned',
  'in progress',
  'worked',
  'changed direction',
  'stalled',
  'ghosted',
];

export function isMilestoneStatus(value) {
  return MILESTONE_STATUSES.includes(value);
}

// What an action item can be. Three, and two of them are endings.
//
// Dropped is not failure and no screen may draw it as one. Most of what gets written down stops
// being the right thing to do before anybody gets to it, and a list that only lets somebody
// finish is a list they stop writing in.
export const ACTION_STATUSES = ['open', 'done', 'dropped'];

export function isActionStatus(value) {
  return ACTION_STATUSES.includes(value);
}

// How often to come back to an open item, in days. Asking again is the part that fails, so the
// row carries the date rather than the owner carrying it.
//
// None is the default and it is a real answer, not an absence. Plenty of what somebody is doing
// has a date of its own or no business being chased, and a product that puts every line on a
// schedule teaches people to ignore the schedule.
export const CADENCES = {
  none: { label: 'No reminder', days: null },
  weekly: { label: 'Every week', days: 7 },
  fortnightly: { label: 'Every two weeks', days: 14 },
  monthly: { label: 'Every month', days: 30 },
};

export function isCadence(value) {
  return Object.prototype.hasOwnProperty.call(CADENCES, value);
}

// Where a contact got to. Five, and the order is the order things happen in.
//
// "Said no" is one of them and it is not a failure state. Most people approached say no, that is
// what approaching people is, and a list that only records the ones who said yes teaches
// somebody that approaching people does not work. The count of nos is the evidence that the
// work happened.
export const CONTACT_STATUSES = [
  'to approach',
  'reached out',
  'talking',
  'said no',
  'paying customer',
];

export function isContactStatus(value) {
  return CONTACT_STATUSES.includes(value);
}

// The one that ends the method. Marking a contact this way is the same fact as the first
// customer date on the case, so the desk sets both rather than asking somebody to record it
// twice and then disagree with itself.
export const CONTACT_PAID = 'paying customer';

// Where a piece of work the operator owes somebody has got to.
//
// Dropped is here for the same reason it is on an action: work agreed and then overtaken is
// ordinary, and a list that only lets somebody finish is a list they stop writing in. What it is
// not is a way to make a paid project disappear -- the money is still on the quote, and a dropped
// project against a paid quote is exactly the thing worth seeing.
export const PROJECT_STATES = ['to do', 'doing', 'delivered', 'dropped'];

export function isProjectState(value) {
  return PROJECT_STATES.includes(value);
}

export const PROJECT_DELIVERED = 'delivered';

// When an item next comes back, from a cadence. Null where there is none, which is what stops
// it reaching the morning screen at all.
export function nextDueAt(cadence, from = new Date()) {
  const days = CADENCES[cadence]?.days ?? null;
  if (days === null) return null;
  return new Date(from.getTime() + days * 24 * 3_600_000).toISOString();
}

// Read the call, then decide. A machine may sort the queue and may not decide anything in it.
export const DECISIONS = ['go', 'no-go'];

export function isDecision(value) {
  return DECISIONS.includes(value);
}

// What a line on the record can be. The detail beside it is written by whoever acted.
export const EVENT_KINDS = {
  decided: 'Decided',
  // Rows written before the word was retired. Kept so they still carry a label rather than
  // rendering as a bare key; nothing writes it any more.
  assessed: 'Decided',
  recommended: 'Recommendations written',
  'plan.set': 'Plan set',
  'milestone.added': 'Milestone added',
  'milestone.recorded': 'Outcome recorded',
  'action.added': 'Action added',
  'action.recorded': 'Action closed out',
  'action.asked': 'Asked about again',
  'quote.due': 'Quote dated',
  'quote.paid': 'Quote paid',
  'contact.added': 'Someone to approach',
  'contact.moved': 'Contact updated',
  'contact.reached': 'Reached out',
  'project.taken': 'Work taken on',
  'project.moved': 'Work updated',
  'quote.written': 'Quote written',
  'quote.moved': 'Quote updated',
  'introduction.made': 'Introduced',
  'introduction.recorded': 'Introduction outcome',
  'first-customer': 'First paying customer',
  // Both of these were being written with nothing to render them, so the trail showed the raw key
  // where every other line showed words. One is the moment the channel opens, which is the single
  // most load-bearing event on a record; the other is the person answering, which is the only kind
  // here the client writes rather than the operator.
  'conversation.opened': 'Conversation opened',
  'call-fields': 'Call notes saved',
  'own-profile': 'Directory profile linked',
  trade: 'Trade recorded',
  'quote.answered': 'Quote answered',
  note: 'Note',
};

export function isEventKind(value) {
  return Object.prototype.hasOwnProperty.call(EVENT_KINDS, value);
}

// Where a quote has got to. Not a tier and not a plan: every quote is written for the person it
// is for, so there is no level here and nothing a status turns on.
// Where a quote can get to. `offered` is the operator's; `agreed`, `declined` and
// `changes asked` are the answer from the person it was written for; `paid` and `withdrawn`
// are the operator's again, afterwards.
export const QUOTE_STATUSES = [
  'offered', 'agreed', 'declined', 'changes asked', 'paid', 'withdrawn',
];

export function isQuoteStatus(value) {
  return QUOTE_STATUSES.includes(value);
}

// The three a quoted person can choose. Agreeing needs nothing said; the other two ask for a
// line, because a quote that comes back with no reason leaves the operator guessing at a
// number, a scope or a date, and guessing produces a second quote that is wrong the same way.
export const QUOTE_ANSWERS = ['agreed', 'declined', 'changes asked'];

// The two answers that hand the quote back. Agreeing puts the work on the person who wrote it;
// asking for a change puts a new quote on them. Declining ends it and owes nobody anything.
//
// A quote sat in both of those states with nothing anywhere saying so. The morning screen asked
// two questions -- new calls, unread messages -- and an answered quote is neither, so somebody
// who had agreed to pay waited on a screen that said nothing was waiting.
export const QUOTE_ANSWERS_WAITING = ['agreed', 'changes asked'];

export function quoteIsWaitingOnYou(status) {
  return QUOTE_ANSWERS_WAITING.includes(status);
}

export function isQuoteAnswer(value) {
  return QUOTE_ANSWERS.includes(value);
}

// How many quotes can be waiting on somebody at once.
//
// Three, because three is a choice and more is a catalogue. Good, better, best is something
// a person reads in one go and picks from; a fourth turns it into a list to work through,
// and a list of prices arriving unasked is what a sales pitch looks like.
//
// It counts what is still on offer, not what has ever been written. Answering one frees the
// slot, so a long relationship can carry any number of quotes over time -- what is capped is
// how many are open at once, which is the thing that reads as pressure.
export const MAX_OPEN_QUOTES = 3;

// What came of putting two people in touch. Three states and no fourth: there is no declined or
// unsafe outcome, because a match that should not happen is never recorded in the first place.
export const INTRODUCTION_OUTCOMES = ['waiting', 'worked', 'went nowhere'];

export function isIntroductionOutcome(value) {
  return INTRODUCTION_OUTCOMES.includes(value);
}

// An intake call is the one somebody bought to get here. A follow-up happens inside a
// relationship that already exists, against a plan that already exists, and does not restart
// anything — which is why the two have to be told apart in the data and not only in a caption.
//
// A session that drops and is restarted is two attempts at the same call, so both are intake.
export const CALL_KINDS = ['intake', 'follow-up'];

export function isCallKind(value) {
  return CALL_KINDS.includes(value);
}

// Who wrote a message. Two sides, named rather than inferred from whether an account id
// matches, so a thread reads correctly even when it is read from the other end.
export const MESSAGE_AUTHORS = ['operator', 'client'];

export function isMessageAuthor(value) {
  return MESSAGE_AUTHORS.includes(value);
}

// The only funnel this product can measure, and where it has to start.
//
// Leads come from Quora. There is no address, no open rate and no click — nothing above the
// intake call is visible and nothing ever will be. A funnel that invented a top row would be
// measuring a guess, so this one begins where the data begins: a call that came back.
//
// Each stage is a strict subset of the one above it, which is what makes the drop between two
// of them mean something.
// Six, and the middle two are what the method actually is.
//
// It used to run called, go, on a path, something worked, first paying customer. "Something
// worked" is a milestone the operator marks, so four of those five measured the desk's own
// bookkeeping and only the last measured the person. A funnel made of what the operator typed
// says how busy the operator was.
//
// Approaching people is the method. The call produces a number and a first customer to aim at,
// the sheet says who to go to, and somebody either goes or does not. So the list existing and
// the list being acted on are the two rows between a path and a paying customer, and they are
// facts about the person rather than judgments about them.
//
// Each count is a strict subset of the one above, computed cumulatively, because a drop between
// two rows is only a rate when everybody in the lower row is also in the higher one.
export const FUNNEL_STAGES = [
  { key: 'called', label: 'Calls that came back' },
  { key: 'go', label: 'Worth going on with' },
  { key: 'planned', label: 'On a path' },
  { key: 'listed', label: 'Someone to approach' },
  { key: 'approached', label: 'Approached somebody' },
  { key: 'earning', label: 'First paying customer' },
];

// What it took to get a call, and what a call turned into. Four rows, and the top one is the only
// figure on this desk the operator types in.
//
// The six rows above measure whether the method worked for the person who called. These measure
// whether selling the call works, which is a different question with the same people in it. Both
// descend from the call and neither is a version of the other, so they sit side by side rather
// than one replacing the other.
//
// The list is maintained in Charging The Future's Directory and cannot be read from here: the
// agreement between the two products carries the skills taxonomy and nothing that joins a person
// to anything, so the count of people on that list is not available over any route this product
// has. It is entered, and the screen says which rows are counted and which one is not. A figure
// somebody typed, drawn to look like a measurement, is the thing the cost screen already refuses
// to do.
export const POOL_SETTING = 'funnel.pool';

export const SELLING_STAGES = [
  { key: 'pool', label: 'People to approach', entered: true },
  { key: 'called', label: 'Bought a call' },
  { key: 'answered', label: 'Answered a quote' },
  { key: 'delivered', label: 'Work handed over' },
];

// Which queue a person is in, derived rather than stored, so there is no second fact about
// somebody's state that can disagree with the first.
//
// `waiting` and `replies` are the two with work in them: a call nobody has read, and a
// client who wrote and is waiting on an answer. A call arrives once; a conversation arrives
// continually, so `replies` is the one that fills up as the work runs.
export const QUEUE_STATES = ['waiting', 'replies', 'active', 'closed'];

export function isQueueState(value) {
  return QUEUE_STATES.includes(value);
}

// A conversation is read a page at a time, newest page first.
//
// Rendering every message it has ever held grows the box without end: it gets taller with
// every reply, the footer walks off the bottom of the screen, and a keyboard or a screen
// reader has no way past it. There is also no way to say where you are in a list like that,
// and no way to come back to the same place twice.
//
// The page number goes in the address on both screens, so a place in a conversation can be
// linked and the back button does what it looks like it does. No page asked for means the
// newest one, which is where somebody opening a conversation expects to land. A number past
// the end is clamped rather than shown as an empty page.
export const MESSAGES_PER_PAGE = 20;

export function pageOf(asked, total, perPage = MESSAGES_PER_PAGE) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const wanted = Number.parseInt(asked, 10);
  if (!Number.isFinite(wanted)) return { page: last, last, perPage };
  return { page: Math.min(Math.max(wanted, 1), last), last, perPage };
}

// How long a blocker may sit before it comes back on its own.
//
// A blocker with no date on it is not a decision to forget somebody, it is "not now". Seven
// days is long enough that a real wait is not interrupted and short enough that nothing is lost
// for a month. A date set by hand beats it in both directions.
export const BLOCKER_RETURNS_AFTER_DAYS = 7;

// The clock the first screen runs on. Twenty-four hours to read a call and have three things to
// say; forty-eight is what the claim page promises, so twenty-four is the point at which the
// promise starts being at risk rather than the point at which it is broken.
export const REVIEW_TARGET_HOURS = 24;
export const REVIEW_PROMISE_HOURS = 48;

// Whether the conversation is open, decided once for both sides of it.
//
// A go opens it. So does a quote: writing somebody a quote is choosing to work with them, which
// is the same choice a go is, and a quote that tells them to say so if they want it changed has
// to leave them somewhere to say it.
//
// This answer lived in two places and they drifted. The client area opened on approved OR
// quoted; the desk's reply form asked only about approved. So somebody quoted after a no-go
// could write in, the desk said a reply was owed, and the same screen said the conversation was
// closed and hid the box to write it in. Both sides read this now, and the desk is told the
// answer rather than working out its own.
export function conversationIsOpen({ approvedAt, quoteCount }) {
  return Boolean(approvedAt) || Number(quoteCount) > 0;
}
