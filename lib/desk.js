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
export const ASSESSMENTS = ['go', 'no-go'];

export function isAssessment(value) {
  return ASSESSMENTS.includes(value);
}

// What a line on the record can be. The detail beside it is written by whoever acted.
export const EVENT_KINDS = {
  assessed: 'Assessed',
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
export const QUOTE_STATUSES = ['offered', 'agreed', 'paid', 'withdrawn'];

export function isQuoteStatus(value) {
  return QUOTE_STATUSES.includes(value);
}

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
// `replies` is the one that fills up once the work is running: somebody wrote and nobody has
// answered. A call arrives once; a conversation arrives continually.
export const QUEUE_STATES = ['waiting', 'replies', 'active', 'closed'];

export function isQueueState(value) {
  return QUEUE_STATES.includes(value);
}
