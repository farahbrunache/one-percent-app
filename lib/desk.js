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
  'quote.written': 'Quote written',
  'quote.moved': 'Quote updated',
  'introduction.made': 'Introduced',
  'introduction.recorded': 'Introduction outcome',
  'first-customer': 'First paying customer',
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
export const FUNNEL_STAGES = [
  { key: 'called', label: 'Calls that came back' },
  { key: 'go', label: 'Worth going on with' },
  { key: 'planned', label: 'On a path' },
  { key: 'worked', label: 'Something worked' },
  { key: 'earning', label: 'First paying customer' },
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
