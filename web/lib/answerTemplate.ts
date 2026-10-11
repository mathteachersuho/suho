/*
 * 숫자만 넣는 답 틀: 정답(LaTeX)을 보고 루트·분수·거듭제곱·문자·기호는 그대로 두고 숫자 자리만 빈칸으로 만든다.
 *   $\sqrt{3}+\frac{3}{4}$  →  √[ ] + [ ]/[ ]   (분수는 가운데 분수선, 위아래 빈칸)
 * 학생 화면에는 빈칸만 보내고(정답 숫자는 서버에만), 낸 숫자는 서버에서 정답 숫자와 비교해 채점한다 (gradeSlots).
 * 틀을 만들 수 없는 정답(숫자가 없거나 모르는 기호)은 null → 예전처럼 자유롭게 쓰는 칸을 쓴다.
 * 이 파일은 서버와 학생 화면이 함께 쓴다 (DB를 쓰지 않음).
 */

export type TNode =
  | { t: "text"; v: string }
  | { t: "slot"; v?: string } // v: 정답 숫자 (서버에서만 들고 있고 학생에게는 지워서 보낸다)
  | { t: "sqrt"; c: TNode[] }
  | { t: "frac"; n: TNode[]; d: TNode[] }
  | { t: "sup"; c: TNode[] };

const SYMBOL: Record<string, string> = {
  pi: "π",
  times: "×",
  cdot: "×",
  div: "÷",
  le: "≤",
  leq: "≤",
  leqslant: "≤",
  ge: "≥",
  geq: "≥",
  geqslant: "≥",
  ne: "≠",
  neq: "≠",
  pm: "±",
  circ: "°",
  degree: "°",
  "%": "%",
  ",": " ",
  ";": " ",
  ":": " ",
  "!": "",
  " ": " ",
  quad: " ",
  qquad: " ",
  left: "",
  right: "",
  displaystyle: "",
};
const TEXT_CMDS = new Set(["text", "mathrm", "textrm", "mbox", "operatorname"]);
const FRAC_CMDS = new Set(["frac", "dfrac", "tfrac"]);
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const SUPER: Record<string, string> = { "2": "²", "3": "³" };

class Fail extends Error {}

/** 정답 → 정답 숫자까지 든 틀 (서버용). 만들 수 없으면 null */
export function answerTemplateWithValues(answer: string): TNode[] | null {
  const src = (answer || "").trim();
  if (!src || src.length > 200) return null;
  try {
    const nodes = merge(parse(src.replace(/\$/g, "")));
    const n = countSlots(nodes);
    return n === 0 || n > 12 ? null : nodes;
  } catch (e) {
    if (e instanceof Fail) return null;
    throw e;
  }
}

/** 학생 화면에 보낼 틀: 정답 숫자를 지운 것 */
export function answerTemplate(answer: string): TNode[] | null {
  const t = answerTemplateWithValues(answer);
  return t && strip(t);
}

function strip(ns: TNode[]): TNode[] {
  return ns.map((x) =>
    x.t === "slot" ? { t: "slot" } : x.t === "sqrt" || x.t === "sup" ? { ...x, c: strip(x.c) } : x.t === "frac" ? { t: "frac", n: strip(x.n), d: strip(x.d) } : x,
  );
}

