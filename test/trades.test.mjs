// The trade list and the introductions it suggests: copied from Charging The Future with the
// credential it issued, a title gone from their list marked inactive, suggestions only among
// people told yes and never two already introduced, and pairs across everybody.

import { Readable } from 'node:stream';
import { check, db, failureCount, tagged } from './harness.mjs';

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
process.env.SWEEP_SECRET = 'invented-sweep-secret';
const { signSession } = await import('../lib/crypto.js');
const desk = (await import('../api/desk.js')).default;
const sweep = (await import('../api/sweep.js')).default;
await db.ensureSchema();

const cookie = `op_session=${signSession('admin-1')}`;
function res() {
  return { statusCode: 200, writableEnded: false, body: null, setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; this.body = text; } };
}
async function call(handler, method, url, payload, headers = {}) {
  const stream = Readable.from([JSON.stringify(payload || {})]);
  const out = res();
  try {
    await handler({ method, url, headers: { cookie, 'content-type': 'application/json', ...headers },
      [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream) }, out);
    return { status: out.statusCode, out: out.body ? JSON.parse(out.body) : null };
  } catch (error) {
    return { status: error.status || 500, message: error.message };
  }
}

// Charging The Future, faked: a sector with three titles, and what was sent to it.
let sent = null;
let titles = [['t-plumb', 'Plumber'], ['t-elec', 'Electrician'], ['t-carp', 'Carpenter']];
globalThis.fetch = async (url, options) => {
  sent = { url, authorization: options.headers.authorization };
  return new Response(JSON.stringify({ items: [{ id: 's-build', name: 'Construction', displayOrder: 1,
    isActive: true, jobTitles: titles.map(([id, name], i) => ({ id, name, displayOrder: i, isActive: true })) }] }));
};

console.log('copying the list');
const off = await call(sweep, 'POST', '/api/sweep?action=trades', {}, { authorization: 'Bearer invented-sweep-secret' });
check('without its two settings it says which are missing', off.status === 503 && /TAXONOMY_URL/.test(off.out?.error || off.message), off);
process.env.TAXONOMY_URL = 'https://ctf.invalid/';
process.env.TAXONOMY_TOKEN = 'onepercent.invented';
const copied = await call(sweep, 'POST', '/api/sweep?action=trades', {}, { authorization: 'Bearer invented-sweep-secret' });
check('the daily job copies it', copied.status === 200 && copied.out.titles === 3, copied);
check('from the hierarchy route, with the name.secret credential',
  sent.url === 'https://ctf.invalid/api/skills-taxonomy/hierarchy' && sent.authorization === 'Bearer onepercent.invented', sent);
titles = titles.slice(0, 2);
const again = await call(desk, 'POST', '/api/desk?action=trades-copy', {});
check('copying by hand works too, and a title gone from their list is retired', again.out.retired === 1, again);
const [carp] = await tagged`select active from trades where id = 't-carp'`;
check('retired, not deleted', carp && carp.active === false, carp);

async function order(n, decision) {
  const [row] = await tagged`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status, decision)
    values (${'tr-h-' + n}, ${'tr-c-' + n}, 700, 'wise', ${'TRADE' + n}, 'confirmed', ${decision})
    returning id`;
  return Number(row.id);
}
const a = await order('A', 'go');
const b = await order('B', 'go');
const c = await order('C', 'go');
const d = await order('D', 'no-go');

console.log('setting trades and suggesting');
check('a trade off the list is refused', (await call(desk, 'POST', '/api/desk?action=trade', { id: a, trade: 'nope' })).status === 404);
await call(desk, 'POST', '/api/desk?action=trade', { id: a, trade: 't-plumb' });
await call(desk, 'POST', '/api/desk?action=trade', { id: b, trade: 't-plumb' });
await call(desk, 'POST', '/api/desk?action=trade', { id: c, trade: 't-elec' });
await call(desk, 'POST', '/api/desk?action=trade', { id: d, trade: 't-elec' });
const person = (await call(desk, 'GET', `/api/desk?action=person&id=${a}`)).out;
check('their trade comes back with the list to pick from', person.trade?.title === 'Plumber' && person.trades.length === 2, person.trade);
check('the same trade is suggested', person.couldWorkWith.sameTrade.map((p) => p.id).join() === String(b), person.couldWorkWith);
check('and the same sector in another trade, only among people told yes',
  person.couldWorkWith.sameSector.map((p) => p.id).join() === String(c), person.couldWorkWith);

console.log('pairs across everybody');
let pairs = (await call(desk, 'GET', '/api/desk?action=pairs')).out.pairs;
check('three people told yes in one sector make three pairs', pairs.length === 3, pairs);
await call(desk, 'POST', '/api/desk?action=introduce', { id: a, reference: 'TRADEB', reason: 'Both plumbers.' });
pairs = (await call(desk, 'GET', '/api/desk?action=pairs')).out.pairs;
check('an introduction takes that pair off the list', pairs.length === 2
  && !pairs.some((p) => [p.a.id, p.b.id].sort().join() === [a, b].sort().join()), pairs);
const after = (await call(desk, 'GET', `/api/desk?action=person&id=${a}`)).out;
check('and off their suggestions', after.couldWorkWith.sameTrade.length === 0, after.couldWorkWith);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
