// What a sheet looks like, in one place.
//
// The sheet is the product. It is the thing seven dollars buys, the only thing most people ever
// get, and it is read word for word by somebody who has just spent half an hour explaining their
// situation to a machine. So its shape is not left to whoever is typing at the time.
//
// One file, two readers. The operator presses a button and gets this structure in the box. A
// model, when one is configured, is given the same rules in its prompt. That is the point of
// putting it here rather than in either place: without it the two drift, and the drift shows up
// as a sheet that reads like a different person wrote it.
//
// Nothing here is about what to recommend. That is the work and it is the operator's. This is
// about the reading level, the sentences, and where a link goes.

// The rules, written for both readers. Short enough to sit under a textarea and to go into a
// prompt without burying what the model is actually being asked to do.
export const SHEET_RULES = [
  'Complete sentences and complete thoughts. Never a fragment and never a bare instruction.',
  'Seventh to ninth grade reading level. Short sentences, common words, one idea per sentence.',
  'Three things, numbered. More than three stops being a plan and starts being a list.',
  'Say what to do and why it works for this person, using what they said about themselves.',
  'Bullets under a step when it has parts. Never bullets instead of sentences.',
  'Link what you name. A part of Skills Economy, a page, a guide — write the address out.',
  'No greeting, no sign-off, no pleasantries, no praise. Open on the first thing to do.',
  'Never say whether they were accepted, never rank them, never tell them what they are.',
  'Every number, rate, trade and date comes from what they said. Never invent one.',
];

// The addresses worth naming, so a link in a sheet is right rather than remembered. Skills
// Economy is where the work happens and it costs them nothing, which is why a sheet points
// there rather than at anything paid.
export const SHEET_LINKS = [
  ['Directory', 'https://app.chargingthefuture.com/apps/directory'],
  ['Skills Hunt', 'https://app.chargingthefuture.com/apps/skills-hunt'],
  ['Workforce', 'https://app.chargingthefuture.com/apps/workforce'],
  ['Knowledge Library', 'https://app.chargingthefuture.com/knowledge'],
  ['SkillUp', 'https://app.chargingthefuture.com/apps/skill-up'],
  ['Foundation', 'https://app.chargingthefuture.com/apps/foundation'],
];

// What goes in the box when the operator asks for it. Square brackets are the parts to replace,
// so a sheet sent with one still in it is obvious at a glance rather than subtly wrong.
//
// It is a start, not a form. Delete a line that does not apply, add one that does. What it is
// for is the blank page, and keeping the shape the same from one person to the next.
export const SHEET_TEMPLATE = [
  'Here is what I would do.',
  '',
  '1. [The first thing to do.] [Why it works in your situation, in one or two sentences,',
  'using what you told me.]',
  '   - [Where it happens: https://app.chargingthefuture.com/apps/directory]',
  '',
  '2. [The second thing.] [Why.]',
  '',
  '3. [The third thing.] [Why.]',
  '',
  '[Which one to start with this week, and what it looks like when it is done.]',
].join('\n');

// A sheet still carrying a bracket is a sheet that was not finished. The operator sees this
// before sending rather than the person seeing it afterwards.
export function unfilledSlots(text) {
  return (String(text || '').match(/\[[^\]]*\]/g) || []).length;
}

// A sheet written with an address in it, split into the parts a screen renders.
//
// Pure, and it returns parts rather than elements, so the file stays free of the DOM and the
// server can import it for the prompt. The page turns a part with an href into an anchor.
//
// Trailing punctuation is left out of the address. Somebody writes "go to
// https://app.chargingthefuture.com/apps/directory." and the period belongs to the sentence,
// not to the link -- and a link carrying one lands on a page that does not exist.
const ADDRESS = /https?:\/\/[^\s<>"']+/g;

export function linkParts(text) {
  const body = String(text || '');
  const parts = [];
  let at = 0;
  for (const match of body.matchAll(ADDRESS)) {
    let href = match[0];
    const trimmed = href.replace(/[.,;:!?)\]]+$/, '');
    const dropped = href.slice(trimmed.length);
    href = trimmed;
    if (match.index > at) parts.push({ text: body.slice(at, match.index) });
    parts.push({ text: href, href });
    if (dropped) parts.push({ text: dropped });
    at = match.index + match[0].length;
  }
  if (at < body.length) parts.push({ text: body.slice(at) });
  return parts;
}
