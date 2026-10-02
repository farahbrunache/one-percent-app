// The words the voice rules ban, looked for in the repository rather than only in a reply.
//
// The Stop hook in .claude/hooks/ reads what an agent says and blocks a banned word there. It
// never reads the repository, so every one of these words could be written into a comment, a
// variable name or a line a customer reads, and nothing looked. One was: a function called
// retireStale shipped in a fix for a billing bug, and the word sat inside a camelCase name where
// even a word-boundary match would have walked straight past it.
//
// So this matches inside names too, and the list is the same list the hook carries. The hook stays
// the source of truth for what is banned; this file is where the same list reaches the source.
// Change one and change the other, or they drift -- which is how this repository ended up without
// the ban on "whole" months after it was added upstream.

// Each entry is the word, what to write instead, and what is allowed to carry it anyway.
//
// `console` is the only one with an exemption, and it is narrow on purpose: console.log and a
// quoted 'console' in a list of browser globals are the identifier, which is its real name and is
// not ours to rename. "the browser console" in a sentence is the jargon the rule is about, and
// still fails.
const BANNED = [
  {
    word: /flywheel/i,
    use: 'a plain description of the loop',
  },
  {
    word: /punch list/i,
    use: 'list',
  },
  {
    word: /stale/i,
    use: 'name what you mean: out of date, superseded, no longer current, abandoned',
  },
  {
    word: /whole/i,
    use: 'entire, all of, end to end -- or drop it, which is usually right',
  },
  {
    word: /console/i,
    use: 'dashboard, or the browser\'s error log',
    allow: /console\s*\.\s*\w|['"`]console['"`]/,
  },
];

// The files whose job is to hold the dictionary. They carry every banned word by definition and
// a check that failed on them would be a check nobody could write down.
const DICTIONARY = ['scripts/checks-words.mjs', '.claude/hooks/check-no-pleasantries.mjs'];

export function wordsAreAllowed({ ROOT, files, read, fail }) {
  const looked = files.filter(
    (f) => /\.(js|mjs|html|css)$/.test(f) && !DICTIONARY.includes(f.slice(ROOT.length + 1)),
  );

  for (const file of looked) {
    const name = file.slice(ROOT.length + 1);
    const lines = read(file).split('\n');
    for (const [index, line] of lines.entries()) {
      for (const banned of BANNED) {
        const hit = line.match(banned.word);
        if (!hit) continue;
        if (banned.allow && banned.allow.test(line)) continue;
        fail(
          'banned word',
          `${name}:${index + 1} uses "${hit[0]}", which the voice rules ban. Write `
            + `${banned.use}. It is banned in a name and a comment as much as on a screen: `
            + 'whoever works on this next reads all three.',
        );
      }
    }
  }
}
