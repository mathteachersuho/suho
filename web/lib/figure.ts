/**
 * 좌표평면 그림: AI는 좌표와 식만 적고(<좌표그림>{...}</좌표그림>), 그림은 여기서 계산해서 그린다.
 * 그래서 그래프 위의 점은 정확히 그래프 위에 찍히고, 점 이름 글자는 꼭짓점 바로 옆 빈 곳에 놓인다.
 * 그린 SVG 에는 원래 설정을 data-figure 로 남겨 두어, AI로 고칠 때 다시 설정으로 바꿔 보낸다.
 */

export type FigureSpec = {
  x: [number, number];
  y: [number, number];
  grid?: boolean;
  graphs?: { f?: string; x?: number; label?: string; domain?: [number, number]; dashed?: boolean }[];
  points?: { name?: string; x: number; y?: number; on?: number; label?: string; dot?: boolean }[];
  polygons?: (string | string[])[];
  segments?: [string, string][];
  /** 색칠할 다각형 (없으면 polygons 모두). 색은 맨 뒤에 반투명하게 */
  shade?: (string | string[])[];
  /** 정사각형 "ABCD": A, B 를 기준으로 C, D 를 정확한 정사각형 자리로 맞춘다 */
  squares?: string[];
  /** false 면 축 없이 도형만 (가로세로 같은 비율) */
  axes?: boolean;
};

/* ---------------- 식 계산 (eval 없이) ---------------- */

type Fn = (x: number) => number;
const FUNCS: Record<string, (v: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp,
};

/** "4x", "180/x", "-(x-1)^2+3", "2sqrt(x)" 같은 식을 함수로. 읽을 수 없으면 null. */
export function compile(src: string): Fn | null {
  const s = src.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/√/g, "sqrt");
  let i = 0;
  type Node = (x: number) => number;
  const peek = () => s[i];
  const num = (): Node | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const v = Number(m[0]);
    return () => v;
  };
  const atom = (): Node | null => {
    const c = peek();
    if (c === "(") {
      i++;
      const e = expr();
      if (!e || peek() !== ")") return null;
      i++;
      return e;
    }
    if (c === "|") {
      i++;
      const e = expr();
      if (!e || peek() !== "|") return null;
      i++;
      return (x) => Math.abs(e(x));
    }
    if (/[\d.]/.test(c ?? "")) return num();
    const m = /^[a-z]+/i.exec(s.slice(i));
    if (!m) return null;
    const w = m[0].toLowerCase();
    if (w === "x") return (i++, (x) => x);
    if (w === "pi") return ((i += 2), () => Math.PI);
    if (w === "e") return (i++, () => Math.E);
    const fname = Object.keys(FUNCS).find((k) => w.startsWith(k));
    if (fname) {
      i += fname.length;
      const arg = power();
      if (!arg) return null;
      const f = FUNCS[fname];
      return (x) => f(arg(x));
    }
    if (w.startsWith("x")) return (i++, (x) => x); // "xx" 같은 경우는 곱으로 이어서 읽는다
    return null;
  };
  const power = (): Node | null => {
    const b = atom();
    if (!b) return null;
    if (peek() === "^") {
      i++;
      const e = unary();
      if (!e) return null;
      return (x) => Math.pow(b(x), e(x));
    }
    return b;
  };
  const unary = (): Node | null => {
    if (peek() === "-") {
      i++;
      const v = unary();
      return v && ((x) => -v(x));
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  };
  const term = (): Node | null => {
    let a = unary();
    if (!a) return null;
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") {
        i++;
        const b = unary();
        if (!b) return null;
        const l: Node = a;
        a = c === "*" ? (x) => l(x) * b(x) : (x) => l(x) / b(x);
      } else if (c && /[\d.(a-z|]/i.test(c) && c !== "|") {
        // 4x, 2(x+1), 3sqrt(x) 처럼 곱하기 기호 없이 붙여 쓴 곱
        const b = power();
        if (!b) return null;
        const l: Node = a;
        a = (x) => l(x) * b(x);
      } else return a;
    }
  };
  const expr = (): Node | null => {
    let a = term();
    if (!a) return null;
    while (peek() === "+" || peek() === "-") {
      const c = s[i++];
      const b = term();
      if (!b) return null;
      const l: Node = a;
      a = c === "+" ? (x) => l(x) + b(x) : (x) => l(x) - b(x);
    }
    return a;
  };
  // "y=4x" 처럼 적었으면 오른쪽만
  const eq = s.indexOf("=");
  if (eq >= 0) return compile(s.slice(eq + 1));
  const out = expr();
  return out && i === s.length ? out : null;
}

