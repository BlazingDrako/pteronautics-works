// Safe math expressions typed by the user: a small parser (no eval) that compiles to closures.
//   compileReal('a*y + sin(t)', ['x', 'y', 't', 'a'])  → f(x, y, t, a)
//   compileComplex('U*(z + R^2/z)', ['U', 'R'])        → f([re, im], U, R) → [re, im]
// Grammar: numbers (1, 2.5, 3e-4), names, + − * / ^ (right-associative), unary ±, parentheses, function calls,
// and implicit multiplication between a number and a name or bracket ("2x", "3(x+1)", "2 pi").
// Constants: pi, e (and i for complex expressions). Throws an Error with a readable message on bad input.

const REAL_FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign, floor: Math.floor, atan2: Math.atan2, min: Math.min, max: Math.max,
  pow: Math.pow, hypot: Math.hypot, sec: x => 1 / Math.cos(x), csc: x => 1 / Math.sin(x), cot: x => 1 / Math.tan(x),
};

function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ t: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if (c === '*' && s[i + 1] === '*') { out.push({ t: 'op', v: '^' }); i += 2; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c === '(' || c === ')' || c === ',' ? c : 'op', v: c }); i++; continue; }
    if (c === '·' || c === '×') { out.push({ t: 'op', v: '*' }); i++; continue; }
    if (c === '−') { out.push({ t: 'op', v: '-' }); i++; continue; }
    if (c === 'π') { out.push({ t: 'id', v: 'pi' }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  // implicit multiplication: 2x, 2(…), )(, )x, x(… is a call only when x is a function
  const res = [];
  for (let k = 0; k < out.length; k++) {
    const a = res[res.length - 1], b = out[k];
    if (a && (a.t === 'n' || a.t === ')') && (b.t === 'id' || b.t === '(' || b.t === 'n')) res.push({ t: 'op', v: '*' });
    res.push(b);
  }
  return res;
}

// recursive-descent parser → AST nodes { k: 'n'|'v'|'u'|'b'|'f', … }
function parse(src) {
  const T = tokenize(src); let p = 0;
  const peek = () => T[p], take = () => T[p++];
  const expect = t => { const x = take(); if (!x || x.t !== t) throw new Error(`Expected "${t}"`); return x; };
  function expr() { let a = term(); while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const o = take().v; a = { k: 'b', o, a, b: term() }; } return a; }
  function term() {
    let a = unary();
    for (;;) {
      const q = peek();
      if (q && q.t === 'op' && (q.v === '*' || q.v === '/')) { take(); a = { k: 'b', o: q.v, a, b: unary() }; continue; }
      // implicit product of a closed factor with a following name or bracket: (x+1)(x-1), x y is not allowed
      if (q && (q.t === '(' ) && a.k !== 'f') { a = { k: 'b', o: '*', a, b: unary() }; continue; }
      return a;
    }
  }
  function unary() { const q = peek(); if (q && q.t === 'op' && (q.v === '-' || q.v === '+')) { take(); const x = unary(); return q.v === '-' ? { k: 'u', a: x } : x; } return power(); }
  function power() { const a = atom(); const q = peek(); if (q && q.t === 'op' && q.v === '^') { take(); return { k: 'b', o: '^', a, b: unary() }; } return a; }
  function atom() {
    const q = take();
    if (!q) throw new Error('Unexpected end of expression');
    if (q.t === 'n') return { k: 'n', v: q.v };
    if (q.t === '(') { const e = expr(); expect(')'); return e; }
    if (q.t === 'id') {
      if (peek() && peek().t === '(') {
        take(); const args = [];
        if (peek() && peek().t !== ')') { args.push(expr()); while (peek() && peek().t === ',') { take(); args.push(expr()); } }
        expect(')');
        return { k: 'f', name: q.v, args };
      }
      return { k: 'v', name: q.v };
    }
    throw new Error(`Unexpected "${q.v}"`);
  }
  const ast = expr();
  if (p < T.length) throw new Error(`Unexpected "${T[p].v}"`);
  return ast;
}

