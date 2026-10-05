/*
 * 자동 채점: Streamlit app.py 의 grade_answer / norm_answer 를 그대로 옮긴 것.
 * 결과: "Y" 맞음 / "N" 틀림 / "?" 자동으로 단정하기 어려워 선생님 확인 필요
 * 원칙: 확실히 같으면 Y, 확실히 다르면 N, 식의 꼴만 다르거나 읽을 수 없으면 ?(선생님이 확인)
 *
 * Python 과 똑같이 동작하도록 맞춘 부분:
 * - \d 는 유니코드 숫자(Nd) 전체, \s·strip() 은 Python 의 공백 정의
 * - 정렬은 코드포인트 순(Python sorted), 분수는 BigInt 로 Fraction 과 같은 기약분수 문자열
 * - 식 계산은 ast 대신 작은 파서로, Python 이 None 을 돌려주는 곳에서 null
 */

export type Grade = "Y" | "N" | "?";

const D = "\\p{Nd}";
const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const NUM = `[-+]?${D}+(?:\\.${D}+)?`;

const CIRCLED: [string, string][] = [
  ["①", "1"],
  ["②", "2"],
  ["③", "3"],
  ["④", "4"],
  ["⑤", "5"],
];
const REL = "<=|>=|!=|<|>";
const FRAC_RE = new RegExp(`^([-+]?)\\(?(${NUM})\\)?/\\(?(${NUM})\\)?$`, "u");
const NUM_RE = new RegExp(`^${NUM}$`, "u");
const ASSIGN_RE = /^([a-z])=(.+)$/;
const ASSIGN_TEST = /^[a-z]=.+$/;
const ND_RE = /\p{Nd}/u;
const MAX_STR_DIGITS = 4300; // Python int <-> str 자릿수 제한

const relFindAll = (s: string) => s.match(new RegExp(REL, "g")) ?? [];
const relSplit = (s: string) => s.split(new RegExp(REL));

// ---------- Python 흉내 도우미 ----------
function cmpStr(a: string, b: string) {
  // Python 문자열 비교(코드포인트 순)
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i].codePointAt(0)!;
    const q = y[i].codePointAt(0)!;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

const pySorted = (xs: string[]) => [...xs].sort(cmpStr);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const isPyWs = (ch: string) => new RegExp(`^${WS}$`).test(ch);

function pyStrip(s: string, chars?: string) {
  const strip = (ch: string) => (chars === undefined ? isPyWs(ch) : chars.includes(ch));
  const cs = Array.from(s);
  let i = 0;
  let j = cs.length;
  while (i < j && strip(cs[i])) i++;
  while (j > i && strip(cs[j - 1])) j--;
  return cs.slice(i, j).join("");
}

// x[1:-1] (코드포인트 단위)
const inner = (s: string) => Array.from(s).slice(1, -1).join("");

// 유니코드 숫자(①이 아닌 Nd: ０-９ 등)를 ASCII 숫자로. Nd 는 0~9 가 연속으로 묶여 있다.
function asciiDigits(s: string) {
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    let cp = ch.codePointAt(0)!;
    let k = 0;
    while (ND_RE.test(String.fromCodePoint(cp - 1))) {
      cp--;
      k++;
    }
    out += String(k % 10);
  }
  return out;
}

type Frac = { n: bigint; d: bigint };
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const babs = (x: bigint) => (x < ZERO ? -x : x);

function gcd(a: bigint, b: bigint) {
  a = babs(a);
  b = babs(b);
  while (b !== ZERO) [a, b] = [b, a % b];
  return a;
}

function makeFrac(n: bigint, d: bigint): Frac {
  if (d === ZERO) throw new Error("ZeroDivisionError");
  if (d < ZERO) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g > ONE ? { n: n / g, d: d / g } : { n, d };
}

// Fraction("12.5") (NUM 꼴만 들어온다)
function parseFrac(s: string): Frac {
  const neg = s.startsWith("-");
  if (s[0] === "-" || s[0] === "+") s = s.slice(1);
  const [ip, dp = ""] = s.split(".");
  if (ip.length > MAX_STR_DIGITS || dp.length > MAX_STR_DIGITS) throw new Error("ValueError");
  let n = BigInt(asciiDigits(ip));
  let d = ONE;
  if (dp) {
    const scale = TEN ** BigInt(dp.length);
    n = n * scale + BigInt(asciiDigits(dp));
    d = scale;
  }
  return makeFrac(neg ? -n : n, d);
}

