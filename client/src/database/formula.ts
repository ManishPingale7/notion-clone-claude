// A small formula language modelled on Notion formulas:
//   prop("Price") * 2, if(prop("Done"), "✅", "⏳"), dateBetween(prop("Due"), now(), "days"),
//   concat(prop("Name"), " - ", format(prop("Count"))), prop("Tags").length() …

export type FVal = number | string | boolean | Date | null | FVal[];

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'punc'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(src[i + 1] ?? c)) {
      let j = i;
      while (j < src.length && /[0-9._e]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j).replace(/_/g, '') });
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '“') {
      const close = c === '“' ? '”' : c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== close) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n;
          j += 2;
        } else s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%^<>!'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if ('(),.?:[]'.includes(c)) {
      out.push({ t: 'punc', v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

type Node =
  | { k: 'lit'; v: FVal }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'un'; op: string; a: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'list'; items: Node[] };

function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (v?: string) => {
    const t = tokens[p];
    if (!t || (v && t.v !== v)) throw new Error(`Expected ${v || 'token'}`);
    p++;
    return t;
  };
  const PREC: Record<string, number> = { '||': 1, or: 1, '&&': 2, and: 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7 };
  const expr = (min = 0): Node => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === 'punc' && t.v === '?' && min === 0) {
        p++;
        const a = expr();
        eat(':');
        const b = expr();
        left = { k: 'tern', c: left, a, b };
        continue;
      }
      const op = t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or')) ? t.v : null;
      if (!op || PREC[op] === undefined || PREC[op] <= min - 1 || PREC[op] < min) break;
      p++;
      const right = expr(PREC[op] + (op === '^' ? 0 : 1));
      left = { k: 'bin', op: op === 'and' ? '&&' : op === 'or' ? '||' : op, a: left, b: right };
    }
    return left;
  };
  const unary = (): Node => {
    const t = peek();
    if (t && ((t.t === 'op' && (t.v === '-' || t.v === '!')) || (t.t === 'id' && t.v === 'not'))) {
      p++;
      return { k: 'un', op: t.v === 'not' ? '!' : t.v, a: unary() };
    }
    return postfix(primary());
  };
  const args = (): Node[] => {
    eat('(');
    const list: Node[] = [];
    if (peek()?.v !== ')') {
      list.push(expr());
      while (peek()?.v === ',') {
        p++;
        list.push(expr());
      }
    }
    eat(')');
    return list;
  };
  const postfix = (node: Node): Node => {
    while (peek()?.v === '.') {
      p++;
      const name = eat().v;
      const a = peek()?.v === '(' ? args() : [];
      node = { k: 'call', name, args: [node, ...a] };
    }
    return node;
  };
  const primary = (): Node => {
    const t = eat();
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'punc' && t.v === '(') {
      const e = expr();
      eat(')');
      return e;
    }
    if (t.t === 'punc' && t.v === '[') {
      const items: Node[] = [];
      if (peek()?.v !== ']') {
        items.push(expr());
        while (peek()?.v === ',') {
          p++;
          items.push(expr());
        }
      }
      eat(']');
      return { k: 'list', items };
    }
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'pi') return { k: 'lit', v: Math.PI };
      if (t.v === 'e' && peek()?.v !== '(') return { k: 'lit', v: Math.E };
      if (peek()?.v === '(') return { k: 'call', name: t.v, args: args() };
      throw new Error(`Unknown name "${t.v}"`);
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const node = expr();
  if (p < tokens.length) throw new Error(`Unexpected "${tokens[p].v}"`);
  return node;
}

const toNum = (v: FVal): number => (v instanceof Date ? v.getTime() : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0);
export const fstr = (v: FVal): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (Array.isArray(v)) return v.map(fstr).join(', ');
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
  return String(v);
};
const truthy = (v: FVal) => (Array.isArray(v) ? v.length > 0 : !!v && v !== '');
const toDate = (v: FVal): Date | null => (v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null);

const UNIT_MS: Record<string, number> = { milliseconds: 1, seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };

function addDate(d: Date, n: number, unit: string) {
  const r = new Date(d);
  const u = unit.replace(/s$/, '') + 's';
  if (u === 'years') r.setFullYear(r.getFullYear() + n);
  else if (u === 'months') r.setMonth(r.getMonth() + n);
  else if (u === 'quarters') r.setMonth(r.getMonth() + n * 3);
  else r.setTime(r.getTime() + n * (UNIT_MS[u] || 864e5));
  return r;
}