function parse(s: string): TNode[] {
  let i = 0;
  const braced = (): TNode[] => {
    i++;
    const out = seq("}");
    if (s[i] !== "}") throw new Fail();
    i++;
    return out;
  };
  // { ... } 하나 또는 낱개 하나 (\frac12, x^2 처럼)
  const group = (): TNode[] => {
    while (s[i] === " ") i++;
    if (s[i] === "{") return braced();
    if (i >= s.length) throw new Fail();
    const out: TNode[] = [];
    if (/\d/.test(s[i])) out.push({ t: "slot", v: s[i++] });
    else item(out);
    return out;
  };
  const item = (out: TNode[]) => {
    const ch = s[i];
    if (/\d/.test(ch)) {
      // 숫자 (소수점 포함) 하나가 빈칸 하나
      const m = /^\d+(?:\.\d+)?/.exec(s.slice(i))!;
      i += m[0].length;
      out.push({ t: "slot", v: m[0] });
    } else if (CIRCLED.includes(ch)) {
      i++;
      out.push({ t: "slot", v: String(CIRCLED.indexOf(ch) + 1) });
    } else if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      if (!m) throw new Fail();
      i += m[0].length;
      const cmd = m[1];
      if (FRAC_CMDS.has(cmd)) out.push({ t: "frac", n: group(), d: group() });
      else if (cmd === "sqrt") {
        if (s[i] === "[") throw new Fail(); // 세제곱근 등은 자유 칸으로
        out.push({ t: "sqrt", c: group() });
      } else if (TEXT_CMDS.has(cmd)) {
        // 단위 (km, cm^2) 는 글자 그대로 보여 준다
        const g = group();
        let v = textOf(g);
        const sup = /^\^\{?([23])\}?/.exec(s.slice(i));
        if (sup) {
          v += SUPER[sup[1]];
          i += sup[0].length;
        }
        out.push({ t: "text", v });
      } else if (cmd in SYMBOL) out.push({ t: "text", v: SYMBOL[cmd] });
      else throw new Fail();
    } else if (ch === "^") {
      i++;
      const g = group();
      // 각도 기호 ^\circ 는 거듭제곱이 아니다
      if (g.length === 1 && g[0].t === "text" && g[0].v === "°") out.push(g[0]);
      else out.push({ t: "sup", c: g });
    } else if (ch === "{") out.push(...braced());
    else if (ch === "_" || ch === "&" || ch === "}") throw new Fail();
    else {
      out.push({ t: "text", v: ch === "*" ? "×" : ch });
      i++;
    }
  };
  const seq = (end?: string): TNode[] => {
    const out: TNode[] = [];
    while (i < s.length && s[i] !== end) item(out);
    return out;
  };
  const out = seq();
  if (i < s.length) throw new Fail();
  return out;
}

function textOf(ns: TNode[]): string {
  return ns.map((x) => (x.t === "text" ? x.v : x.t === "slot" ? (x.v ?? "") : "")).join("");
}

export function countSlots(nodes: TNode[]): number {
  let n = 0;
  for (const x of nodes) {
    if (x.t === "slot") n++;
    else if (x.t === "sqrt" || x.t === "sup") n += countSlots(x.c);
    else if (x.t === "frac") n += countSlots(x.n) + countSlots(x.d);
  }
  return n;
}

/** 붙어 있는 글자 조각을 하나로 합친다 */
function merge(nodes: TNode[]): TNode[] {
  const out: TNode[] = [];
  for (const x of nodes) {
    const y: TNode =
      x.t === "sqrt" || x.t === "sup" ? { ...x, c: merge(x.c) } : x.t === "frac" ? { t: "frac", n: merge(x.n), d: merge(x.d) } : x;
    const last = out[out.length - 1];
    if (y.t === "text" && last?.t === "text") last.v = (last.v + y.v).replace(/ {2,}/g, " ");
    else out.push(y.t === "text" ? { ...y } : y);
  }
  return out;
}

/** 빈칸에 넣을 수 있는 글자: 숫자와 소수점만 */
export const cleanSlot = (v: string) => (v || "").replace(/[^\d.]/g, "").slice(0, 12);

