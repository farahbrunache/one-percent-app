// Small helpers shared by the endpoints.

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'The request body was not readable as JSON.');
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, payload) {
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

// Every endpoint wraps its work in this. An error that reaches here is reported with what
// failed rather than a bare 500, because the person hitting it has no logs to read.
export function handle(method, work) {
  return async function (req, res) {
    try {
      const allowed = Array.isArray(method) ? method : [method];
      if (!allowed.includes(req.method)) {
        res.setHeader('allow', allowed.join(', '));
        return send(res, 405, { error: `This endpoint accepts ${allowed.join(' or ')}.` });
      }
      await work(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : `The request could not be completed: ${error.message}`;
      if (status >= 500) console.error('[one-percent]', error);
      if (!res.writableEnded) send(res, status, { error: message });
    }
  };
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setCookie(res, name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  res.setHeader('set-cookie', bits.join('; '));
}
