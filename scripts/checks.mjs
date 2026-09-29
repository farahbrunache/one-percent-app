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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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

// A page, a test, or a scheduled workflow. The last one counts: a job on a clock is a caller
// like any other, and leaving it out would report a live endpoint as dead weight.
const callers = files
  .filter((f) => f.endsWith('.html') || f.includes('/test/') || f.includes('/workflows/'))
  .map(read)
  .join('\n');

for (const file of files.filter((f) => f.includes('/api/') && f.endsWith('.js'))) {
  const text = read(file);
  const names = new Set([...text.matchAll(/action === '([a-z][a-z-]*)'/g)].map((m) => m[1]));

  // The desk keeps its actions in a map rather than a chain of comparisons.
  const table = text.match(/const ACTIONS = \{[\s\S]*?\n\};/);
  if (table) {
    for (const m of table[0].matchAll(/^\s+'?([a-z][a-z-]*)'?:/gm)) {
      if (m[1] !== 'GET' && m[1] !== 'POST') names.add(m[1]);
    }
  }

  for (const name of names) {
    if (!callers.includes(`'${name}'`) && !callers.includes(`action=${name}`)) {
      fail('unreachable', `${file.slice(ROOT.length + 1)} accepts action "${name}" and nothing calls it.`);
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

// ---- calling something that is not there ----------------------------------------------------
//
// Twice in one day the trunk ended up calling a function no file defined, because a change
// that used it merged while the change that declared it sat in a pull request. `keepRecord`
// was one and `openTheConversation` was the other. Both would have thrown the moment somebody
// pressed the button, and nothing caught either: the request tests only reach the signed-out
// refusal, so no handler body ever runs, and `node --check` reads syntax rather than meaning.
//
// This reads every module under `api/` and `lib/` and collects two sets: the bare names that
// are called, and the names the file declares or imports. Anything called and not declared is
// a reference to nothing.
//
// Bare calls only -- `foo(` and never `thing.foo(` -- because a method belongs to whatever
// object it is on and this file knows nothing about that. That narrowness is deliberate: the
// failure it is for is exactly a bare call to a name that used to be imported.
const GLOBALS = new Set([
  'require', 'fetch', 'structuredClone', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'atob', 'btoa', 'encodeURIComponent',
  'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set',
  'Date', 'RegExp', 'JSON', 'Math', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'Buffer', 'process', 'console', 'if', 'for', 'while', 'switch', 'catch', 'return',
  'typeof', 'await', 'function', 'super', 'this', 'async', 'constructor', 'else', 'do',
  'new', 'delete', 'void', 'in', 'of', 'yield', 'throw', 'case',
]);

for (const file of files.filter((f) => /\/(api|lib)\//.test(f) && f.endsWith('.js'))) {
  const text = read(file);

  const declared = new Set(GLOBALS);
  // import { a, b as c } from '...'  and  import x from '...'
  for (const m of text.matchAll(/import\s+(?:(\w+)\s*,\s*)?\{([^}]*)\}\s+from/g)) {
    if (m[1]) declared.add(m[1]);
    for (const part of m[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) declared.add(name);
    }
  }
  for (const m of text.matchAll(/import\s+(\w+)\s+from/g)) declared.add(m[1]);
  for (const m of text.matchAll(/(?:^|\s)(?:async\s+)?function\s+(\w+)/g)) declared.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)) declared.add(m[1]);
  // Destructured bindings and parameters, taken loosely -- a name bound anywhere counts.
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(':').pop().trim();
      if (name) declared.add(name);
    }
  }
  for (const m of text.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/[={].*$/, '').trim();
      if (/^\w+$/.test(name)) declared.add(name);
    }
  }
  for (const m of text.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/[={].*$/, '').trim();
      if (/^\w+$/.test(name)) declared.add(name);
    }
  }

  const withoutStrings = text
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of withoutStrings.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (!declared.has(name)) {
      fail('missing', `${file.slice(ROOT.length + 1)} calls ${name}() and nothing here declares it.`);
    }
  }
}

// ---- what happened --------------------------------------------------------------------------

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`checked ${scripts.length} files, ${deployKeys.size} settings, and every endpoint action.`);
