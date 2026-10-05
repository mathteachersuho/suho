import "server-only";
import katex from "katex";
import sanitizeHtml from "sanitize-html";

/*
 * 문제 글자를 화면용 HTML로 바꾼다.
 * 1) formatMath: Streamlit app.py 의 format_math 를 그대로 옮긴 정리 단계 (표, 카드, 그림, OCR 오인식 고치기)
 * 2) renderProblemHtml: $...$ 수식은 KaTeX로 그리고, 나머지 HTML은 허용한 태그만 남긴다.
 * 수식은 서버에서 미리 그려서 보내므로 화면이 깜빡이지 않고, 인쇄할 때도 그대로 나온다.
 */

const CELL_FRAC = /([+-]?)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g;

function convertFracToHtml(text: string) {
  return text.replace(
    CELL_FRAC,
    (_m, sign: string, num: string, den: string) =>
      `${sign || ""}<span style="display:inline-flex; flex-direction:column; vertical-align:middle; text-align:center; font-size:12px; line-height:1.1; margin:0 2px;"><span style="border-bottom:1.5px solid currentColor; padding:0 1px;">${num.trim()}</span><span>${den.trim()}</span></span>`,
  );
}

function cleanCell(col: string) {
  col = col.trim();
  if (col.startsWith("$") && col.endsWith("$")) col = col.slice(1, -1).trim();
  return convertFracToHtml(col).replaceAll("$", "");
}

function plainTable(rows: string[][]) {
  let html =
    '<div class="mt-table"><table style="border-collapse: collapse; margin: 0 auto; text-align: center; font-size: 13.5px; border: 1px solid #777;">';
  rows.forEach((row, i) => {
    html += "<tr>";
    for (const col of row) {
      const head = i === 0 ? " font-weight: bold; background-color: rgba(127,127,127,0.12);" : "";
      html += `<td style="border: 1px solid #777; padding: 5px 12px;${head}">${cleanCell(col)}</td>`;
    }
    html += "</tr>";
  });
  return html + "</table></div>";
}

function mdTableToHtml(lines: string[]) {
  const rows = lines
    .filter((l) => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(l))
    .map((l) => l.replace(/^\|+|\|+$/g, "").split("|").map((c) => c.trim()));
  if (!rows.length) return "";
  const hasEmpty = rows.some((r) => r.some((c) => cleanCell(c) === ""));
  if (!hasEmpty) return plainTable(rows);
  // 빈 칸이 있는 표 = 전개도/칸 채우기 그림: 빈 칸은 투명, 채운 칸은 굵은 네모
  let html = '<div class="mt-table"><table style="border-collapse: collapse; margin: 0 auto; text-align: center; font-size: 14.5px;">';
  for (const row of rows) {
    html += "<tr>";
    for (const col of row) {
      const c = cleanCell(col);
      html += c
        ? `<td style="border: 2px solid currentColor; width: 44px; height: 44px; padding: 4px; font-weight: bold; text-align: center; vertical-align: middle;">${c}</td>`
        : '<td style="border: none; width: 44px; height: 44px; padding: 2px;"></td>';
    }
    html += "</tr>";
  }
  return html + "</table></div>";
}

