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
  'plan.set': 'Plan set',
  'milestone.added': 'Milestone added',
  'milestone.recorded': 'Outcome recorded',
  note: 'Note',
};

export function isEventKind(value) {
  return Object.prototype.hasOwnProperty.call(EVENT_KINDS, value);
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

// Which queue a person is in, derived rather than stored, so there is no second fact about
// somebody's state that can disagree with the first.
//
// `replies` is the one that fills up once the work is running: somebody wrote and nobody has
// answered. A call arrives once; a conversation arrives continually.
export const QUEUE_STATES = ['waiting', 'replies', 'active', 'closed'];

export function isQueueState(value) {
  return QUEUE_STATES.includes(value);
}
