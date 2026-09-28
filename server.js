// The web server.
//
// Six pages and eight endpoints. Everything a platform used to do from a configuration
// file — which file answers which address, the headers, the one redirect, the one rewrite —
// is in this file instead, where it can be read and tested rather than trusted.
//
// Only the files named below are ever served. There is no directory to walk and no path to
// escape from, because a path is never turned into a file name.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// address -> file on disk. The address is the key, so nothing a caller sends becomes a path.
const PAGES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/buy': ['buy.html', 'text/html; charset=utf-8'],
  '/claim': ['claim.html', 'text/html; charset=utf-8'],
  '/payments': ['payments.html', 'text/html; charset=utf-8'],
  '/desk': ['desk.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
};

const ENDPOINTS = {
  '/api/submit': () => import('./api/submit.js'),
  '/api/status': () => import('./api/status.js'),
  '/api/recover': () => import('./api/recover.js'),
  '/api/call': () => import('./api/call.js'),
  '/api/payments': () => import('./api/payments.js'),
  '/api/desk': () => import('./api/desk.js'),
  '/api/auth': () => import('./api/auth.js'),
  '/api/retell': () => import('./api/retell.js'),
  '/api/sweep': () => import('./api/sweep.js'),
  '/api/client': () => import('./api/client.js'),
};

// The claim link, the payments screen and the desk must never be held by a browser or
// anything between it and here: one shows an order's live state, one shows card codes, and
// the third shows what somebody said in half an hour of their life.
const NEVER_CACHE = new Set(['/claim', '/payments', '/desk']);

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
}

async function page(res, pathname) {
  const [file, type] = PAGES[pathname];
  const body = await readFile(join(HERE, file));
  res.statusCode = 200;
  res.setHeader('content-type', type);
  if (NEVER_CACHE.has(pathname)) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex, nofollow');
  }
  res.end(body);
}

export async function route(req, res) {
  const url = new URL(req.url, 'https://placeholder.invalid');
  let pathname = url.pathname.replace(/\/+$/, '') || '/';

  securityHeaders(res);

  // A plain path, because the sign-in service matches the return address character for
  // character and some refuse one carrying a query.
  if (pathname === '/auth/callback') {
    req.url = `/api/auth?action=callback&${url.searchParams.toString()}`;
    pathname = '/api/auth';
  }

  // The screen is payments and nothing else, so that is what it is called. Anyone holding the
  // old address is sent on rather than shown nothing; it costs one line and nobody has to be
  // told about a rename.
  if (pathname === '/admin') {
    res.statusCode = 308;
    res.setHeader('location', '/payments');
    return res.end('');
  }

  // Asking for the file when the address is what is served would give two addresses for one
  // page, so the file name sends you to the address.
  const asFile = Object.keys(PAGES).find((key) => pathname === `${key}.html`);
  if (asFile) {
    res.statusCode = 308;
    res.setHeader('location', asFile);
    return res.end('');
  }

  if (PAGES[pathname]) return page(res, pathname);

  const endpoint = ENDPOINTS[pathname];
  if (endpoint) {
    const handler = (await endpoint()).default;
    return handler(req, res);
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: `There is nothing at ${pathname}.` }));
}

// One line per request, in the log the hosting dashboard shows.
//
// Without it a request that arrives and is answered leaves no trace, so there is no way to
// tell a caller that never reached here from one that reached here and was refused. That
// question came up the first time an outside service reported a 404 against an address this
// server answers, and it could not be answered from anything already recorded.
//
// The path only, never the query string: a claim link carries an order's reference and a desk
// address carries a person's id, and neither belongs in a log a hosting dashboard keeps. No
// headers and no body either, for the same reason — the body of a voice delivery is somebody's
// half hour.
function log(req, res, pathname) {
  res.on('finish', () => console.log(`[one-percent] ${req.method} ${pathname} ${res.statusCode}`));
}

// Imported by the tests, which call route directly. Only a real start listens.
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT) || 3000;
  http
    .createServer((req, res) => {
      log(req, res, new URL(req.url, 'https://placeholder.invalid').pathname);
      route(req, res).catch((error) => {
        console.error('[one-percent]', error);
        if (res.writableEnded) return;
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: `The request could not be completed: ${error.message}` }));
      });
    })
    .listen(port, () => console.log(`[one-percent] listening on ${port}`));
}