export function evaluate(src: string, getProp: (name: string) => FVal): FVal {
  if (!src.trim()) return null;
  const ast = parse(tokenize(src));
  const ev = (n: Node): FVal => {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'list':
        return n.items.map(ev);
      case 'tern':
        return truthy(ev(n.c)) ? ev(n.a) : ev(n.b);
      case 'un': {
        const a = ev(n.a);
        return n.op === '-' ? -toNum(a) : !truthy(a);
      }
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.a)) && truthy(ev(n.b));
        if (n.op === '||') return truthy(ev(n.a)) || truthy(ev(n.b));
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case '+':
            if (typeof a === 'string' || typeof b === 'string') return fstr(a) + fstr(b);
            return toNum(a) + toNum(b);
          case '-':
            return toNum(a) - toNum(b);
          case '*':
            return toNum(a) * toNum(b);
          case '/':
            return toNum(b) === 0 ? null : toNum(a) / toNum(b);
          case '%':
            return toNum(a) % toNum(b);
          case '^':
            return Math.pow(toNum(a), toNum(b));
          case '==':
            return a instanceof Date || b instanceof Date ? toNum(a) === toNum(b) : fstr(a) === fstr(b) && typeof a === typeof b ? true : a === b;
          case '!=':
            return !(a === b || (fstr(a) === fstr(b) && typeof a === typeof b));
          case '>':
            return typeof a === 'string' && typeof b === 'string' ? a > b : toNum(a) > toNum(b);
          case '<':
            return typeof a === 'string' && typeof b === 'string' ? a < b : toNum(a) < toNum(b);
          case '>=':
            return toNum(a) >= toNum(b);
          case '<=':
            return toNum(a) <= toNum(b);
        }
        return null;
      }
      case 'call': {
        const name = n.name;
        if (name === 'prop') return getProp(fstr(ev(n.args[0])));
        if (name === 'if') return truthy(ev(n.args[0])) ? ev(n.args[1]) : n.args[2] ? ev(n.args[2]) : null;
        if (name === 'ifs') {
          for (let i = 0; i + 1 < n.args.length; i += 2) if (truthy(ev(n.args[i]))) return ev(n.args[i + 1]);
          return n.args.length % 2 ? ev(n.args[n.args.length - 1]) : null;
        }
        const a = n.args.map(ev);
        const s0 = fstr(a[0]);
        switch (name) {
          case 'concat':
            return a.every(Array.isArray) ? (a as FVal[][]).flat() : a.map(fstr).join('');
          case 'join':
            return Array.isArray(a[0]) ? (a[0] as FVal[]).map(fstr).join(fstr(a[1] ?? '')) : a.slice(1).map(fstr).join(s0);
          case 'length':
            return Array.isArray(a[0]) ? a[0].length : s0.length;
          case 'lower':
            return s0.toLowerCase();
          case 'upper':
            return s0.toUpperCase();
          case 'trim':
            return s0.trim();
          case 'contains':
            return Array.isArray(a[0]) ? a[0].map(fstr).includes(fstr(a[1])) : s0.includes(fstr(a[1]));
          case 'includes':
            return Array.isArray(a[0]) ? a[0].map(fstr).includes(fstr(a[1])) : s0.includes(fstr(a[1]));
          case 'test':
            try {
              return new RegExp(fstr(a[1])).test(s0);
            } catch {
              return false;
            }
          case 'replace':
            return s0.replace(fstr(a[1]), fstr(a[2]));
          case 'replaceAll':
            return s0.split(fstr(a[1])).join(fstr(a[2]));
          case 'slice':
          case 'substring':
            return Array.isArray(a[0]) ? a[0].slice(toNum(a[1]), a[2] !== undefined ? toNum(a[2]) : undefined) : s0.slice(toNum(a[1]), a[2] !== undefined ? toNum(a[2]) : undefined);
          case 'repeat':
            return s0.repeat(Math.max(0, Math.min(1000, toNum(a[1]))));
          case 'format':
            return fstr(a[0]);
          case 'toNumber': {
            const x = a[0] instanceof Date ? a[0].getTime() : parseFloat(s0);
            return Number.isFinite(x) ? x : null;
          }
          case 'empty':
            return !truthy(a[0]) && a[0] !== 0;
          case 'not':
            return !truthy(a[0]);
          case 'and':
            return a.every(truthy);
          case 'or':
            return a.some(truthy);
          case 'abs':
            return Math.abs(toNum(a[0]));
          case 'round': {
            const d = a[1] !== undefined ? toNum(a[1]) : 0;
            return Math.round(toNum(a[0]) * 10 ** d) / 10 ** d;
          }
          case 'floor':
            return Math.floor(toNum(a[0]));
          case 'ceil':
            return Math.ceil(toNum(a[0]));
          case 'sqrt':
            return Math.sqrt(toNum(a[0]));
          case 'pow':
            return Math.pow(toNum(a[0]), toNum(a[1]));
          case 'sign':
            return Math.sign(toNum(a[0]));
          case 'mod':
            return toNum(a[0]) % toNum(a[1]);
          case 'min':
          case 'max': {
            const nums = a.flatMap((x) => (Array.isArray(x) ? x : [x])).map(toNum);
            return nums.length ? (name === 'min' ? Math.min(...nums) : Math.max(...nums)) : null;
          }
          case 'sum':
            return a.flatMap((x) => (Array.isArray(x) ? x : [x])).reduce((s: number, x) => s + toNum(x), 0);
          case 'mean':
          case 'average': {
            const nums = a.flatMap((x) => (Array.isArray(x) ? x : [x])).map(toNum);
            return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
          }
          case 'now':
            return new Date();
          case 'today': {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
          }
          case 'dateAdd': {
            const d = toDate(a[0]);
            return d ? addDate(d, toNum(a[1]), fstr(a[2] || 'days')) : null;
          }
          case 'dateSubtract': {
            const d = toDate(a[0]);
            return d ? addDate(d, -toNum(a[1]), fstr(a[2] || 'days')) : null;
          }
          case 'dateBetween': {
            const d1 = toDate(a[0]);
            const d2 = toDate(a[1]);
            if (!d1 || !d2) return null;
            const unit = fstr(a[2] || 'days').replace(/s$/, '') + 's';
            if (unit === 'years') return d1.getFullYear() - d2.getFullYear();
            if (unit === 'months') return (d1.getFullYear() - d2.getFullYear()) * 12 + d1.getMonth() - d2.getMonth();
            return Math.trunc((d1.getTime() - d2.getTime()) / (UNIT_MS[unit] || 864e5));
          }
          case 'formatDate': {
            const d = toDate(a[0]);
            if (!d) return null;
            const f = fstr(a[1] || 'MMMM D, YYYY');
            const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            return f
              .replace(/YYYY/g, String(d.getFullYear()))
              .replace(/MMMM/g, M[d.getMonth()])
              .replace(/MMM/g, M[d.getMonth()].slice(0, 3))
              .replace(/MM/g, String(d.getMonth() + 1).padStart(2, '0'))
              .replace(/DD/g, String(d.getDate()).padStart(2, '0'))
              .replace(/D/g, String(d.getDate()))
              .replace(/HH/g, String(d.getHours()).padStart(2, '0'))
              .replace(/mm/g, String(d.getMinutes()).padStart(2, '0'));
          }
          case 'year':
            return toDate(a[0])?.getFullYear() ?? null;
          case 'month':
            return (toDate(a[0])?.getMonth() ?? -1) + 1 || null;
          case 'date':
            return toDate(a[0])?.getDate() ?? null;
          case 'day':
            return toDate(a[0])?.getDay() ?? null;
          case 'hour':
            return toDate(a[0])?.getHours() ?? null;
          case 'minute':
            return toDate(a[0])?.getMinutes() ?? null;
          case 'timestamp':
            return toDate(a[0])?.getTime() ?? null;
          case 'fromTimestamp':
            return new Date(toNum(a[0]));
          case 'parseDate':
            return toDate(s0);
          case 'first':
            return Array.isArray(a[0]) ? (a[0][0] ?? null) : null;
          case 'last':
            return Array.isArray(a[0]) ? (a[0][a[0].length - 1] ?? null) : null;
          case 'at':
            return Array.isArray(a[0]) ? (a[0][toNum(a[1])] ?? null) : null;
          case 'sort':
            return Array.isArray(a[0]) ? [...a[0]].sort((x, y) => (fstr(x) < fstr(y) ? -1 : 1)) : a[0];
          case 'reverse':
            return Array.isArray(a[0]) ? [...a[0]].reverse() : s0.split('').reverse().join('');
          case 'unique':
            return Array.isArray(a[0]) ? [...new Set(a[0].map(fstr))] : a[0];
          case 'split':
            return s0.split(fstr(a[1]));
          case 'style':
          case 'link':
            return s0;
          case 'id':
            return getProp('__id');
          default:
            throw new Error(`Unknown function ${name}()`);
        }
      }
    }
  };
  return ev(ast);
}

export function safeEvaluate(src: string, getProp: (name: string) => FVal): { value: FVal; error: string | null } {
  try {
    return { value: evaluate(src, getProp), error: null };
  } catch (e: any) {
    return { value: null, error: e.message || 'Invalid formula' };
  }
}
