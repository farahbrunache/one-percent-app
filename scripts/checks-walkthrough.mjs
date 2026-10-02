// The numbers in WALKTHROUGH.md, held to the code that sets them.
//
// The other walkthrough check only asks whether a screen or an action is named. A line can be
// named and wrong: it said fifteen a page, the code moved to twenty, and nothing noticed. The
// numbers are the part of a description that can be checked, so each one here is read out of
// the line of code that sets it and looked for, written the way the walkthrough says it.
//
// Change a number in the code and this fails until the sentence that describes it says the new
// one. Add a number to the walkthrough and it belongs in this list.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty'];
const TENS = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty' };

// 25 is "twenty-five", 15 is "fifteen". Only as far as the walkthrough needs.
function inWords(n) {
  if (n <= 20) return WORDS[n];
  const tens = Math.floor(n / 10) * 10;
  return n % 10 ? `${TENS[tens]}-${WORDS[n % 10]}` : TENS[tens];
}

// Each fact: the file, a pattern whose first group is the number (plain arithmetic allowed, as
// in 35 * 60), and how the walkthrough writes it.
const FACTS = [
  ['the price', 'lib/orders.js', /SESSION_PRICE_CENTS = ([\d_ *]+);/, (n) => `$${(n / 100).toFixed(2)}`],
  ['the reference length', 'lib/orders.js', /REFERENCE_LENGTH = ([\d_ *]+);/, (n) => `a ${n}-character reference`],
  ['starts per window', 'lib/orders.js', /MAX_SESSION_STARTS = ([\d_ *]+);/, (n) => `Up to ${n} starts in`],
  ['the starts window', 'lib/orders.js', /SESSION_WINDOW_HOURS = ([\d_ *]+);/, (n) => `starts in ${n} hours`],
  ['the session budget', 'lib/orders.js', /SESSION_BUDGET_SECONDS = ([\d_ *]+);/, (n) => `A ${n / 60}-minute budget`],
  ['minutes handed back', 'lib/orders.js', /ABANDON_WITHIN_SECONDS = ([\d_ *]+);/, (n) => `within ${inWords(n / 60)} minutes of starting`],
  ['a start that stops counting', 'lib/orders.js', /UNREPORTED_AFTER_SECONDS = ([\d_ *]+);/, (n) => `stops counting after ${n / 60} minutes`],
  ['purchases an hour', 'api/submit.js', /underLimit\('submit', callerKey\(req\), (\d+), 3600\)/, (n) => `${n} purchases an hour`],
  ['recoveries an hour', 'api/recover.js', /underLimit\('recover', callerKey\(req\), (\d+), 3600\)/, (n) => `${n} recoveries an hour`],
  ['the smallest gift card', 'api/submit.js', /amount < (\d+) \|\|/, (n) => `${n} to`],
  ['the largest gift card', 'api/submit.js', /amount > (\d+)\)/, (n) => `to ${n} dollars`],
  ['the 24-hour line', 'lib/desk.js', /REVIEW_TARGET_HOURS = ([\d_ *]+);/, (n) => `past ${n} hours`],
  ['the promise', 'lib/desk.js', /REVIEW_PROMISE_HOURS = ([\d_ *]+);/, (n) => `the ${n} the claim page promises`],
  ['a block with no date', 'lib/desk.js', /BLOCKER_RETURNS_AFTER_DAYS = ([\d_ *]+);/, (n) => `after ${n} days if the block has none`],
  ['open quotes', 'lib/desk.js', /MAX_OPEN_QUOTES = ([\d_ *]+);/, (n) => `At most ${inWords(n)} outstanding`],
  ['conversation page', 'lib/desk.js', /MESSAGES_PER_PAGE = ([\d_ *]+);/, (n) => `paged ${inWords(n)} at a time`],
  ['each Today list', 'lib/desk-today.js', /^\s+limit (\d+)$/m, (n) => `takes its oldest ${n}`],
  ['Today page', 'desk.html', /const PER_PAGE = (\d+);/, (n) => `${inWords(n)} cards a page`],
  ['Everybody page', 'api/desk.js', /const PER_PAGE = (\d+);/, (n) => `${inWords(n)} a page, Newer and Older`],
  ['the sheet', 'api/desk.js', /String\(body\.body \|\| ''\)\.trim\(\)\.slice\(0, (\d+)\)/, (n) => `up to ${n} characters`],
  ['payments history page', 'api/payments.js', /const PER_PAGE = (\d+);/, (n) => `${inWords(n)} a page with Newer`],
  ['records per sweep', 'api/sweep.js', /const PER_RUN = (\d+);/, (n) => `${n} a run`],
  ['the underwater window', 'lib/costs.js', /VERDICT_DAYS = ([\d_ *]+);/, (n) => `over ${n} days`],
  ['drafts a day', 'lib/draft.js', /DRAFTS_PER_ORDER = ([\d_ *]+);/, (n) => `${n} drafts a day`],
  ['the weeks', 'lib/costs.js', /WEEKS_BACK = ([\d_ *]+);/, (n) => `over ${inWords(n)} weeks`],
];

function value(expression) {
  return expression.replace(/_/g, '').split('*').reduce((total, part) => total * Number(part.trim()), 1);
}

export function walkthroughNumbersHold({ ROOT, read, fail, join }) {
  // Lines wrap anywhere in the file, so a phrase is looked for with its spacing flattened.
  const walkthrough = read(join(ROOT, 'WALKTHROUGH.md')).toLowerCase().replace(/\s+/g, ' ');
  for (const [what, file, pattern, said] of FACTS) {
    const found = read(join(ROOT, file)).match(pattern);
    if (!found) {
      fail('walkthrough', `${file} no longer sets ${what} the way this check reads it. Update FACTS in scripts/checks-walkthrough.mjs.`);
      continue;
    }
    const expected = said(value(found[1]));
    if (!walkthrough.includes(expected.toLowerCase())) {
      fail('walkthrough', `${file} sets ${what} to ${value(found[1])}, and WALKTHROUGH.md doesn't say "${expected}". Fix the sentence.`);
    }
  }
}
