// "Where your minutes go": each kind of step, how often, the typical time and the total, over the
// last thirty days. The figures come from lib/desk-time.js, which times each write on a record.

import { el, get } from '/desk-ui.js';

function minutes(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export async function renderMinutes() {
  const box = document.getElementById('minutes');
  const said = document.getElementById('minutessaid');
  box.textContent = '';
  try {
    const data = await get('time');
    if (!data.steps.length) {
      said.textContent = "Nothing timed yet. Every write on a person's record is timed from when "
        + 'you opened it, so this fills in as you work.';
      return;
    }
    said.textContent = `The last ${data.days} days: ${data.people} `
      + `${data.people === 1 ? 'person' : 'people'}, ${minutes(data.total)} in all, about `
      + `${minutes(Math.round(data.total / Math.max(1, data.people)))} each.`;
    for (const step of data.steps) {
      const row = el('div', null, 'row minutes');
      const head = el('div', null, 'who-head');
      head.append(el('span', step.label, 'what'));
      if (step.demo) head.append(el('div', 'DEMO', 'badge demo'));
      head.append(el('span', `typically ${minutes(step.typical)}`, 'when meta'));
      row.append(head);
      row.append(el('div', `${step.times} ${step.times === 1 ? 'time' : 'times'} · ${minutes(step.total)} in all`, 'meta'));
      box.append(row);
    }
  } catch (error) {
    said.textContent = '';
    box.append(el('p', error.message, 'nothing'));
  }
}