/* ---------------- 그리기 ---------------- */

const W = 260; // 그림 안쪽 최대 크기(px)
const PAD = 22;
const FONT = 12;
type Box = { x1: number; y1: number; x2: number; y2: number };
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textW = (t: string) => [...t].reduce((a, ch) => a + (/[ㄱ-힝]/.test(ch) ? FONT : /[il.,()' ]/.test(ch) ? FONT * 0.35 : FONT * 0.6), 0);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
/** 그림 속 글자: $ 와 \\ 는 빼고 (문제 글자의 수식 처리와 섞이지 않게) 제곱은 위첨자로 */
const cleanText = (t: string) =>
  t
    .replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:cdot|times)/g, "×")
    .replace(/[$\\{}]/g, "")
    .replace(/\^2/g, "²")
    .replace(/\^3/g, "³")
    .replace(/\*/g, "");

/** 글자 한 조각: 보통 글자 또는 분수(위아래로 쌓아 그림) */
type Piece = { k: "t"; s: string } | { k: "f"; n: string; d: string };
/** 그림 속 글자 하나: 크기와 그리는 법 */
type Label = { w: number; h: number; draw: (x1: number, y1: number) => string };

const SMALL = FONT * 0.85;
const unwrap = (t: string) => (/^\([^()]*\)$/.test(t) ? t.slice(1, -1) : t);
/** "y=\frac{12}{x}" 나 "y=12/x" 의 분수를 위아래로 쌓은 분수 조각으로 나눈다 */
function pieces(raw: unknown, max: number): Piece[] {
  const src = String(raw ?? "").slice(0, max * 4);
  const out: Piece[] = [];
  let used = 0;
  const pushText = (t: string) => {
    // 글자 속 a/b 도 분수로 (분자: 숫자·문자 묶음이나 괄호, 분모: 수 하나·문자 하나·괄호)
    const re = /([0-9a-zA-Z.]+|\([^()]*\))\/(\d+(?:\.\d+)?|[a-zA-Z]|\([^()]*\))/g;
    let at = 0;
    for (const m of t.matchAll(re)) {
      if (m.index! > at) out.push({ k: "t", s: t.slice(at, m.index) });
      out.push({ k: "f", n: unwrap(m[1]), d: unwrap(m[2]) });
      at = m.index! + m[0].length;
    }
    if (at < t.length) out.push({ k: "t", s: t.slice(at) });
  };
  const re = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
  let at = 0;
  for (const m of src.matchAll(re)) {
    pushText(cleanText(src.slice(at, m.index)));
    out.push({ k: "f", n: cleanText(m[1]), d: cleanText(m[2]) });
    at = m.index! + m[0].length;
  }
  pushText(cleanText(src.slice(at)));
  // 길이 제한 (보이는 글자 수 기준)
  return out
    .map((p) => {
      const left = Math.max(0, max - used);
      if (p.k === "t") {
        used += p.s.length;
        return { ...p, s: p.s.slice(0, left) };
      }
      used += Math.max(p.n.length, p.d.length);
      return left > 0 ? p : { k: "t" as const, s: "" };
    })
    .filter((p) => (p.k === "t" ? p.s : p.n || p.d));
}

function makeLabel(raw: unknown, max: number, italic = false): Label | null {
  const ps = pieces(raw, max);
  if (!ps.length) return null;
  const hasFrac = ps.some((p) => p.k === "f");
  const pw = (p: Piece) => (p.k === "t" ? textW(p.s) : Math.max(textW(p.n), textW(p.d)) * (SMALL / FONT) + 3);
  const w = ps.reduce((a, p) => a + pw(p), 0);
  const h = hasFrac ? FONT * 2 + 1 : FONT;
  const it = italic ? ' font-style="italic"' : "";
  const draw = (x1: number, y1: number) => {
    const base = y1 + h / 2 + FONT * 0.35;
    const axis = base - FONT * 0.32;
    let x = x1;
    const out: string[] = [];
    for (const p of ps) {
      const pwid = pw(p);
      if (p.k === "t") out.push(`<text x="${fmt(x)}" y="${fmt(base)}" font-size="${FONT}" fill="#000000"${it}>${esc(p.s.replace(/ /g, "\u00a0"))}</text>`);
      else {
        const mid = x + pwid / 2;
        out.push(
          `<text x="${fmt(mid)}" y="${fmt(axis - 2)}" font-size="${fmt(SMALL)}" fill="#000000" text-anchor="middle">${esc(p.n)}</text>`,
          `<line x1="${fmt(x + 0.5)}" y1="${fmt(axis)}" x2="${fmt(x + pwid - 0.5)}" y2="${fmt(axis)}" stroke="#000000" stroke-width="0.9"/>`,
          `<text x="${fmt(mid)}" y="${fmt(axis + 2 + SMALL * 0.74)}" font-size="${fmt(SMALL)}" fill="#000000" text-anchor="middle">${esc(p.d)}</text>`,
        );
      }
      x += pwid;
    }
    return out.join("");
  };
  return { w, h, draw };
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);

function range(v: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) return fallback;
  const a = num(v[0]);
  const b = num(v[1]);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : fallback;
}

