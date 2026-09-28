import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg = 'Bad request') => new HttpError(400, msg);
export const unauthorized = (msg = 'Not signed in') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Wraps an express handler so thrown errors (sync or async) reach the error middleware. */
export const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (err) {
    next(err);
  }
};

export const AVATAR_COLORS = ['#E16259', '#D9730D', '#CB912F', '#448361', '#337EA9', '#9065B0', '#C14C8A', '#9F6B53', '#2E7D7A', '#5B6CD6'];
export const pickColor = (seed) => {
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
};

export const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function str(v, max = 10000) {
  if (v == null) return '';
  return String(v).slice(0, max);
}