function fracStr(f: Frac) {
  const n = f.n.toString();
  const d = f.d.toString();
  if (babs(f.n).toString().length > MAX_STR_DIGITS || d.length > MAX_STR_DIGITS) throw new Error("ValueError");
  return f.d === ONE ? n : `${n}/${d}`;
}

function topSplit(s: string, seps = ",") {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// ---------- 답 정리 ----------
// 숫자·분수·소수를 같은 꼴(기약분수)로. 숫자가 아니면 null
function canonNumber(x: string): string | null {
  const m = FRAC_RE.exec(x);
  try {
    if (m) {
      const a = parseFrac(m[2]);
      const b = parseFrac(m[3]);
      if (b.n === ZERO) return null;
      const val = makeFrac(a.n * b.d, a.d * b.n);
      return fracStr(m[1] === "-" ? { n: -val.n, d: val.d } : val);
    }
    if (NUM_RE.test(x)) return fracStr(parseFrac(x));
  } catch {
    // ValueError / ZeroDivisionError → 숫자 아님
  }
  return null;
}

// 식을 항 단위로 나눠 순서 없이 비교할 수 있는 꼴로: 1+2x == 2x+1
function canonExpr(x: string) {
  x = x.replaceAll("*", "");
  const terms: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of x) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "+" || ch === "-") && cur && !"^(/*".includes(cur[cur.length - 1])) {
      terms.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) terms.push(cur);
  const out = terms.map((t) => {
    if (t.startsWith("+")) t = t.slice(1);
    return canonNumber(t) || t;
  });
  return pySorted(out).join("+");
}

function canonValue(x: string) {
  return canonNumber(x) ?? canonExpr(x);
}

const UNIT_RE = new RegExp(`(?<=${D})(cm|mm|km)\\^?[23]?$`, "u");
const KO_UNIT_RE = new RegExp(`(?<=${D})[가-힣°%]+$`, "u");

// 답 한 덩어리를 비교용 글자로. 앞뒤 군더더기(답:, 단위, x=)와 숫자 꼴을 정리한다.
function canonPart(x: string) {
  for (const [k, v] of CIRCLED) x = x.replaceAll(k, v);
  x = pyStrip(pyStrip(pyStrip(x), "."));
  x = x.replace(/^(답|정답)[:：]?/, "");
  x = x.replace(UNIT_RE, "");
  x = x.replace(KO_UNIT_RE, "");
  if (x.startsWith("(") && x.endsWith(")") && topSplit(inner(x)).length > 1) {
    return "(" + topSplit(inner(x)).map(canonValue).join(",") + ")"; // 좌표 (1,2): 순서 있음
  }
  const rels = relFindAll(x);
  if (rels.length === 1) {
    // 부등식: 3<x 와 x>3 은 같다
    let [left, right] = relSplit(x);
    let rel = rels[0];
    if (rel === ">" || rel === ">=") [left, right, rel] = [right, left, rel.replace(">", "<")];
    return `${canonValue(left)}${rel}${canonValue(right)}`;
  }
  return canonValue(x);
}

const REPLACES: [string, string][] = [
  ["$", ""],
  ["\\left", ""],
  ["\\right", ""],
  ["\\,", ""],
  ["\\ ", ""],
  ["−", "-"],
  ["×", "*"],
  ["÷", "/"],
  ["\\times", "*"],
  ["\\div", "/"],
  ["\\cdot", "*"],
  ["≤", "<="],
  ["≥", ">="],
  ["≠", "!="],
  ["²", "^2"],
  ["³", "^3"],
  ["\\pi", "pi"],
  ["π", "pi"],
];
const THOUSANDS_RE = new RegExp(`(?<![${D}.])${D}{1,3}(?:,${D}{3})+(?!${D})`, "gu");
const OR_RE = new RegExp(`${WS}+or${WS}+|또는|그리고|;`, "g");
const WS_RE = new RegExp(`${WS}+`, "g");

/**
 * 답을 비교하기 좋은 꼴(글자 목록)로.
 * $·띄어쓰기 제거, \frac{a}{b} → a/b, 천 단위 쉼표 제거, 괄호 밖 쉼표로 여러 답 나누기(순서 무관),
 * 좌표 (1,2)는 한 덩어리, 변수가 둘 이상인 연립 답(x=3, y=2)은 변수 이름을 남긴다.
 */