/** 설정 → SVG. 설정이 잘못됐으면 오류를 던진다. */
type Pt = { name: string; x: number; y: number; label: unknown; dot: boolean };

/** 점 좌표를 모두 계산한다: 그래프 위의 점은 y를 식으로, 정사각형은 C·D를 A·B로 맞춘다 */
function resolvePoints(spec: FigureSpec): Pt[] {
  const fns = (Array.isArray(spec.graphs) ? spec.graphs : []).slice(0, 8).map((g) => {
    const vx = num(g?.x);
    if (Number.isFinite(vx) && !g?.f) return { vx };
    return typeof g?.f === "string" ? compile(g.f) : null;
  });
  const squares = (Array.isArray(spec.squares) ? spec.squares : []).filter((q): q is string => typeof q === "string").slice(0, 6);
  const out: Pt[] = [];
  for (const p of (Array.isArray(spec.points) ? spec.points : []).slice(0, 26)) {
    let x = num(p?.x);
    let y = num(p?.y);
    const on = typeof p?.on === "number" ? fns[p.on] : undefined;
    if (on && typeof on === "object") x = on.vx;
    else if (typeof on === "function" && Number.isFinite(x)) y = on(x);
    const name = String(p?.name ?? "").slice(0, 3);
    out.push({ name, x, y, label: p?.label ?? name, dot: p?.dot !== false });
  }
  const get = (n: string) => out.find((q) => q.name === n);
  for (const sq of squares) {
    const vs = [...sq];
    if (vs.length !== 4) continue;
    const [a, b, c, d] = vs.map(get);
    if (!a || !b || !Number.isFinite(a.x + a.y + b.x + b.y)) continue;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    // 왼쪽(시계 반대)과 오른쪽(시계) 중 AI가 적은 C 에 가까운 쪽으로
    const left: [number, number] = [-vy, vx];
    const right: [number, number] = [vy, -vx];
    let n = left;
    if (c && Number.isFinite(c.x + c.y)) {
      const dl = Math.hypot(b.x + left[0] - c.x, b.y + left[1] - c.y);
      const dr = Math.hypot(b.x + right[0] - c.x, b.y + right[1] - c.y);
      if (dr < dl) n = right;
    }
    const put = (q: Pt | undefined, name: string, x: number, y: number) => {
      if (q) {
        q.x = x;
        q.y = y;
      } else out.push({ name, x, y, label: name, dot: true });
    };
    put(c, vs[2], b.x + n[0], b.y + n[1]);
    put(d, vs[3], a.x + n[0], a.y + n[1]);
  }
  for (const q of out) if (!Number.isFinite(q.x + q.y)) throw new Error(`점 ${q.name}의 좌표가 없어요`);
  return out;
}

