// A field that holds a code, and never shows one in lower case.
//
// A code is read off one screen and typed into another, so every character has to be one
// character and not two that look alike. In lower case they are not: l is the digit 1 on most
// screens, and in a sans face I, l and 1 are close to identical. Upper case pulls them apart --
// L has a foot, I has serifs in the mono face these fields use, 1 has a flag and a base.
//
// `autocapitalize="characters"` is only a hint to a soft keyboard. A keyboard set otherwise
// ignores it, a hardware keyboard never sees it, and a paste bypasses it completely, which is
// how a code arrives in lower case on a screen that asked for upper. So the value is uppercased
// here instead, on every change, whatever produced it.
//
// This is about reading, not about working. The server already uppercases a reference and a
// card code before it matches either one, so a lower-case entry has always been accepted. What
// it could not do was stop somebody typing an l where they meant a 1 and seeing nothing wrong.

export function alwaysUpperCase(field) {
  if (!field) return;

  const raise = () => {
    const was = field.value;
    const now = was.toUpperCase();
    if (now === was) return;

    // Where the caret sits, kept across the change. Setting value moves it to the end, which
    // makes correcting a character in the middle of a code impossible -- every keystroke would
    // jump to the end. Upper-casing A-Z keeps the length, so the position still means what it
    // meant; anything that does not (a pasted ß becomes SS) falls back to the end, which is
    // where a paste leaves the caret anyway.
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = now;
    if (now.length === was.length && start !== null) {
      try {
        field.setSelectionRange(start, end);
      } catch {
        // A field whose type does not carry a selection (search, on some browsers). The value
        // is already right; the caret lands at the end, which is no worse than before.
      }
    }
  };

  // On every change, and once now: a browser restoring a value on back or reload puts it
  // there without firing anything.
  field.addEventListener('input', raise);
  raise();
}

// Every field on a screen that holds a code, by id. Absent ids are skipped, so one list
// serves pages that have different fields on them.
export function codeFields(ids) {
  for (const id of ids) alwaysUpperCase(document.getElementById(id));
}
