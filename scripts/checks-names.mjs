// Every name a file uses resolves to something.
//
// Four failures, one subject. A name called and never declared. A name read and never imported.
// A name imported from a module that does not export it. And the scrubber all three depend on,
// which has to know which part of a file is code and which is a comment or a string.
//
// Its own file because it is the largest check in the set and it kept growing, and because the
// scrubber below is worth reading on its own: it was five chained replaces that quietly ate real
// code, and two live calls hid behind it.

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
//
// It reads pages as well as modules now, and it should have from the start. Splitting desk.html
// into modules left the queue calling owed(person) after owed moved into the record module
// unexported. Nothing caught it: the page parsed, it loaded, and the page has <div id="owed"> --
// a browser gives every element with an id a global of that name, so the call resolved to the
// div and threw only when somebody opened the queue. The desk shipped with its main list broken,
// and this check was already written; it just was not looking at pages.
const GLOBALS = new Set([
  'require', 'fetch', 'structuredClone', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'atob', 'btoa', 'encodeURIComponent',
  'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set',
  'Date', 'RegExp', 'JSON', 'Math', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'Buffer', 'process', 'console', 'if', 'for', 'while', 'switch', 'catch', 'return',
  'typeof', 'await', 'function', 'super', 'this', 'async', 'constructor', 'else', 'do',
  'new', 'delete', 'void', 'in', 'of', 'yield', 'throw', 'case',
  // `import()` is the language, not a function anybody declares. It went unnoticed until a block
  // of SQL moved out of lib/db.js: the backtick stripping above pairs template literals, and the
  // dynamic import had been sitting inside a pair by accident of where the backticks fell. Moving
  // the block changed the pairing and the call came into view, reading as a reference to nothing.
  'import',
]);