/** 축 없는 도형 그림: 범위를 안 적었으면 점들이 다 들어가게 */
function autoRange(v: unknown, vals: number[], fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length === 2) return range(v, fallback);
  if (!vals.length) return fallback;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const m = Math.max((hi - lo) * 0.12, 0.5);
  return [lo - m, hi + m];
}

/** 설정 → SVG. 설정이 잘못됐으면 오류를 던진다. */
export function renderFigure(raw: unknown): string {
  if (!raw || typeof raw !== "object") throw new Error("그림 설정이 비어 있어요");
  const spec = raw as FigureSpec;
  const axes = spec.axes !== false;
  const resolved = resolvePoints(spec);
  const [x0, x1] = axes ? range(spec.x, [-5, 5]) : autoRange(spec.x, resolved.map((q) => q.x), [-5, 5]);
  const [y0, y1] = axes ? range(spec.y, [-5, 5]) : autoRange(spec.y, resolved.map((q) => q.y), [-5, 5]);
  const rx = x1 - x0;
  const ry = y1 - y0;
  // 같은 비율로 그려야 정사각형이 정사각형으로 보인다. 가로세로 차이가 너무 크면 각각 맞춘다 (축 없는 도형은 늘 같은 비율).
  let kx = W / Math.max(rx, ry);
  let ky = kx;
  if (axes && (rx / ry > 2.5 || ry / rx > 2.5)) {
    kx = W / rx;
    ky = W / ry;
  }
  const w = rx * kx + PAD * 2;
  const h = ry * ky + PAD * 2;
  const X = (x: number) => PAD + (x - x0) * kx;
  const Y = (y: number) => PAD + (y1 - y) * ky;

  const parts: string[] = [];
  const obstacles: (Box & { own?: string })[] = []; // 글자를 놓을 때 피할 곳 (선, 점, 다른 글자). own = 어느 선인지
  const lineBoxes = (pts: [number, number][], own = "line") => {
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1];
      const [bx, by] = pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let t = 0; t <= n; t++) {
        const px = ax + ((bx - ax) * t) / n;
        const py = ay + ((by - ay) * t) / n;
        obstacles.push({ x1: px - 1.5, y1: py - 1.5, x2: px + 1.5, y2: py + 1.5, own });
      }
    }
  };

  // 격자
  if (spec.grid && rx <= 30 && ry <= 30) {
    const g: string[] = [];
    for (let v = Math.ceil(x0); v <= x1; v++) g.push(`<line x1="${fmt(X(v))}" y1="${fmt(Y(y0))}" x2="${fmt(X(v))}" y2="${fmt(Y(y1))}"/>`);
    for (let v = Math.ceil(y0); v <= y1; v++) g.push(`<line x1="${fmt(X(x0))}" y1="${fmt(Y(v))}" x2="${fmt(X(x1))}" y2="${fmt(Y(v))}"/>`);
    parts.push(`<g stroke="#dddddd" stroke-width="1">${g.join("")}</g>`);
  }

  // 색칠은 맨 뒤에 (선과 글자를 가리지 않게)
  const back: string[] = [];
  // 축 (화살표 포함)
  const axisY = y0 <= 0 && y1 >= 0 ? 0 : y0 > 0 ? y0 : y1;
  const axisX = x0 <= 0 && x1 >= 0 ? 0 : x0 > 0 ? x0 : x1;
  const ax1 = X(x0) - 6;
  const ax2 = X(x1) + 8;
  const ay = Y(axisY);
  const by1 = Y(y1) - 8;
  const by2 = Y(y0) + 6;
  const bx = X(axisX);
  if (axes)
    parts.push(
      `<g stroke="#000000" stroke-width="1.2"><line x1="${fmt(ax1)}" y1="${fmt(ay)}" x2="${fmt(ax2)}" y2="${fmt(ay)}"/><line x1="${fmt(bx)}" y1="${fmt(by2)}" x2="${fmt(bx)}" y2="${fmt(by1)}"/></g>`,
      `<polygon points="${fmt(ax2 + 2)},${fmt(ay)} ${fmt(ax2 - 5)},${fmt(ay - 3.5)} ${fmt(ax2 - 5)},${fmt(ay + 3.5)}" fill="#000000"/>`,
      `<polygon points="${fmt(bx)},${fmt(by1 - 2)} ${fmt(bx - 3.5)},${fmt(by1 + 5)} ${fmt(bx + 3.5)},${fmt(by1 + 5)}" fill="#000000"/>`,
    );
  if (axes) {
    lineBoxes([[ax1, ay], [ax2, ay]]);
    lineBoxes([[bx, by1], [bx, by2]]);
  }

  // 그래프
  const graphs = (Array.isArray(spec.graphs) ? spec.graphs : []).slice(0, 8);
  const fns: (Fn | { vx: number } | null)[] = [];
  const curves: [number, number][][][] = []; // 그래프마다 화면 좌표 조각들
  for (const g of graphs) {
    const vx = num(g?.x);
    if (Number.isFinite(vx) && !g?.f) {
      fns.push({ vx });
      const seg: [number, number][] = [[X(vx), Y(y0)], [X(vx), Y(y1)]];
      curves.push([seg]);
      continue;
    }
    const f = typeof g?.f === "string" ? compile(g.f) : null;
    if (!f) throw new Error(`식을 읽지 못했어요: ${String(g?.f ?? "")}`);
    fns.push(f);
    const [d0, d1] = range(g.domain, [x0, x1]);
    const lo = Math.max(d0, x0);
    const hi = Math.min(d1, x1);
    const N = 480;
    const pieces: [number, number][][] = [];
    let cur: [number, number][] = [];
    let prev: [number, number] | null = null;
    const flush = () => {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    };
    for (let k = 0; k <= N; k++) {
      const x = lo + ((hi - lo) * k) / N;
      const y = f(x);
      if (!Number.isFinite(y)) {
        flush();
        prev = null;
        continue;
      }
      if (prev) {
        const [px, py] = prev;
        if (Math.abs(y - py) > ry * 3) flush(); // 점근선을 건너뛰는 큰 점프는 잇지 않는다
        else {
          // 선분을 보이는 y 범위로 자른다
          let t0 = 0;
          let t1 = 1;
          const dy = y - py;
          if (dy === 0) {
            if (py < y0 || py > y1) t0 = 2;
          } else {
            const ta = (y0 - py) / dy;
            const tb = (y1 - py) / dy;
            t0 = Math.max(t0, Math.min(ta, tb));
            t1 = Math.min(t1, Math.max(ta, tb));
          }
          if (t0 <= t1) {
            const a: [number, number] = [X(px + (x - px) * t0), Y(py + dy * t0)];
            const b: [number, number] = [X(px + (x - px) * t1), Y(py + dy * t1)];
            const last = cur[cur.length - 1];
            if (!last || Math.abs(last[0] - a[0]) > 0.01 || Math.abs(last[1] - a[1]) > 0.01) {
              flush();
              cur.push(a);
            }
            cur.push(b);
          } else flush();
        }
      }
      prev = [x, y];
    }
    if (cur.length > 1) pieces.push(cur);
    curves.push(pieces);
  }
  graphs.forEach((g, gi) => {
    const dash = g?.dashed ? ` stroke-dasharray="4 3"` : "";
    for (const p of curves[gi]) {
      parts.push(`<polyline points="${p.map(([a, b]) => `${fmt(a)},${fmt(b)}`).join(" ")}" fill="none" stroke="#000000" stroke-width="1.4"${dash}/>`);
      lineBoxes(p, `g${gi}`);
    }
  });

  // 점 (그래프 위의 점은 y를 계산해서 정확히)
  const pts = new Map<string, [number, number]>();
  const shown: { name: string; label: Label | null; px: number; py: number; dot: boolean }[] = [];
  for (const p of resolved) {
    if (p.name) pts.set(p.name, [p.x, p.y]);
    shown.push({ name: p.name, label: makeLabel(p.label, 20), px: X(p.x), py: Y(p.y), dot: p.dot });
  }
  const P = (n: string) => {
    const v = pts.get(n);
    if (!v) throw new Error(`점 ${n}이 없어요`);
    return [X(v[0]), Y(v[1])] as [number, number];
  };
  const names = (v: string | string[]) => (Array.isArray(v) ? v.map(String) : [...String(v)].filter((c) => pts.has(c)));

  // 다각형과 선분
  const polys: [number, number][][] = [];
  const key = (v: string | string[]) => names(v).join("");
  const polyList = (Array.isArray(spec.polygons) ? spec.polygons : []).slice(0, 8);
  const shadeList = Array.isArray(spec.shade) ? spec.shade.slice(0, 6) : null;
  const shaded = new Set((shadeList ?? polyList).map(key));
  // 색칠만 적고 polygons 에 없는 도형도 테두리를 그린다
  for (const sh of shadeList ?? []) if (!polyList.some((q) => key(q) === key(sh))) polyList.push(sh);
  const ptsAttr = (vs: [number, number][]) => vs.map(([a, b]) => `${fmt(a)},${fmt(b)}`).join(" ");
  for (const poly of polyList) {
    const vs = names(poly).map(P);
    if (vs.length < 3) continue;
    polys.push(vs);
    if (shaded.has(key(poly))) {
      back.push(`<polygon points="${ptsAttr(vs)}" fill="#7f9cf5" fill-opacity="0.25" stroke="none"/>`);
    }
    parts.push(`<polygon points="${ptsAttr(vs)}" fill="none" stroke="#000000" stroke-width="1.3"/>`);
    lineBoxes([...vs, vs[0]]);
  }
  for (const s of (Array.isArray(spec.segments) ? spec.segments : []).slice(0, 12)) {
    if (!Array.isArray(s) || s.length !== 2) continue;
    const a = P(String(s[0]));
    const b = P(String(s[1]));
    parts.push(`<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="#000000" stroke-width="1.2"/>`);
    lineBoxes([a, b]);
  }
  for (const s of shown) {
    if (s.dot) {
      parts.push(`<circle cx="${fmt(s.px)}" cy="${fmt(s.py)}" r="2.6" fill="#000000"/>`);
      obstacles.push({ x1: s.px - 3, y1: s.py - 3, x2: s.px + 3, y2: s.py + 3 });
    }
  }

  // 글자 놓기: 점 둘레 여러 자리 중 선·글자와 덜 겹치고 도형 바깥쪽인 자리를 고른다
  const labels: string[] = [];
  const view: Box = { x1: 2, y1: 2, x2: w - 2, y2: h - 2 };
  const inPoly = (x: number, y: number) =>
    polys.some((vs) => {
      let c = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i];
        const [xj, yj] = vs[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    });
  /** 점 (cx, cy) 둘레에서 글자를 놓기 가장 좋은 자리와 점수 (낮을수록 좋다) */
  const bestSpot = (lab: Label, cx: number, cy: number, away: [number, number] | null, dist: number, self?: string) => {
    const tw = lab.w;
    const th = lab.h;
    let best: { box: Box; score: number } | null = null;
    for (let a = 0; a < 16; a++) {
      const ang = (Math.PI * 2 * a) / 16;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      for (const r of [dist, dist + 5, dist + 11]) {
        // 글자 상자의 가장 가까운 모서리가 점에서 r 만큼 떨어지게
        const bx = cx + dx * r + (dx >= 0 ? 0 : -tw) + (Math.abs(dx) < 0.38 ? (dx >= 0 ? -tw / 2 : tw / 2) : 0);
        const byTop = cy + dy * r + (dy >= 0 ? 0 : -th) + (Math.abs(dy) < 0.38 ? (dy >= 0 ? -th / 2 : th / 2) : 0);
        const box = { x1: bx, y1: byTop, x2: bx + tw, y2: byTop + th };
        let score = r - dist; // 가까울수록 좋다
        for (const o of obstacles) score += overlap(box, o) * 4;
        const outside = Math.max(0, view.x1 - box.x1) + Math.max(0, box.x2 - view.x2) + Math.max(0, view.y1 - box.y1) + Math.max(0, box.y2 - view.y2);
        score += outside * 40;
        if (self) {
          // 그래프 이름은 다른 선 가까이에 두지 않는다 (어느 선의 이름인지 헷갈리지 않게)
          const near = { x1: box.x1 - 9, y1: box.y1 - 9, x2: box.x2 + 9, y2: box.y2 + 9 };
          for (const o of obstacles) if (o.own && o.own !== self && overlap(near, o) > 0) score += 2;
        }
        if (inPoly((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2)) score += 30; // 색칠한 도형 안은 피한다
        if (away) score += -(dx * away[0] + dy * away[1]) * 6; // 도형 안쪽 말고 바깥쪽으로
        if (!best || score < best.score) best = { box, score };
      }
    }
    return best!;
  };
  const commit = (lab: Label, b: Box) => {
    obstacles.push(b);
    labels.push(lab.draw(b.x1, b.y1));
  };
  const place = (lab: Label | null, cx: number, cy: number, away: [number, number] | null, dist = 9) => {
    if (lab) commit(lab, bestSpot(lab, cx, cy, away, dist).box);
  };
  // 도형의 꼭짓점이면 도형 중심 반대쪽으로
  const awayFrom = (px: number, py: number): [number, number] | null => {
    for (const vs of polys) {
      if (vs.some(([a, b]) => Math.abs(a - px) < 0.5 && Math.abs(b - py) < 0.5)) {
        const cx = vs.reduce((s, v) => s + v[0], 0) / vs.length;
        const cy = vs.reduce((s, v) => s + v[1], 0) / vs.length;
        const d = Math.hypot(px - cx, py - cy) || 1;
        return [(px - cx) / d, (py - cy) / d];
      }
    }
    return null;
  };
  // 축 이름과 원점
  if (axes) {
    place(makeLabel("x", 1, true), ax2 + 2, ay, [1, 0.3], 4);
    place(makeLabel("y", 1, true), bx, by1 - 2, [0.3, -1], 4);
  }
  const originShown = axes && x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0 && !shown.some((s) => s.name === "O");
  if (originShown) place(makeLabel("O", 1), X(0), Y(0), [-0.7, 0.7], 5);
  for (const s of shown) place(s.label, s.px, s.py, awayFrom(s.px, s.py));
  // 그래프 이름: 곡선 끝 쪽 빈 곳
  graphs.forEach((g, gi) => {
    const label = makeLabel(g?.label, 24);
    const pieces = curves[gi];
    if (!label || !pieces?.length) return;
    // 곡선 위 여러 곳 중 글자가 가장 덜 겹치는 곳 (끝 쪽을 조금 더 좋아한다)
    let best: { box: Box; score: number } | null = null;
    for (const piece of pieces)
      for (const t of [0.95, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1]) {
        const at = piece[Math.floor((piece.length - 1) * t)];
        const spot = bestSpot(label, at[0], at[1], null, 6, `g${gi}`);
        const score = spot.score + (1 - t) * 3;
        if (!best || score < best.score) best = { box: spot.box, score };
      }
    if (best) commit(label, best.box);
  });

  const data = esc(JSON.stringify(spec).replace(/\$/g, ""));
  return `<svg width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" font-family="sans-serif" data-figure="${data}">${back.join("")}${parts.join("")}${labels.join("")}</svg>`;
}