export function normAnswer(s: string): string[] {
  s = String(s || "");
  for (const [a, b] of REPLACES) s = s.replaceAll(a, b);
  // 웹앱에만 있는 규칙: 답 칸 버튼으로 넣은 √ 를 sqrt 로 (√3, √x, √(2x+1))
  s = s.replace(/√\s*\(/g, "sqrt(").replace(/√\s*(\p{Nd}+(?:\.\p{Nd}+)?|[A-Za-z])/gu, "sqrt($1)");
  s = s.replace(/\\leq?(?![a-z])/g, "<=");
  s = s.replace(/\\geq?(?![a-z])/g, ">=");
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");
  s = s.replace(/\\[dt]frac/g, "\\frac");
  let prev: string | null = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }
  s = s.toLowerCase();
  s = s.replace(THOUSANDS_RE, (m) => m.replaceAll(",", "")); // 1,000 → 1000
  s = s.replace(OR_RE, ",");
  s = s.replace(WS_RE, "");
  const raw = topSplit(s).filter((p) => p);
  const assigned = raw.map((p) => ASSIGN_RE.exec(p));
  const keepVars = assigned.every((m) => m) && new Set(assigned.map((m) => m![1])).size > 1;
  const items: string[] = [];
  raw.forEach((p, i) => {
    const m = assigned[i];
    if (m && !keepVars) {
      p = m[2]; // x=3 → 3
    } else if (m) {
      items.push(m[1] + "=" + canonPart(m[2]));
      return;
    }
    items.push(canonPart(p));
  });
  return pySorted([...new Set(items)]);
}

// ---------- 식의 값 계산 ----------
// "꼴은 다르지만 같은 식"인지 값을 직접 계산해서 확인한다 (곱셈 생략 2x, 거듭제곱 ^, sqrt, pi 지원)
// Python ast 로 읽어서 계산하던 것과 같은 범위만 받는다. 그 밖은 모두 null.
const EVAL_POINTS = [1.7, -2.3, 0.6];

class EvalError extends Error {}
const fail = (): never => {
  throw new EvalError();
};

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string };

const isIdStart = (c: string) => /[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 128;
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) >= 128;
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

// Python 토크나이저 규칙대로 숫자를 읽는다 (1_000, 1.e5, .5, 앞자리 0 금지, j 허수 → 실패)
function readNumber(s: string, i: number): [Tok, number] {
  const start = i;
  const digitPart = () => {
    if (!isDigit(s[i])) fail();
    while (isDigit(s[i]) || (s[i] === "_" && isDigit(s[i + 1]))) i++;
    if (s[i] === "_") fail();
  };
  let isFloat = false;
  if (s[i] !== ".") digitPart();
  const intPart = s.slice(start, i);
  if (s[i] === ".") {
    isFloat = true;
    i++;
    if (isDigit(s[i])) digitPart();
    else if (s[i] === "_") fail();
  }
  if (s[i] === "e" || s[i] === "E") {
    isFloat = true;
    i++;
    if (s[i] === "+" || s[i] === "-") i++;
    digitPart();
  }
  if (s[i] === "j" || s[i] === "J") fail(); // 허수
  if (i < s.length && isIdChar(s[i])) fail(); // invalid decimal literal
  const text = s.slice(start, i).replaceAll("_", "");
  if (!isFloat) {
    if (/^0+[1-9]/.test(intPart.replaceAll("_", ""))) fail(); // leading zeros
    const v = Number(BigInt(text));
    if (!Number.isFinite(v)) fail(); // OverflowError
    return [{ t: "num", v }, i];
  }
  return [{ t: "num", v: Number(text) }, i];
}

function tokenize(s: string): Tok[] {
  const hash = s.indexOf("#"); // 주석
  if (hash >= 0) s = s.slice(0, hash);
  const toks: Tok[] = [];
  let i = 0;
  let level = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\f") {
      i++;
    } else if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      const [tok, j] = readNumber(s, i);
      toks.push(tok);
      i = j;
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (j < s.length && isIdChar(s[j])) j++;
      toks.push({ t: "name", v: s.slice(i, j) });
      i = j;
    } else if (s.startsWith("**", i)) {
      toks.push({ t: "op", v: "**" });
      i += 2;
    } else if ("+-*/(),".includes(c)) {
      if (c === "/" && s[i + 1] === "/") fail(); // // 는 지원 안 함
      if (c === "(") {
        if (level >= 200) fail(); // too many nested parentheses
        level++;
      } else if (c === ")") {
        level--;
      }
      toks.push({ t: "op", v: c });
      i++;
    } else {
      fail(); // 그 밖의 글자: Python 에서도 지원하지 않는 구문이거나 문법 오류
    }
  }
  return toks;
}

