// The checks CI runs before anything ships.
//
// This repository is small enough to read end to end, so these are not the elaborate gates a
// large codebase needs. They are the three things a careful reader still misses, each of which
// has already gone wrong here once:
//
//   1. A file nobody checked, because the list of files was typed by hand.
//   2. A setting the code reads that the deploy does not write, which takes the site down.
//   3. An endpoint nobody can reach, shipped and left sitting there looking live.
//
// Run with: npm run check

import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { namesResolve } from './checks-names.mjs';
import { wordsAreAllowed } from './checks-words.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function fail(check, message) {
  problems.push(`${check}: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(ROOT);
const read = (path) => readFileSync(path, 'utf8');

// ---- 1. every file parses -----------------------------------------------------------------
//
// Found by walking rather than by a list. The list this replaced had two files missing from it,
// which meant everything in them shipped unchecked — and nothing about a hand-typed list ever
// says when it has fallen behind.

const scripts = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    fail('syntax', `${file.slice(ROOT.length + 1)} does not parse.\n${error.stderr}`);
  }
}

// Every page runs a module script inline, and nothing was parsing those. A copy pass put an
// apostrophe inside a single-quoted string on three pages at once -- "it's how you get back"
// -- and each one is a page that loads, renders nothing, and reports the error only to a
// browser error log nobody has open on a phone. Node parses the script body on its own, so the
// body is written out and checked the same way a .js file is.
const pages = files.filter((f) => f.endsWith('.html'));
for (const file of pages) {
  const body = read(file).match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!body) continue;
  const scratch = join(tmpdir(), `check-${basename(file)}.mjs`);
  writeFileSync(scratch, body[1]);
  try {
    execFileSync(process.execPath, ['--check', scratch], { stdio: 'pipe' });
  } catch (error) {
    fail('syntax', `${file.slice(ROOT.length + 1)} has a script that does not parse.\n${error.stderr}`);
  } finally {
    rmSync(scratch, { force: true });
  }
}

// ---- nothing gets too big to throw away ------------------------------------------------------
//
// The point of keeping this modular is that a piece can be deleted or replaced without reading
// the rest of it. A file nobody wants to open is a file nobody deletes, and it turns into the
// debt.
//
// A ceiling rather than a target. Something approaching one is usually several things sharing a
// file, and the fix is to take the smallest one out. Raising a limit is a decision somebody
// makes on purpose and says why, in the same change -- never to turn a red check green.
const SIZE_LIMITS = [
  { ext: '.html', lines: 900, what: 'a page' },
  { ext: '.js', lines: 700, what: 'an endpoint or a library' },
  { ext: '.mjs', lines: 700, what: 'an endpoint or a library' },
];

// Files already over the limit the day it was added. The list may only ever shrink, so the gate
// fails three ways: a file over the limit that is not listed, a listed file that has grown past
// its recorded number, and a listed file that no longer needs listing.
const allowed = JSON.parse(read(`${ROOT}/scripts/size-allowlist.json`)).files;
const usedAllowance = new Set();

for (const file of files) {
  const limit = SIZE_LIMITS.find((l) => file.endsWith(l.ext));
  if (!limit) continue;
  const name = file.slice(ROOT.length + 1);
  const lines = read(file).split('\n').length;
  const known = allowed[name];

  if (lines <= limit.lines) {
    if (known) {
      fail('size', `${name} is ${lines} lines and under the limit now. Remove it from `
        + 'scripts/size-allowlist.json -- that list only shrinks.');
    }
    continue;
  }

  if (!known) {
    fail(
      'size',
      `${name} is ${lines} lines and the limit for ${limit.what} is ${limit.lines}. `
        + 'Take the smallest thing in it out into its own file.',
    );
    continue;
  }

  usedAllowance.add(name);
  if (lines > known.lines) {
    fail(
      'size',
      `${name} is ${lines} lines and scripts/size-allowlist.json allows it ${known.lines}. `
        + 'It is already over the limit and it is growing. Split it rather than raising the '
        + 'number.',
    );
  }
}

for (const name of Object.keys(allowed)) {
  if (!usedAllowance.has(name) && !files.some((f) => f.endsWith(`/${name}`))) {
    fail('size', `scripts/size-allowlist.json lists ${name} and there is no such file. `
      + 'Remove the entry.');
  }
}

// ---- 2. the settings the code reads are the settings the deploy writes ---------------------
//
// Writing the settings onto the service replaces all of them at once, so one name missing from
// the deploy list is not a missing feature — it is a site that boots without a database.
//
// Settings are read three ways here: `process.env.NAME`, `process.env[name]` where the name is a
// constant, and `process.env[spec.envKey]` where it sits in a data structure. So the code side
// counts any capitalised name it mentions at all, and the check runs in both directions.

const RUNTIME_ONLY = new Set(['NODE_ENV', 'PORT']);

const source = scripts
  .filter((f) => !f.includes('/test/') && !f.includes('/scripts/'))
  .map(read)
  .join('\n');

const readDirectly = new Set(
  [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
);
const mentioned = new Set([
  ...readDirectly,
  ...[...source.matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)].map((m) => m[1]),
]);

const deployKeys = new Set(
  [...read(join(ROOT, '.github/scripts/deploy.sh')).matchAll(/^\s{2}([A-Z][A-Z0-9_]*)$/gm)]
    .map((m) => m[1]),
);
const renderKeys = new Set(
  [...read(join(ROOT, 'render.yaml')).matchAll(/^\s*-\s*key:\s*([A-Z][A-Z0-9_]*)/gm)]
    .map((m) => m[1]),
);

for (const name of readDirectly) {
  if (RUNTIME_ONLY.has(name)) continue;
  if (!deployKeys.has(name)) fail('settings', `${name} is read in the code but is not in KEYS in .github/scripts/deploy.sh.`);
}
for (const name of deployKeys) {
  if (!renderKeys.has(name)) fail('settings', `${name} is in the deploy list but not in render.yaml.`);
  if (!mentioned.has(name)) fail('settings', `${name} is deployed but nothing in the code reads it.`);
}
for (const name of renderKeys) {
  if (!deployKeys.has(name)) fail('settings', `${name} is in render.yaml but not in KEYS in .github/scripts/deploy.sh.`);
}

// ---- 3. no endpoint action is unreachable --------------------------------------------------
//
// An action with no caller is not a feature waiting to be wired up. It is dead weight that looks
// live, and one of them sat in this repository unreachable from anywhere until somebody read the
// file for another reason.

// A page is no longer one file. The desk imports its record screen, which imports the work
// module, so a call can sit three files away from the page that owns it. Both checks below
// read a page as the page plus everything it imports, resolved against the repository root
// the way a browser resolves them against the site root.
//
// Without this the split alone turned six live actions into reported dead weight -- the check
// was reading markup and finding no JavaScript behind it.
const importsOf = (text) => [...text.matchAll(/from '\/([\w.-]+\.js)'/g)].map((m) => m[1]);

function bundle(page, seen = new Set()) {
  const path = page.startsWith(ROOT) ? page : join(ROOT, page);
  if (seen.has(path)) return '';
  seen.add(path);
  if (!files.includes(path)) return '';
  const text = read(path);
  return [text, ...importsOf(text).map((name) => bundle(name, seen))].join('\n');
}

// A page, a test, or a scheduled workflow. The last one counts: a job on a clock is a caller
// like any other, and leaving it out would report a live endpoint as dead weight.
const callers = files
  .filter((f) => f.endsWith('.html') || f.includes('/test/') || f.includes('/workflows/'))
  .map((f) => (f.endsWith('.html') ? bundle(f) : read(f)))
  .join('\n');

// What each endpoint answers to, read once and used by this check and the one after it.
const answers = new Map();
for (const file of files.filter((f) => f.includes('/api/') && f.endsWith('.js'))) {
  const text = read(file);
  const names = new Set([...text.matchAll(/action === '([a-z][a-z-]*)'/g)].map((m) => m[1]));

  // The desk keeps its actions in a map rather than a chain of comparisons. Its keys come in
  // three shapes and reading only one of them is how four live actions read as absent: quoted
  // on their own line ('call-record': callRecord), shorthand (decide,), and several to a line
  // inside the method's braces ({ queue, person, funnel }).
  const table = text.match(/const ACTIONS = \{[\s\S]*?\n\};/);
  if (table) {
    // A key, whichever of the three shapes it takes: quoted ('call-record':), shorthand
    // (decide,) or several to a line ({ queue, person, funnel }). What follows a colon is a
    // handler's name rather than an action's, so the lookbehind leaves it alone.
    for (const m of table[0].matchAll(/(?:[{,]\s*)'?([a-z][a-z-]*)'?\s*(?=[,:}])/g)) {
      names.add(m[1]);
    }
  }
  answers.set(file.replace(/^.*\/api\//, '').replace(/\.js$/, ''), names);

  for (const name of names) {
    const called = callers.includes(`'${name}'`)
      || callers.includes(`action=${name}`)
      || new RegExp(`(?<![.\\w$])(?:get|post)\\(['"\`]${name}[^a-z-]`).test(callers);
    if (!called) {
      fail('unreachable', `${file.slice(ROOT.length + 1)} accepts action "${name}" and nothing calls it.`);
    }
  }
}

// ---- a page asking for an action no endpoint answers ----------------------------------------
//
// The opposite of the check above, and it had to be written separately because the two miss
// different things. That one asks whether every registered action has a caller. This asks
// whether every call reaches a registered action.
//
// The desk's "Everything the voice service has" button asked for `call-record`. The handler
// was written, commented and never put in the actions table, so it was not an action at all --
// invisible to the check above, which only reads the table. Pressing the button returned the
// list of actions that do exist, which says nothing to whoever pressed it, and the button had
// never worked once.
//
// A page's calls are its inline `action=` strings plus its get() and post() helpers, whose
// first argument is the action name. The endpoints a page may be talking to are the /api/
// addresses it mentions, so a name has to be answered by one of those.
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const text = bundle(file);
  const talksTo = [...text.matchAll(/\/api\/([a-z][a-z-]*)/g)].map((m) => m[1]);
  if (!talksTo.length) continue;

  const asked = new Set([
    ...[...text.matchAll(/action=([a-z][a-z-]*)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?<![.\w$])(?:get|post)\(['"`]([a-z][a-z-]*)/g)].map((m) => m[1]),
  ]);

  for (const name of asked) {
    if (talksTo.some((ep) => answers.get(ep)?.has(name))) continue;
    fail(
      'unanswered',
      `${file.slice(ROOT.length + 1)} asks for action "${name}" and no endpoint it talks to `
        + `(${[...new Set(talksTo)].join(', ')}) answers it.`,
    );
  }
}

// ---- the desk reading a field the desk endpoint does not send -------------------------------
//
// The record said "Not decided yet" on a record with a no-go against it, because the page
// read `person.assessment` and the payload had carried `person.decision` since the rename.
// Nothing failed. A missing property is `undefined`, the comparison was false, and the page
// told the owner the opposite of what the row said two panels above.
//
// So every `person.<name>` the desk reads has to be a key the person payload sends. The
// payload is one object literal, and its top-level keys are the contract between the two
// halves of that screen.
{
  const desk = read(`${ROOT}/api/desk.js`);

  // Both payloads, because the page calls a row in the queue `person` too -- one object
  // per person either way, and a field named in neither is named nowhere.
  const sent = new Set();
  for (const name of ['queue', 'person']) {
    const start = desk.indexOf(`async function ${name}(`);
    if (start < 0) continue;
    const next = desk.indexOf('\nasync function', start + 10);
    const body = desk.slice(start, next < 0 ? undefined : next);
    for (const m of body.matchAll(/\b([a-zA-Z]\w*):/g)) sent.add(m[1]);
    // Shorthand too -- `messageCount,` on its own line is a key exactly as much as
    // `messageCount: n` is, and reading only the second form reported a field that was
    // being sent as one that was not. A check that cries wolf is a check people stop
    // reading. This counts a few names that are not payload keys, which costs nothing:
    // the worst it can do is stay quiet about a field, which is where it started.
    for (const m of body.matchAll(/^\s*([a-zA-Z]\w*),\s*$/gm)) sent.add(m[1]);
  }

  if (sent.size < 10) {
    fail('payload', 'scripts/checks.mjs could not read the desk payloads, so its fields are unchecked.');
  } else {
    const page = read(`${ROOT}/desk.html`);
    const seen = new Set([...page.matchAll(/\bperson\.([a-zA-Z]\w*)/g)].map((m) => m[1]));
    for (const field of seen) {
      if (!sent.has(field)) {
        fail('payload', `desk.html reads person.${field} and the desk endpoint sends no such field.`);
      }
    }
  }
}

// ---- a page walking into an endpoint that will not answer -----------------------------------
//
// Sign out is a POST, and the desk navigated to it. A browser following a link sends GET, so
// the endpoint refused and the press landed on a page of JSON listing which actions exist.
// It is POST-only on purpose -- anything that logs somebody out by being visited can be
// triggered by a link somebody else wrote -- so the page was wrong, not the endpoint.
//
// This reads every navigation in the pages: `location.href =`, `location.assign`,
// `location.replace`, and a plain href in the markup. Anything pointing at `/api/...` with an
// action has to be an action that file answers on GET.
{
  const getActions = new Map();
  for (const file of files.filter((f) => f.includes('/api/') && f.endsWith('.js'))) {
    const text = read(file);
    const name = file.slice(file.lastIndexOf('/') + 1, -3);
    const allowed = new Set(
      [...text.matchAll(/req\.method === 'GET' && action === '([a-z][a-z-]*)'/g)].map((m) => m[1]),
    );
    // The desk keeps its actions in a map with a key per method.
    const table = text.match(/GET:\s*\{([^}]*)\}/);
    if (table) {
      for (const m of table[1].matchAll(/'?([a-z][a-zA-Z-]*)'?/g)) allowed.add(m[1]);
    }
    getActions.set(name, allowed);
  }

  const navigation = /(?:location\.(?:href\s*=|assign\(|replace\()|href=)\s*['"`]\/api\/([a-z-]+)\?([^'"`]*)['"`]/g;
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    for (const m of read(file).matchAll(navigation)) {
      const endpoint = m[1];
      const action = (m[2].match(/action=([a-zA-Z-]+)/) || [])[1];
      if (!action) continue;
      const allowed = getActions.get(endpoint);
      if (!allowed) continue;
      if (!allowed.has(action)) {
        fail('navigation', `${file.slice(ROOT.length + 1)} navigates to /api/${endpoint}?action=${action}, and that endpoint does not answer ${action} on GET.`);
      }
    }
  }
}

// ---- a field small enough for Safari to zoom into -------------------------------------------
//
// Safari on iOS zooms the page when a form field with a font under 16px is focused, and the
// zoom sticks: the page stays magnified and clipped, and every tap into a field does it
// again. The desk shipped that way, because its fields were sized to 13px to match the rest
// of that screen.
//
// The stylesheet pins every control to 16px with `!important`. This is here so nobody
// quietly writes a smaller one underneath it and finds out from a phone.
{
  const css = read(`${ROOT}/style.css`);
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1];
    if (!/\b(input|textarea|select)\b/.test(selector)) continue;
    const size = rule[2].match(/font-size:\s*([\d.]+)(px|rem)/);
    if (!size) continue;
    const px = size[2] === 'rem' ? Number(size[1]) * 16 : Number(size[1]);
    if (px < 16) {
      fail('zoom', `style.css gives "${selector.trim()}" a font-size of ${px}px. Under 16px, Safari zooms the page when the field is tapped.`);
    }
  }
}

// ---- renaming a column onto one that is already there ---------------------------------------
//
// `assessed_at` was renamed to `decided_at`, and `decided_at` was already on the orders
// table meaning the moment the payment was confirmed or rejected. Postgres refused it on
// every cold start and the site went down. On a database where the rename had never run it
// would have been quieter and worse: the desk would have shown the payment's timestamp as
// the moment somebody's call was decided, with nothing to say anything was wrong.
//
// So a rename target must not be a column some `create table` in the schema already
// declares. The `add column if not exists` that follows a rename is the pair of it and is
// fine; a column in a table body is a different thing wearing the same name.
{
  const schema = read(`${ROOT}/lib/db.js`);
  const declared = new Set();
  for (const table of schema.matchAll(/create table if not exists \w+ \(([\s\S]*?)\n\s*\)/g)) {
    for (const line of table[1].split('\n')) {
      const name = line.trim().split(/\s+/)[0];
      if (/^\w+$/.test(name)) declared.add(name);
    }
  }
  for (const m of schema.matchAll(/rename column (\w+) to (\w+)/g)) {
    if (declared.has(m[2])) {
      fail('collision', `lib/db.js renames ${m[1]} to ${m[2]}, and ${m[2]} is already a column a table declares.`);
    }
  }
}

// ---- calling or reading something that is not there -----------------------------------------
//
// The largest check here and its own file now, because this one kept growing: a name called and
// never declared, a name read and never imported, a name imported a module does not export, and
// the scrubber that has to know which of those is code and which is a comment.
namesResolve({ ROOT, files, read, fail });

// ---- every module a page asks for is one the server hands out ---------------------------------
//
// A browser import is an address, not a file path. server.js decides which address serves which
// file, so a module can exist, parse, be imported correctly and still 404 -- and when it does,
// the import fails, the entire inline script never runs, and the page renders nothing with no
// error anywhere a phone can see.
//
// That happened the moment a module was added under lib/ and served at a root address: the local
// check was reading files off disk, so it passed, and only the real routing table says what a
// browser can actually fetch.
const served = new Set(
  [...read(join(ROOT, 'server.js')).matchAll(/'(\/[\w.-]*)':\s*\[/g)].map((m) => m[1]),
);

for (const file of files.filter((f) => f.endsWith('.html') || /^[^/]*\.js$/.test(f.slice(ROOT.length + 1)))) {
  const text = read(file);
  for (const m of text.matchAll(/from\s+'(\/[\w.-]+\.js)'/g)) {
    if (served.has(m[1])) continue;
    fail(
      'unserved',
      `${file.slice(ROOT.length + 1)} imports ${m[1]} and server.js does not serve that address. `
        + 'The import 404s, the script never runs, and the page renders nothing.',
    );
  }
}

// ---- a listener attached on every draw -------------------------------------------------------
//
// The desk draws itself again after every write, in place, so the reader keeps their position.
// Anything in the page's own markup survives that draw, so attaching to one of those with
// `addEventListener` means two listeners after the first write and three after the second: one
// press writes three times, and on this desk a write is a status moving or money being recorded.
//
// `once` in desk-after.js attaches at most one listener per element and event, and rows built
// during a draw are new elements so it behaves no differently for them. Every listener in a module
// the record screen draws goes through it, rather than anybody having to work out which kind of
// element they are looking at.
//
// desk.html is exempt: its own listeners are attached once at load, outside any draw.
const DRAWN_AGAIN = /^desk-(record|work|contacts|actions|projects|payments|recap)\.js$/;

for (const file of files.filter((f) => DRAWN_AGAIN.test(f.slice(ROOT.length + 1)))) {
  const name = file.slice(ROOT.length + 1);
  for (const [index, line] of read(file).split('\n').entries()) {
    if (!/\.addEventListener\(/.test(line)) continue;
    fail(
      'listener on every draw',
      `${name}:${index + 1} calls addEventListener. This module is drawn again after every write, `
        + 'so that attaches a second listener and one press writes twice. Use once() from '
        + 'desk-after.js.',
    );
  }
}

// ---- a test nobody runs ----------------------------------------------------------------------
//
// `npm test` is a hand-typed chain of filenames, so a test written and never added to it passes
// forever by never running. That happened: the payments test shipped alongside the screen it
// covers and was not in the chain, so the screen that records what a quote was paid had no cover
// at all while looking like it did.
const chain = JSON.parse(read(join(ROOT, 'package.json'))).scripts.test || '';
for (const file of files.filter((f) => f.endsWith('.test.mjs'))) {
  const name = file.slice(ROOT.length + 1);
  if (chain.includes(name)) continue;
  fail(
    'unrun test',
    `${name} is never run — it is not in the test chain in package.json, so it passes by sitting `
      + 'there. Add it.',
  );
}

wordsAreAllowed({ ROOT, files, read, fail });

// ---- what happened --------------------------------------------------------------------------

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`checked ${scripts.length + pages.length} files, ${deployKeys.size} settings, `
  + 'and every endpoint action.');