const BLOCK = /(?:```[a-z]*\s*)?<좌표그림>([\s\S]*?)<\/좌표그림>(?:\s*```)?/g;

/** AI가 쓴 <좌표그림> 블록을 SVG로 바꾼다. 잘못된 설정이면 그 자리에 안내 문구를 남긴다. */
export function renderFigureBlocks(text: string): string {
  return text.replace(BLOCK, (_m, body: string) => {
    try {
      const json = body.trim().replace(/^```(?:json)?|```$/g, "").replace(/,\s*([}\]])/g, "$1");
      return renderFigure(JSON.parse(json));
    } catch (e) {
      return `[그림을 그리지 못했어요${e instanceof Error && !(e instanceof SyntaxError) ? `: ${e.message}` : ""} · 다시 만들기나 AI로 고치기를 눌러 주세요]`;
    }
  });
}

/** 앱이 그린 좌표 그림 SVG를 다시 <좌표그림> 설정으로 (AI로 고칠 때 보내기 위해) */
export function figuresToBlocks(text: string): string {
  return text.replace(/<svg\b[^>]*\bdata-figure="([^"]*)"[^>]*>[\s\S]*?<\/svg>/g, (_m, data: string) => {
    const json = data.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return `<좌표그림>\n${json}\n</좌표그림>`;
  });
}