function pyPow(a: number, b: number) {
  if (!(Math.abs(b) <= 12 && Math.abs(a) <= 1e6)) fail();
  if (b === 0) return 1;
  if (a === 0 && b < 0) fail(); // ZeroDivisionError
  if (a < 0 && !Number.isInteger(b)) fail(); // 복소수
  const r = Math.pow(a, b);
  if (!Number.isFinite(r)) fail(); // OverflowError
  return r;
}

type Node =
  | { k: "num"; v: number }
  | { k: "name"; v: string }
  | { k: "neg" | "pos"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "sqrt"; a: Node };

// Python 문법(eval 모드)으로 읽기. 지원하지 않는 꼴은 모두 실패
function parse(toks: Tok[]): Node {
  let pos = 0;
  const peek = (v: string) => {
    const t = toks[pos];
    return t !== undefined && t.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!peek(v)) fail();
    pos++;
  };
  const opAt = () => (toks[pos++] as { v: string }).v;

  function sum(): Node {
    let a = term();
    while (peek("+") || peek("-")) a = { k: "bin", op: opAt(), a, b: term() };
    return a;
  }
  function term(): Node {
    let a = factor();
    while (peek("*") || peek("/")) a = { k: "bin", op: opAt(), a, b: factor() };
    return a;
  }
  function factor(): Node {
    if (peek("+") || peek("-")) return { k: opAt() === "+" ? "pos" : "neg", a: factor() };
    return power();
  }
  function power(): Node {
    const a = primary();
    if (peek("**")) {
      pos++;
      return { k: "bin", op: "**", a, b: factor() };
    }
    return a;
  }
  function primary(): Node {
    const t = toks[pos];
    if (t === undefined) return fail();
    pos++;
    let node: Node;
    if (t.t === "num") node = { k: "num", v: t.v };
    else if (t.t === "name") node = { k: "name", v: t.v };
    else if (t.v === "(") {
      node = sum();
      expect(")");
    } else return fail();
    if (peek("(")) {
      // 함수 호출은 sqrt(x) 하나만 (뒤에 쉼표 하나는 Python 문법상 허용)
      pos++;
      if (node.k !== "name" || node.v !== "sqrt" || peek(")")) fail();
      node = { k: "sqrt", a: sum() };
      if (peek(",")) pos++;
      expect(")");
      if (peek("(")) fail();
    }
    return node;
  }

  const node = sum();
  if (pos !== toks.length) fail();
  return node;
}

// Python 재귀 한도(1000)에 걸리면 RecursionError → None 이 되는 것까지 흉내
const MAX_DEPTH = 992;

function ev(n: Node, env: Map<string, number>, depth: number): number {
  if (depth > MAX_DEPTH) fail();
  switch (n.k) {
    case "num":
      return n.v;
    case "name": {
      if (n.v === "π") return 3.141592653589793;
      const v = env.get(n.v);
      return v === undefined ? fail() : v;
    }
    case "pos":
      return ev(n.a, env, depth + 1);
    case "neg":
      return -ev(n.a, env, depth + 1);
    case "sqrt": {
      const v = ev(n.a, env, depth + 1);
      if (v < 0) fail();
      return Math.pow(v, 0.5);
    }
    case "bin": {
      const a = ev(n.a, env, depth + 1);
      const b = ev(n.b, env, depth + 1);
      if (n.op === "+") return a + b;
      if (n.op === "-") return a - b;
      if (n.op === "*") return a * b;
      if (n.op === "/") return b === 0 ? fail() : a / b; // ZeroDivisionError
      return pyPow(a, b);
    }
  }
}