/** 학생이 채운 숫자(빈칸 순서대로)로 보여 줄 답 글자를 만든다 (√3+3/4). 빈칸이 하나라도 비면 '' */
export function toAnswer(nodes: TNode[], values: string[]): string {
  let k = 0;
  let empty = false;
  const simple = (ns: TNode[]) => ns.length === 1 && (ns[0].t === "slot" || (ns[0].t === "text" && /^[a-zA-Zπ]$/.test(ns[0].v)));
  const wrap = (ns: TNode[]) => (simple(ns) ? walk(ns) : `(${walk(ns)})`);
  const walk = (ns: TNode[]): string =>
    ns
      .map((x) => {
        if (x.t === "text") return x.v;
        if (x.t === "slot") {
          const v = cleanSlot(values[k++] ?? "");
          if (!v) empty = true;
          return v;
        }
        if (x.t === "sqrt") return `√${wrap(x.c)}`;
        if (x.t === "sup") return `^${wrap(x.c)}`;
        return `${wrap(x.n)}/${wrap(x.d)}`;
      })
      .join("");
  const s = walk(nodes).trim();
  return empty ? "" : s;
}

function slotValues(ns: TNode[]): string[] {
  const out: string[] = [];
  const go = (xs: TNode[]) => {
    for (const x of xs) {
      if (x.t === "slot") out.push(x.v ?? "");
      else if (x.t === "sqrt" || x.t === "sup") go(x.c);
      else if (x.t === "frac") {
        go(x.n);
        go(x.d);
      }
    }
  };
  go(ns);
  return out;
}

const hasShape = (ns: TNode[]): boolean => ns.some((x) => x.t === "frac" || x.t === "sqrt" || x.t === "sup");

/**
 * 틀 답 채점. 정답 틀(answerTemplateWithValues)과 학생 숫자를 받는다.
 *  - 빈칸마다 정답 숫자와 같으면 Y
 *  - 분수·루트·거듭제곱이 없으면 모양이 정해져 있으므로 숫자가 다르면 N
 *    (단, 답이 여러 개라 순서를 바꿔 쓸 수 있으면 같은 숫자 모음인지 본다)
 *  - 분수·루트가 있으면 값으로 계산해 비교 (2/4 = 1/2, 1√12 = 2√3: 글자로 쓰는 칸의 채점과 같게 맞음).
 *    문자는 정해 둔 값을 넣어 계산한다. 계산할 수 없으면 '?' (선생님 확인)
 */
export function gradeSlots(tpl: TNode[], values: string[]): "Y" | "N" | "?" {
  const want = slotValues(tpl);
  const got = want.map((_, i) => cleanSlot(values[i] ?? ""));
  if (got.some((v) => !v)) return "N";
  const same = (a: string, b: string) => Number(a) === Number(b);
  if (want.every((w, i) => same(w, got[i]))) return "Y";
  if (!hasShape(tpl)) {
    // 쉼표로 나뉜 여러 답 ((2,3), (3,2) / x=-1, x=4 처럼)은 순서를 바꿔도 같은 묶음이면 맞음
    const text = textOf(tpl);
    if (/,|또는/.test(text) && sameGroups(tpl, want, got)) return "Y";
    return "N";
  }
  const a = evaluate(tpl, want);
  const b = evaluate(tpl, got);
  if (a === null || b === null || a.length !== b.length) return "?";
  return a.every((x, i) => Math.abs(x - b[i]) <= 1e-9 * Math.max(1, Math.abs(x))) ? "Y" : "N";
}

/** 쉼표·'또는'으로 나뉜 답 묶음끼리 순서 없이 같은지 */
function sameGroups(tpl: TNode[], want: string[], got: string[]): boolean {
  // 최상위 글자에서 묶음 경계를 찾아 빈칸 번호를 묶음별로 나눈다 (괄호 안의 쉼표는 경계가 아니다)
  // 빈칸 앞의 빼기 기호는 틀에 고정되어 있으므로 값에 붙여서 비교한다 (x=-1 또는 x=4 를 x=-4 또는 x=1 로 바꾸면 틀림)
  const groups: { i: number; neg: boolean }[][] = [[]];
  let depth = 0;
  let k = 0;
  let neg = false;
  for (const x of tpl) {
    if (x.t === "slot") {
      groups[groups.length - 1].push({ i: k++, neg });
      neg = false;
    } else if (x.t === "text") {
      neg = /[-−]\s*$/.test(x.v);
      for (const ch of x.v.replace(/또는/g, ",")) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) groups.push([]);
      }
    }
  }
  const key = (vals: string[]) => groups.map((g) => g.map((s) => (s.neg ? -1 : 1) * Number(vals[s.i])).join("|")).sort().join("/");
  return groups.length > 1 && key(want) === key(got);
}

