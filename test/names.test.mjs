// A linked case shows the name on the Skills Economy account; an unlinked order shows its code.
//
// The name is read at sign-in, carried in a sealed cookie, and saved on the case when the
// account links a session. A cookie the site didn't seal is ignored rather than saved, because
// the desk opens every saved name and one that doesn't open would break the first screen.

import { Readable } from 'node:stream';
import { check, db, failureCount, tagged } from './harness.mjs';

process.env.ADMIN_ACCOUNT_IDS = 'admin-1';
const { encrypt, keyedHash, signSession } = await import('../lib/crypto.js');
const { nameFrom } = await import('../lib/auth.js');
const client = (await import('../api/client.js')).default;
const desk = (await import('../api/desk.js')).default;
await db.ensureSchema();

console.log('the name on the account');
check('name wins', nameFrom({ name: 'Ada Invented', given_name: 'X' }) === 'Ada Invented');
check('first and last when there is no name',
  nameFrom({ given_name: 'Ada', family_name: 'Invented' }) === 'Ada Invented');
check('the username when that is all there is', nameFrom({ preferred_username: 'ada' }) === 'ada');
check('nothing when the account has no name', nameFrom({ sub: 'x' }) === null);

async function order(token) {
  const rows = await tagged`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status)
    values (${keyedHash(token)}, ${'c-' + token}, 700, 'wise',
            ${'N' + Math.random().toString(36).slice(2, 11).toUpperCase()}, 'confirmed')
    returning id`;
  return Number(rows[0].id);
}

async function linkWith(account, token, nameCookie) {
  const body = Readable.from([JSON.stringify({ t: token })]);
  const cookies = [`op_session=${signSession(account)}`];
  if (nameCookie) cookies.push(`op_name=${encodeURIComponent(nameCookie)}`);
  const req = {
    method: 'POST', url: '/api/client?action=link',
    headers: { cookie: cookies.join('; '), 'content-type': 'application/json' },
    [Symbol.asyncIterator]: body[Symbol.asyncIterator].bind(body),
  };
  const res = {
    statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
    end() { this.writableEnded = true; },
  };
  await client(req, res);
  return res.statusCode;
}

async function person(id) {
  let said = null;
  const res = {
    statusCode: 200, writableEnded: false, setHeader() {}, getHeader() {},
    end(text) { this.writableEnded = true; said = text; },
  };
  await desk({
    method: 'GET', url: `/api/desk?action=person&id=${id}`,
    headers: { cookie: `op_session=${signSession('admin-1')}` },
  }, res);
  return JSON.parse(said);
}

console.log('linking saves it');
const unlinked = await order('tok-unlinked');
check('an order nobody linked has no name', (await person(unlinked)).name === null);

const named = await order('tok-named');
check('linking works', (await linkWith('acct-named', 'tok-named', encrypt('Ada Invented'))) === 200);
check('and the desk shows the name', (await person(named)).name === 'Ada Invented');

const forged = await order('tok-forged');
check('a forged cookie still links', (await linkWith('acct-forged', 'tok-forged', 'not-sealed')) === 200);
check('but no name is saved', (await person(forged)).name === null);

const failures = failureCount();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
