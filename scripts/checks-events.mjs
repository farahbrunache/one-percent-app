// Every event kind written has a label to render it with.
//
// The trail labels each line through EVENT_KINDS. A kind written without an entry there renders as
// the raw key, so the record showed `conversation.opened` where every other line showed words --
// and that one is the moment the channel opens, the most load-bearing event on a record.
// `quote.answered` was the same, and it is the only kind the client writes rather than the
// operator. Three more had shipped by the time this check was written.
//
// Kinds are written two ways here, so both are read: through record(), and as a literal inside an
// insert into case_events.
//
// Its own file because scripts/checks.mjs passed its size limit the moment this went in, and this
// is the smallest thing in it that stands on its own.

export function eventsAreLabelled({ ROOT, files, read, fail, join }) {
  // insert into case_events.
  const deskVocabulary = read(join(ROOT, 'lib/desk.js'));
  const labelled = new Set(
    [...deskVocabulary
      .slice(deskVocabulary.indexOf('EVENT_KINDS = {'))
      .split('};')[0]
      .matchAll(/^\s*'?([\w.-]+)'?\s*:/gm)].map((m) => m[1]),
  );

  for (const file of files.filter((f) => /\/(api|lib)\/[\w.-]+\.js$/.test(f))) {
    const text = read(file);
    const name = file.slice(ROOT.length + 1);
    const written = new Set(
      [...text.matchAll(/\brecord\s*\([^,)]*,\s*'([\w.-]+)'/g)].map((m) => m[1]),
    );
    for (const m of text.matchAll(/insert into case_events[\s\S]{0,400}?`/g)) {
      for (const k of m[0].matchAll(/'([a-z][\w-]*\.[\w.-]+)'/g)) written.add(k[1]);
    }
    for (const kind of written) {
      if (labelled.has(kind)) continue;
      fail(
        'unlabelled event',
        `${name} writes the event kind '${kind}' and EVENT_KINDS has no label for it, so the trail `
          + 'shows the raw key. Add it.',
      );
    }
  }
}