function evalExpr(expr: string, env: Map<string, number>): number | null {
  let e = expr.replaceAll("sqrt", "§").replaceAll("pi", "π");
  // 웹앱에서 고침: 3sqrt(3) 처럼 sqrt 앞의 곱셈 생략도 계산한다 (Streamlit 판은 이 경우 계산 못 해서 ? 로 남겼다)
  e = e.replace(/(?<=[\p{Nd})a-zπ])(?=[a-zπ(§])/gu, "*");
  e = e.replace(/§\*\(/g, "§(").replaceAll("§", "sqrt").replaceAll("^", "**");
  try {
    return ev(parse(tokenize(e)), env, 1);
  } catch (err) {
    if (err instanceof EvalError || err instanceof RangeError) return null;
    throw err;
  }
}

// Python max(1.0, a, b): NaN 은 건너뛴다
function pyMax(...xs: number[]) {
  let m = xs[0];
  for (const x of xs.slice(1)) if (x > m) m = x;
  return m;
}

// 두 식이 값으로 같으면 true, 다르면 false, 계산할 수 없으면 null
function sameValue(a: string, b: string): boolean | null {
  const letters = (s: string) => s.replaceAll("sqrt", "").replaceAll("pi", "").match(/[a-z]/g) ?? [];
  const names = pySorted([...new Set([...letters(a), ...letters(b)])]);
  for (let k = 0; k < EVAL_POINTS.length; k++) {
    const env = new Map(names.map((nm) => [nm, EVAL_POINTS[k] + (nm.charCodeAt(0) % 7) * 0.31 + k * 0.17]));
    const va = evalExpr(a, env);
    const vb = evalExpr(b, env);
    if (va === null || vb === null) return null;
    if (Math.abs(va - vb) > 1e-7 * pyMax(1.0, Math.abs(va), Math.abs(vb))) return false;
  }
  return true;
}

// ---------- 채점 ----------
function compareItem(g: string, c: string): Grade {
  if (g === c) return "Y";
  const gn = canonNumber(g);
  const cn = canonNumber(c);
  if (gn !== null && cn !== null) return "N";
  if (g.startsWith("(") && c.startsWith("(")) {
    // 좌표: 원소별로
    const gp = topSplit(inner(g));
    const cp = topSplit(inner(c));
    if (gp.length !== cp.length) return "N";
    const res = new Set(gp.map((x, i) => compareItem(x, cp[i])));
    return res.size === 1 && res.has("Y") ? "Y" : res.has("N") ? "N" : "?";
  }
  const gr = relFindAll(g);
  const cr = relFindAll(c);
  if (gr.length || cr.length) {
    if (!sameList(gr, cr) || gr.length !== 1) return !sameList(gr, cr) ? "N" : "?";
    const gs = relSplit(g);
    const cs = relSplit(c);
    const res = new Set(gs.slice(0, Math.min(gs.length, cs.length)).map((x, i) => compareItem(x, cs[i])));
    const allY = res.size === 1 && res.has("Y");
    return allY || (res.has("?") && !res.has("N")) ? "?" : "N";
  }
  // 글자(ㄱ, 참/거짓 등)가 든 답은 식이 아니므로 다르면 틀림
  if (/[^\x00-\x7f]/.test(g + c)) return "N";
  const eq = sameValue(g, c);
  if (eq === null) return "?";
  return eq ? "?" : "N"; // 값은 같고 꼴만 다름(예: 2(x+1) 과 2x+2) → 선생님 확인
}

const plain = (items: string[]) =>
  pySorted(items.map((i) => (ASSIGN_TEST.test(i) ? i.slice(i.indexOf("=") + 1) : i)));

function gradeAnswerInner(given: string, correct: string): Grade {
  if (!pyStrip(String(correct || ""))) return "?";
  if (!pyStrip(String(given || ""))) return "N";
  const g = normAnswer(given);
  const c = normAnswer(correct);
  if (sameList(g, c)) return "Y";
  // 연립 답은 변수 이름을 남겨 비교한다. 학생이 변수 없이 쓰면 어느 값이 어느 변수인지 알 수 없어 선생님 확인
  if (!g.some((i) => i.includes("=")) && sameList(plain(g), plain(c))) return "?";
  const rg = g.filter((i) => !c.includes(i));
  const rc = c.filter((i) => !g.includes(i));
  if (rg.length !== rc.length) return "N";
  if ([...rg, ...rc].every((i) => ASSIGN_TEST.test(i))) {
    // 변수별로 값을 비교
    const toMap = (xs: string[]) => new Map(xs.map((i) => [i.slice(0, i.indexOf("=")), i.slice(i.indexOf("=") + 1)]));
    const gv = toMap(rg);
    const cv = toMap(rc);
    if (gv.size !== cv.size || [...gv.keys()].some((k) => !cv.has(k))) return "N";
    const res = new Set([...cv.keys()].map((k) => compareItem(gv.get(k)!, cv.get(k)!)));
    return res.has("N") ? "N" : res.has("?") ? "?" : "Y";
  }
  if (rg.length === 1) return compareItem(rg[0], rc[0]);
  // 여러 개가 남으면: 하나라도 식이면 선생님 확인, 모두 숫자면 틀림
  if ([...rg, ...rc].every((i) => canonNumber(i) !== null)) return "N";
  return "?";
}

/** 'Y' 맞음 / 'N' 틀림 / '?' 정답이 없거나 자동으로 단정하기 어려워 선생님 확인 필요. 절대 throw 하지 않는다. */
export function gradeAnswer(given: string, correct: string): Grade {
  try {
    return gradeAnswerInner(given, correct);
  } catch {
    return "?";
  }
}
