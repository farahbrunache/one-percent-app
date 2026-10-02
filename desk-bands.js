// The funnel shape, drawn from a list of rows.
//
// Two funnels use it. One asks whether the method worked for the person who called; the other
// asks whether selling the call works. Same shape, same arithmetic, different question, so the
// drawing is here rather than written twice in the page.

import { el } from '/desk-ui.js';

// The colour of each step, top to bottom. Coral where everybody is, sage where the work has
// ended in somebody being paid -- so the shape narrows and warms at the same time.
const COLOURS = ['#c96859', '#c08262', '#a89a6d', '#8bab84', '#6fb894'];

// The widest and narrowest bands, as a share of the row. The steps between them are even: a band
// has to hold a number and a line of words, and one that is literally proportional to its count
// does not -- one person out of twelve is a sliver. What the shape says is that there is a drop at
// every step. What the drop was is the number in the band and the percentage beside it.
const WIDEST = 100;
const NARROWEST = 56;

export function drawBands(box, stages, nothingYet) {
  box.textContent = '';
  if (!stages?.length || !stages.some((stage) => stage.count)) {
    box.append(el('p', nothingYet, 'nothing'));
    return;
  }

  // The open top of the vessel. Without it the first band is a rectangle and the shape starts
  // as a box.
  box.append(el('div', null, 'rim'));

  // Every band tapers, the last one included. The step is the full drop divided by the number of
  // bands rather than by the gaps between them, so the bottom of the last band is the narrowest
  // width and nothing ends as a rectangle.
  const step = (WIDEST - NARROWEST) / stages.length;
  stages.forEach((stage, i) => {
    const top = WIDEST - step * i;
    const bottom = WIDEST - step * (i + 1);
    const row = el('div', null, 'stage');
    row.style.setProperty('--band', COLOURS[i] || COLOURS.at(-1));
    row.style.setProperty('--top-left', `${(100 - top) / 2}%`);
    row.style.setProperty('--top-right', `${100 - (100 - top) / 2}%`);
    row.style.setProperty('--bottom-left', `${(100 - bottom) / 2}%`);
    row.style.setProperty('--bottom-right', `${100 - (100 - bottom) / 2}%`);
    // Keep the words inside the shape at its narrowest point rather than inside the row. The row
    // is full width; the band is not, and a clipped shape cuts its own text, so the bottom label
    // was being sliced by the taper it sat in.
    row.style.paddingInline = `calc(${(100 - bottom) / 2}% + 0.6rem)`;

    // A row nobody has filled in reads as a dash rather than as zero. Zero people to approach is
    // a claim; no figure is the absence of one.
    row.append(el('div', stage.count === null ? '—' : String(stage.count), 'count'));

    // The rate reads on the same line as the name. Put against the band's edge it was cut off,
    // because a clipped shape clips its own text too.
    //
    // A row that was typed says so here. The cost screen already learned this lesson: a reader
    // who cannot tell a measurement from a figure somebody entered is being asked to trust both
    // the same amount.
    const parts = [stage.label];
    if (stage.entered) parts.push('typed');
    if (stage.rate !== null) parts.push(`${stage.rate}%`);
    row.append(el('div', parts.join(' · '), 'name'));
    box.append(row);
  });
}