/* ---------------- AI가 직접 그린 SVG: 색칠은 맨 뒤에 반투명하게 ---------------- */

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", none: "", transparent: "" };
/** 색칠(밝은 색·옅은 색)인지: 검정·흰색·없음은 아니다 */
function isShade(fill: string) {
  const f = fill.trim().toLowerCase();
  const hex = f in NAMED ? NAMED[f] : f;
  if (!hex) return false;
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return !/^url\(/.test(hex); // 이름 색(lightblue 등)은 색칠로 본다, 무늬(url)는 그대로
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.3 && l < 0.97;
}

const SHAPE = /<(polygon|path|rect|circle|ellipse)\b([^>]*?)\/>/g;
const fillOf = (attrs: string) => attrs.match(/\bfill="([^"]*)"/)?.[1] ?? attrs.match(/fill\s*:\s*([^;"]+)/)?.[1] ?? "";

/** 색칠한 도형의 색만 SVG 맨 뒤(먼저 그리는 곳)로 옮기고 반투명하게. 테두리는 제자리에 남겨 선·글자가 가려지지 않게 한다. */
export function shadeBehind(text: string): string {
  return text.replace(/(<svg\b[^>]*>)([\s\S]*?)(<\/svg>)/g, (all, open: string, body: string, close: string) => {
    if (/data-figure=/.test(open)) return all;
    const back: string[] = [];
    const rest = body.replace(SHAPE, (el, tag: string, attrs: string) => {
      if (!isShade(fillOf(attrs))) return el;
      const plain = attrs.replace(/\s*\b(?:fill-opacity|opacity)="[^"]*"/g, "").replace(/fill\s*:\s*[^;"]+;?/g, "");
      back.push(`<${tag}${plain.replace(/\bstroke="[^"]*"/g, "").replace(/\bstroke-width="[^"]*"/g, "")} stroke="none" fill-opacity="0.3"/>`);
      const stroke = attrs.match(/\bstroke="([^"]*)"/)?.[1];
      // 테두리가 있으면 제자리에 테두리만 남긴다
      return stroke && stroke !== "none" ? `<${tag}${plain.replace(/\bfill="[^"]*"/, 'fill="none"')}/>` : "";
    });
    if (!back.length) return all;
    // 정의(defs)와 흰 바탕 사각형 뒤, 다른 모든 것 앞에
    const lead = rest.match(/^\s*(?:<defs\b[\s\S]*?<\/defs>\s*)?(?:<rect\b[^>]*fill="(?:#fff|#ffffff|white)"[^>]*\/>\s*)?/i)?.[0] ?? "";
    return open + lead + back.join("") + rest.slice(lead.length) + close;
  });
}