// Code with every string, template and comment blanked, and nothing else touched.
//
// This was five chained replaces and it was quietly eating real code. Strings were blanked
// before comments, so an apostrophe inside a `// person's own record` opened a string that ran
// to the next apostrophe several lines later and took everything between with it. Reordering
// does not fix it either -- blanking comments first eats the rest of any line holding a `//`
// inside a string, which every URL is.
//
// Two live calls were invisible because of it: a dynamic `import()` in lib/db.js, and a
// `quoteIsWaitingOnYou()` that was never imported and threw the moment anybody opened the record
// of somebody who had been quoted. The check was written for exactly that and could not see it.
//
// So this walks the text once and knows which of the five states it is in. Interpolations inside
// a template are kept, because they are code: `${owed(person)}` is a call like any other.
function scrub(source) {
  let out = '';
  let i = 0;
  const depth = [];
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += `${quote}${quote}`;
      continue;
    }
    if (c === '`') {
      i += 1;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') { i += 2; continue; }
        // An interpolation is code and is kept. Braces nest, so count them.
        if (source[i] === '$' && source[i + 1] === '{') {
          let open = 1;
          i += 2;
          const from = i;
          while (i < source.length && open > 0) {
            if (source[i] === '{') open += 1;
            else if (source[i] === '}') open -= 1;
            if (open > 0) i += 1;
          }
          out += ` ${scrub(source.slice(from, i))} `;
          i += 1;
          continue;
        }
        i += 1;
      }
      i += 1;
      out += '``';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function namesResolve({ ROOT, files, read, fail }) {
  const callSites = [
    ...files
      .filter((f) => /\/(api|lib)\//.test(f) && f.endsWith('.js'))
      .map((f) => ({ where: f.slice(ROOT.length + 1), text: read(f) })),
    // The page modules at the root, which is where every one of these has actually broken: the
    // desk's screens were split into eight files there and none of them was ever scanned. A
    // browser rejects an entire module over one missing name and renders nothing, so this is the
    // half of the codebase where the failure is loudest and it was the half nobody was reading.
    ...files
      .filter((f) => /^[^/]+\.js$/.test(f.slice(ROOT.length + 1)) && !f.endsWith('server.js'))
      .map((f) => ({ where: f.slice(ROOT.length + 1), text: read(f) })),
    // A page's inline script, which is the only script a page has that a module system does not
    // already fail loudly for. A module calling something it never imported dies at load on every
    // page that uses it; an inline script calling one dies at the call, on one screen.
    ...files
      .filter((f) => f.endsWith('.html'))
      .map((f) => {
        const page = read(f);
        const inline = (page.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1];
        return inline ? { where: `${f.slice(ROOT.length + 1)} (its inline script)`, text: inline, page } : null;
      })
      .filter(Boolean),
  ];

  for (const { where, text, page } of callSites) {

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
    // `for (const x of ...)` and `for (const x in ...)`, which bind without an `=` and were being
    // read as references to nothing. Three loop variables shared a name with an export next door
    // and every one of them was reported as a missing import.
    for (const m of text.matchAll(/for\s*\(\s*(?:const|let|var)\s+(\w+)\s+(?:of|in)\s/g)) {
      declared.add(m[1]);
    }
    // A single arrow parameter, with or without its parentheses: `rows.map(call => …)` and
    // `rows.some((call) => …)`. The wider params pattern above misses the parenthesised one when
    // an earlier bracket on the same line eats the match.
    for (const m of text.matchAll(/(?:^|[^\w$.])\(?(\w+)\)?\s*=>/g)) declared.add(m[1]);
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

    const withoutStrings = scrub(text);

    for (const m of withoutStrings.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (!declared.has(name)) {
        fail('missing', `${where} calls ${name}() and nothing here declares it.`
          + (page && page.includes(`id="${name}"`)
            ? ` The page has an element with id="${name}", so the call resolves to that element`
              + ' and throws when the screen runs rather than when the page loads.'
            : ''));
      }
    }

    // The other direction: importing a name the module does not export.
    //
    // A browser does not fail quietly on this -- the entire module is rejected and the page renders
    // nothing -- but nothing here was looking, so it took a render to find. It happened moving two
    // functions into a new file and forgetting `export` on both, which is the ordinary way a split
    // goes wrong.
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\/([\w.-]+\.js)'/g)) {
      const source = files.find((f) => f.slice(ROOT.length + 1) === m[2]);
      if (!source) continue;
      const exported = new Set([
        ...[...read(source).matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/g)]
          .map((e) => e[1]),
        // `export { a, b }` and `export ... from`, which a split often uses to keep a path stable.
        ...[...read(source).matchAll(/export\s*\{([^}]*)\}/g)]
          .flatMap((e) => e[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop().trim())),
      ]);
      for (const part of m[1].split(',')) {
        const wanted = part.trim().split(/\s+as\s+/)[0].trim();
        if (!wanted || wanted === 'type' || exported.has(wanted)) continue;
        fail('missing', `${where} imports ${wanted} from ${m[2]} and that file does not export it. `
          + 'The browser rejects the entire module, so the page renders nothing.');
      }
    }

    // The same failure one step over: reading a name rather than calling it.
    //
    // The desk's sign-in path read `here.pathname` and the page had never imported `here`. The
    // check above only looked at calls, so it passed, and the line sat on the one path nothing
    // else runs -- what the screen does when a session has expired. Somebody signed out got a
    // page that threw instead of a way back in.
    //
    // Narrow on purpose, and the narrowness is what makes it reliable: only names a module this
    // file already imports from actually exports. A name that is exported next door and read
    // here, without being on the import line, is the mistake and there is no other reading of it.
    const reachable = new Map();
    for (const m of text.matchAll(/from\s+'\/([\w.-]+\.js)'/g)) {
      const source = files.find((f) => f.slice(ROOT.length + 1) === m[1]);
      if (!source) continue;
      for (const e of read(source).matchAll(/export\s+(?:async\s+)?(?:const|let|var|function)\s+(\w+)/g)) {
        if (!declared.has(e[1])) reachable.set(e[1], m[1]);
      }
    }
    if (reachable.size) {
      const seenHere = new Set();
      // Template literals are blanked above, and that is where this bug lived -- the line was
      // `${encodeURIComponent(here.pathname + here.search)}`. So the code inside every `${...}`
      // is put back, and only that: the prose around it would match an exported name like `page`
      // or `money` on nothing but a sentence.
      const readable = withoutStrings;
      for (const m of readable.matchAll(/(^|[^.\w$'"])([a-z_$][\w$]*)(?![\w$(:])/g)) {
        const name = m[2];
        if (!reachable.has(name) || seenHere.has(name)) continue;
        seenHere.add(name);
        fail('missing', `${where} reads ${name} and does not import it, though `
          + `${reachable.get(name)} exports it. Add it to the import line.`);
      }
    }
  }
}