export function compileReal(src, names) {
  const ast = parse(String(src));
  const idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const build = n => {
    switch (n.k) {
      case 'n': { const v = n.v; return () => v; }
      case 'v': {
        if (n.name in idx) { const i = idx[n.name]; return a => a[i]; }
        if (n.name === 'pi') return () => Math.PI;
        if (n.name === 'e') return () => Math.E;
        throw new Error(`Unknown name "${n.name}" (use ${names.join(', ')})`);
      }
      case 'u': { const f = build(n.a); return a => -f(a); }
      case 'b': {
        const f = build(n.a), g = build(n.b);
        return { '+': a => f(a) + g(a), '-': a => f(a) - g(a), '*': a => f(a) * g(a), '/': a => f(a) / g(a), '^': a => f(a) ** g(a) }[n.o];
      }
      case 'f': {
        const fn = REAL_FN[n.name]; if (!fn) throw new Error(`Unknown function "${n.name}"`);
        const as = n.args.map(build);
        if (as.length === 1) { const f0 = as[0]; return a => fn(f0(a)); }
        return a => fn(...as.map(f => f(a)));
      }
    }
  };
  const f = build(ast);
  return (...a) => f(a);
}

// ---- complex arithmetic on [re, im] ----
export const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  exp: a => { const r = Math.exp(a[0]); return [r * Math.cos(a[1]), r * Math.sin(a[1])]; },
  log: a => [Math.log(Math.hypot(a[0], a[1])), Math.atan2(a[1], a[0])],
  pow: (a, b) => {
    if (b[1] === 0 && Number.isInteger(b[0]) && Math.abs(b[0]) <= 16) { // exact small integer powers
      let r = [1, 0]; const n = Math.abs(b[0]); for (let k = 0; k < n; k++) r = C.mul(r, a);
      return b[0] < 0 ? C.div([1, 0], r) : r;
    }
    if (a[0] === 0 && a[1] === 0) return [0, 0];
    return C.exp(C.mul(b, C.log(a)));
  },
  sin: a => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])],
  cos: a => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])],
  sinh: a => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])],
  cosh: a => [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])],
};
C.sqrt = a => C.pow(a, [0.5, 0]);
C.tan = a => C.div(C.sin(a), C.cos(a));
C.tanh = a => C.div(C.sinh(a), C.cosh(a));
const CPLX_FN = { exp: C.exp, log: C.log, ln: C.log, sqrt: C.sqrt, sin: C.sin, cos: C.cos, tan: C.tan, sinh: C.sinh, cosh: C.cosh, tanh: C.tanh,
  conj: a => [a[0], -a[1]], re: a => [a[0], 0], im: a => [a[1], 0], abs: a => [Math.hypot(a[0], a[1]), 0], arg: a => [Math.atan2(a[1], a[0]), 0] };

// names: real parameters after z (z is always the first argument)
export function compileComplex(src, names = []) {
  const ast = parse(String(src));
  const idx = Object.fromEntries(names.map((n, i) => [n, i + 1]));
  const build = n => {
    switch (n.k) {
      case 'n': { const v = [n.v, 0]; return () => v; }
      case 'v': {
        if (n.name === 'z') return a => a[0];
        if (n.name in idx) { const i = idx[n.name]; return a => [a[i], 0]; }
        if (n.name === 'i' || n.name === 'j') return () => [0, 1];
        if (n.name === 'pi') return () => [Math.PI, 0];
        if (n.name === 'e') return () => [Math.E, 0];
        throw new Error(`Unknown name "${n.name}" (use z${names.length ? ', ' + names.join(', ') : ''}, i, pi)`);
      }
      case 'u': { const f = build(n.a); return a => { const v = f(a); return [-v[0], -v[1]]; }; }
      case 'b': { const f = build(n.a), g = build(n.b), op = { '+': C.add, '-': C.sub, '*': C.mul, '/': C.div, '^': C.pow }[n.o]; return a => op(f(a), g(a)); }
      case 'f': {
        const fn = CPLX_FN[n.name]; if (!fn || n.args.length !== 1) throw new Error(`Unknown function "${n.name}"`);
        const f0 = build(n.args[0]); return a => fn(f0(a));
      }
    }
  };
  const f = build(ast);
  return (z, ...p) => f([z, ...p]);
}
