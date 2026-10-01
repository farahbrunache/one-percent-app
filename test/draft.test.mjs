// The drafting client, against a stubbed model.
//
// Nothing here reaches a GPU or costs anything. What is worth testing is the part that decides
// which model is asked and what the operator is told when the answer does not come: a draft
// that silently does nothing looks exactly like a model that is merely cold.
//
// Run with: npm test

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log('  ok   ' + label);
  else { failures += 1; console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail))); }
}

function configure(settings) {
  for (const slot of ['A', 'B']) {
    for (const part of ['NAME', 'URL', 'KEY']) delete process.env[`DRAFT_MODEL_${slot}_${part}`];
  }
  Object.assign(process.env, settings);
}

const draft = await import('../lib/draft.js');

console.log('which model is offered');

configure({});
check('nothing is offered when no slot is configured', draft.models().length === 0);

let refused = null;
try { draft.resolve(null); } catch (error) { refused = error; }
check('and asking for one says so rather than failing silently',
  refused?.status === 503 && /slots are/.test(refused.message), refused?.message);

configure({
  DRAFT_MODEL_A_NAME: 'Small', DRAFT_MODEL_A_URL: 'https://api.example/v2/aaa', DRAFT_MODEL_A_KEY: 'k1',
});
check('a slot with an address and a key is offered', draft.models().length === 1);
check('and its name is what the setting says', draft.models()[0].name === 'Small');

configure({ DRAFT_MODEL_A_URL: 'https://api.example/v2/aaa' });
check('a slot with an address but no key is not offered', draft.models().length === 0);

console.log('when the chosen one is retired');
// Clearing a slot is how a model is retired, so the chosen one can vanish between one draft
// and the next. Falling back quietly would look like the toggle not working.
configure({
  DRAFT_MODEL_B_NAME: 'Other', DRAFT_MODEL_B_URL: 'https://api.example/v2/bbb', DRAFT_MODEL_B_KEY: 'k2',
});
const fallback = draft.resolve('A');
check('the one still configured is used', fallback.slot === 'B', fallback.slot);
check('and the caller is told it fell back', fallback.fellBack === true);
check('a trailing slash on the address is dropped',
  draft.resolve('B').url === 'https://api.example/v2/bbb');

console.log('the exchange with the queue');

const calls = [];
function stub(handlers) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization });
    const answer = handlers.shift();
    return {
      ok: answer.status === undefined || answer.status < 400,
      status: answer.status || 200,
      text: async () => JSON.stringify(answer.body),
    };
  };
}

configure({
  DRAFT_MODEL_A_NAME: 'Small', DRAFT_MODEL_A_URL: 'https://api.example/v2/aaa', DRAFT_MODEL_A_KEY: 'k1',
});

stub([
  { body: { id: 'job-1' } },
  { body: { status: 'IN_QUEUE' } },
  { body: { status: 'COMPLETED', output: { content: ' a drafted reply ', model: 'llama3.2', prompt_tokens: 900, completion_tokens: 120 } } },
]);
const written = await draft.draft([{ role: 'user', content: 'hello' }], 'A');
check('the reply comes back trimmed', written.content === 'a drafted reply', written.content);
check('the tokens come back with it',
  written.promptTokens === 900 && written.completionTokens === 120, written);
check('the job is submitted and then polled',
  calls[0].url.endsWith('/run') && calls[2].url.endsWith('/status/job-1'), calls.map((c) => c.url));
check('the key is sent as a bearer', calls[0].auth === 'Bearer k1');

stub([{ body: { id: 'job-2' } }, { body: { status: 'FAILED' } }]);
let failed = null;
try { await draft.draft([{ role: 'user', content: 'x' }], 'A'); } catch (error) { failed = error; }
check('a failed job is reported as a failed job',
  failed?.status === 502 && /failed/.test(failed.message), failed?.message);

// A scoped key aimed at an endpoint it does not cover is refused rather than falling back, and
// the refusal is quiet. Naming the endpoint is what separates that from a cold worker.
stub([{ status: 401, body: { error: 'unauthorized' } }]);
let denied = null;
try { await draft.draft([{ role: 'user', content: 'x' }], 'A'); } catch (error) { denied = error; }
check('a refusal names the endpoint and the slot',
  /api\.example\/v2\/aaa/.test(denied?.message || '') && /slot A/.test(denied?.message || ''),
  denied?.message);

// The budget has to be able to run out, or a cold worker holds the operator forever.
let clock = 0;
stub([{ body: { id: 'job-3' } }, { body: { status: 'IN_QUEUE' } }, { body: { status: 'IN_QUEUE' } }]);
let waited = null;
try {
  await draft.draft([{ role: 'user', content: 'x' }], 'A', () => (clock += draft.DRAFT_BUDGET_MS));
} catch (error) { waited = error; }
check('waiting too long gives up and says how long it waited',
  waited?.status === 504 && /seconds/.test(waited.message), waited?.message);

// ---- the shape a sheet is written in ---------------------------------------------------------
//
// One list of rules, two readers: the template the operator starts from and the prompt a model
// is given. They were about to be written twice, which is how a drafted sheet and a typed one
// end up reading like different people.
console.log('');
console.log('the shape a sheet is written in');

const sheet = await import('../lib/sheet.js');

check('the drafting prompt carries the rules the template is built from',
  sheet.SHEET_RULES.every((rule) => draft.SYSTEM_PROMPT.includes(rule)),
  sheet.SHEET_RULES.filter((rule) => !draft.SYSTEM_PROMPT.includes(rule)));

check('the template has three numbered things',
  /^1\./m.test(sheet.SHEET_TEMPLATE) && /^2\./m.test(sheet.SHEET_TEMPLATE)
  && /^3\./m.test(sheet.SHEET_TEMPLATE) && !/^4\./m.test(sheet.SHEET_TEMPLATE));

check('and it names an address rather than describing one',
  /https:\/\/app\.chargingthefuture\.com\//.test(sheet.SHEET_TEMPLATE));

check('every link in the list is an address', sheet.SHEET_LINKS.every(
  ([name, href]) => name && /^https:\/\/app\.chargingthefuture\.com\/\S+$/.test(href)),
  sheet.SHEET_LINKS);

// The guard on sending. A bracket left in is the template showing through to somebody who
// reads this word for word.
check('an untouched template is all unfilled',
  sheet.unfilledSlots(sheet.SHEET_TEMPLATE) > 0, sheet.unfilledSlots(sheet.SHEET_TEMPLATE));
check('a finished sheet has none',
  sheet.unfilledSlots('Here is what I would do.\n\n1. Ask for a rate per job.') === 0);
check('one left behind is counted',
  sheet.unfilledSlots('1. Ask for a rate per job.\n2. [The second thing.]') === 1);
check('nothing at all counts as nothing',
  sheet.unfilledSlots(null) === 0 && sheet.unfilledSlots('') === 0);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