// 문자 자리에 넣어 볼 값 (정답과 학생 답에 같은 값을 넣어 비교한다)
const LETTER_VALUE = (ch: string) => 1.1 + ((ch.charCodeAt(0) * 37) % 101) / 53;

/**
 * 틀을 값으로 계산. = < , 같은 기호나 한글에서 나눠 조각마다 계산한다 (y=2x+3 → [y, 2x+3]).
 * 문자(x, a …)에는 정해 둔 값을 넣는다. 계산할 수 없는 조각이 있으면 null.
 */
export function evaluate(tpl: TNode[], values: string[]): number[] | null {
  let k = 0;
  const parts: string[] = [""];
  const add = (t: string) => (parts[parts.length - 1] += t);
  const emit = (ns: TNode[]) => {
    for (const x of ns) {
      if (x.t === "slot") add(`(${Number(values[k++])})`);
      else if (x.t === "sqrt") {
        add("s(");
        emit(x.c);
        add(")");
      } else if (x.t === "sup") {
        add("^(");
        emit(x.c);
        add(")");
      } else if (x.t === "frac") {
        add("((");
        emit(x.n);
        add(")/(");
        emit(x.d);
        add("))");
      } else {
        for (const ch of x.v) {
          if (ch === " ") continue;
          if (ch === "π") add("p");
          else if ("+-()".includes(ch)) add(ch);
          else if (ch === "−") add("-");
          else if (ch === "×") add("*");
          else if (ch === "÷") add("/");
          else if (/[a-zA-Z]/.test(ch)) add(`(${LETTER_VALUE(ch)})`);
          else parts.push(""); // = < > , 한글 같은 것은 조각을 나누는 자리
        }
      }
    }
  };
  emit(tpl);
  const out: number[] = [];
  for (const e of parts) {
    if (!e) continue;
    try {
      const v = calc(e);
      if (!Number.isFinite(v)) return null;
      out.push(v);
    } catch {
      return null;
    }
  }
  return out.length ? out : null;
}

/** 작은 계산기: + - * / ^ 괄호, s(...) 루트, p 파이, 곱셈 생략 */
function calc(src: string): number {
  let i = 0;
  const peek = () => src[i];
  const startsAtom = (c?: string) => c === "(" || c === "s" || c === "p";
  const atom = (): number => {
    const c = src[i];
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    if (c === "(") {
      i++;
      const v = sum();
      if (src[i++] !== ")") throw new Error();
      return v;
    }
    if (c === "s") {
      i++;
      if (src[i] !== "(") throw new Error();
      return Math.sqrt(atom());
    }
    if (c === "p") {
      i++;
      return Math.PI;
    }
    throw new Error();
  };
  const power = (): number => {
    const b = atom();
    if (peek() === "^") {
      i++;
      return b ** unary();
    }
    return b;
  };
  const unary = (): number => {
    if (peek() === "-") {
      i++;
      return -unary();
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  };
  const product = (): number => {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === "*") {
        i++;
        v *= unary();
      } else if (c === "/") {
        i++;
        v /= unary();
      } else if (startsAtom(c)) v *= power(); // 곱셈 생략: 2√3, 3π
      else return v;
    }
  };
  const sum = (): number => {
    let v = product();
    for (;;) {
      const c = peek();
      if (c === "+") {
        i++;
        v += product();
      } else if (c === "-") {
        i++;
        v -= product();
      } else return v;
    }
  };
  const v = sum();
  if (i !== src.length) throw new Error();
  return v;
}