/** app.py format_math 와 같은 순서로 정리한다 (살균은 renderProblemHtml 에서). */
export function formatMath(input: string): string {
  if (!input) return "";
  let text = String(input);

  // 0. 코드블록에 싸인 SVG 풀기
  text = text.replace(/```(?:html|xml|svg)?\s*(<svg[\s\S]*?<\/svg>)\s*```/g, (_m, s: string) => s);

  // 0-1. OCR 기호 오인식
  text = text.replaceAll("\\neg", "ㄱ").replaceAll("\\llcorner", "ㄴ");
  text = text.replace(/\{\s*\(\s*ㄱ\s*\)\s*\(\s*ㄴ\s*\)\s*\}*/g, "㉠ ㉡");
  text = text.replace(/\(\s*ㄱ\s*\)/g, "㉠").replace(/\(\s*ㄴ\s*\)/g, "㉡");
  text = text.replace(/\(\s*ㄷ\s*\)/g, "㉢").replace(/\(\s*ㄹ\s*\)/g, "㉣");

  // 1. 줄바꿈 기호, 글자 한 개짜리 수식
  text = text.replaceAll("[br]", "\n\n");
  text = text.replace(
    /\$([a-zA-Z0-9])\$\s*(모둠|반|팀|그룹|등|점|명|개|권|초|분|시간|원|cm|m)/g,
    (_m, a: string, b: string) => `${a} ${b}`,
  );
  text = text.replace(/\$([a-zA-Z])\$/g, (_m, a: string) => a);

  // 2. LaTeX tabular → 표
  text = text.replace(
    /\\begin\{tabular\}(?:\[[^\]]*\])?(?:\{[^}]*\})([\s\S]*?)\\end\{tabular\}/g,
    (_m, content: string) => {
      const rows = content
        .replaceAll("\\hline", "")
        .split("\\\\")
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => r.split("&").map((c) => c.trim()));
      return rows.length ? plainTable(rows) : "";
    },
  );

  // 3. 마크다운 표 → 표
  const out: string[] = [];
  let table: string[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.startsWith("|") && s.endsWith("|")) {
      table.push(s);
      continue;
    }
    if (table.length) {
      out.push(mdTableToHtml(table));
      table = [];
    }
    out.push(line);
  }
  if (table.length) out.push(mdTableToHtml(table));
  text = out.join("\n");

  // 4. $$...$$ → $...$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, a: string) => "$" + a + "$");

  // 5. 빈칸 기호 → 네모 박스
  const boxed = (_m: string, a: string) => "$\\boxed{\\text{ (" + a + ") }}$";
  text = text.replace(/[□■]\s*\(([가-힣a-zA-Z0-9]+)\)/g, boxed);
  text = text.replace(/\[\s*\(([가-힣a-zA-Z0-9]+)\)\s*\]/g, boxed);

  // 6. 명령어 앞 겹친 백슬래시
  for (let i = 0; i < 2; i++) text = text.replace(/\\\\([a-zA-Z{}])/g, (_m, a: string) => "\\" + a);

  // 7. 도형, 극한, 분수 오인식
  text = text.replace(/\\mathrm\{([A-Z]+)\}/g, (_m, a: string) => a);
  text = text.replace(/lim_?\{?xtoa\}?/g, () => "\\lim\\limits_{x \\to a} ");
  text = text.replace(/lim_?\{?x\s*to\s*([a-zA-Z0-9]+)\}?/g, (_m, a: string) => "\\lim\\limits_{x \\to " + a + "} ");
  text = text.replace(/\\lim\s*its/g, () => "\\lim\\limits");
  text = text.replace(/\\lim(?![a-zA-Z])(?!\s*\\limits)/g, () => "\\lim\\limits");
  text = text.replace(/(\\lim\\limits\s*)+/g, () => "\\lim\\limits ");
  text = text.replace(/\bfrac([0-9])([0-9])\b/g, (_m, a: string, b: string) => `\\frac{${a}}{${b}}`);
  text = text.replace(/\bfracf\(x\)g\(x\)/g, () => "\\frac{f(x)}{g(x)}");
  text = text.replace(/\bfracg\(x\)f\(x\)/g, () => "\\frac{g(x)}{f(x)}");
  text = text.replace(/(?<!\\)\bfrac\{/g, () => "\\frac{");
  text = text
    .replaceAll("\x0c", "\\f")
    .replaceAll("♀rac", "\\frac")
    .replaceAll("♀", "\\f")
    .replaceAll("\x08", "\\b")
    .replaceAll("\x07", "\\a")
    .replaceAll("\x0b", "\\v");
  text = text.replace(/(\b[a-zA-Z]\b)\s+o\s+(\d+|[a-zA-Z])/g, (_m, a: string, b: string) => `${a} \\to ${b}`);
  text = text.replace(/\bight\b/g, () => "\\right");

  // 8. $ 없이 드러난 수식 감싸기 (표, 그림 안은 건드리지 않음)
  const parts = text.split("$").map((part, i) => {
    if (i % 2 === 1 || part.includes("<svg") || part.includes("<table")) return part;
    part = part.replace(
      /(\\[a-zA-Z]+(?:\{[^{}]*\}|[\w\s+\-*/=<>(),._^\\{}]*?))(?=[가-힣\n\r<]|$)/g,
      (_m, g: string) => {
        const chunk = g.trimEnd();
        return chunk ? "$" + chunk + "$" : "";
      },
    );
    return part.replace(/(?<![$\\])\b([fgh]'?\([a-zA-Z\d+\-*/]*\))(?![$\\])/g, (_m, a: string) => "$" + a + "$");
  });
  text = parts.join("$");
  text = text.replace(/\$\s*\$/g, "").replace(/\${3,}/g, () => "$$");

  // 9. [카드: 1, 2, 3] → 숫자 카드
  text = text.replace(/\[카드\s*:\s*([^\]]+)\]/g, (_m, list: string) => {
    const items = list.split(",").map((x) => x.trim()).filter(Boolean);
    return (
      '<span class="mt-cards">' +
      items.map((x) => `<span class="mt-card">${x}</span>`).join("") +
      "</span>"
    );
  });

  // 10. SVG 그림을 흰 카드로 감싸기 (다크 모드에서도 그림이 보이도록)
  text = text.replace(/(<svg[\s\S]*?<\/svg>)/g, (svg: string) => `<div class="mt-figure"><div>${svg}</div></div>`);
  return text;
}

const SVG_TAGS = [
  "svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan",
  "defs", "marker", "use", "title", "lineargradient", "radialgradient", "stop", "pattern", "clippath",
];
const HTML_TAGS = ["div", "span", "p", "br", "b", "strong", "i", "em", "u", "sup", "sub", "table", "thead", "tbody", "tr", "td", "th"];
const ALLOWED_TAGS = [...HTML_TAGS, ...SVG_TAGS];
const SVG_ATTRS = [
  "width", "height", "viewbox", "xmlns", "preserveaspectratio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "stroke-opacity", "opacity", "transform", "font-size", "font-family", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "alignment-baseline", "dx", "dy", "id", "marker-end", "marker-start", "marker-mid", "markerwidth",
  "markerheight", "refx", "refy", "orient", "markerunits", "offset", "stop-color", "stop-opacity", "gradientunits",
  "patternunits", "clip-path", "letter-spacing",
];
// 알려진 태그가 아닌 '<' 는 글자로 바꾼다 (x<y 같은 부등호가 태그로 오해받아 사라지지 않도록)
const STRAY_LT = new RegExp(`<(?!/?(?:${ALLOWED_TAGS.join("|")})\\b)`, "gi");
const BAD_STYLE = /url\s*\(|expression\s*\(|javascript:|@import/i;

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    "*": ["style", "class", "colspan", "rowspan", "align"],
    ...Object.fromEntries(SVG_TAGS.map((t) => [t, SVG_ATTRS])),
  },
  allowedSchemes: [],
  allowVulnerableTags: false,
  parser: { lowerCaseAttributeNames: true },
  transformTags: {
    "*": (tagName, attribs) => {
      if (attribs.style && BAD_STYLE.test(attribs.style)) delete attribs.style;
      // marker-end="url(#a)" 같은 같은 그림 안 참조만 허용
      for (const k of ["marker-end", "marker-start", "marker-mid", "fill", "stroke", "clip-path"]) {
        const v = attribs[k];
        if (v && /url\s*\(/i.test(v) && !/^url\(\s*#[\w-]+\s*\)$/i.test(v.trim())) delete attribs[k];
      }
      return { tagName, attribs };
    },
  },
};

function renderTex(tex: string) {
  return katex.renderToString(tex, { throwOnError: false, strict: "ignore", output: "html", trust: false });
}

/** 줄바꿈을 <br> 로 (표와 그림 안은 그대로) */
function breakLines(html: string) {
  return html
    .split(/(<svg[\s\S]*?<\/svg>|<table[\s\S]*?<\/table>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\r?\n/g, "<br>")))
    .join("");
}

/** 문제 글자 → 안전한 화면용 HTML (수식은 KaTeX로 그린 결과) */
export function renderProblemHtml(input: string): string {
  if (!input) return "";
  let text = formatMath(input);
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, a: string) => "$" + a + "$");

  // 수식 부분을 표시로 바꿔 두고 나머지 HTML 만 살균한다
  const maths: string[] = [];
  const parts = text.split("$");
  if (parts.length % 2 === 0) parts[parts.length - 2] += "&#36;" + parts.pop(); // 짝이 안 맞는 $ 는 글자로
  const shell = parts
    .map((part, i) => {
      if (i % 2 === 0) return part;
      if (!part.trim()) return "";
      maths.push(part);
      return `\u0001${maths.length - 1}\u0001`;
    })
    .join("");

  let safe = breakLines(shell.replace(STRAY_LT, "&lt;"));
  safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  safe = sanitizeHtml(safe, SANITIZE);
  return safe.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => renderTex(maths[Number(i)]));
}
