/*
 * AI가 만든 문제를 저장하기 전에 글자로 검사한다. 매일 문제 점검에서 자주 나온 실수만 찾는다.
 * - 코드로 바로 고칠 수 있는 것(시험지 문항 번호, 너무 작은 그림 글자, 길이 글자의 흰 테두리)은 tidyProblem 이 고친다.
 * - AI가 다시 써야 하는 것(그림 밖으로 잘린 글자, 색칠이 빠진 그림, 점선 호 없이 떠 있는 길이 글자, 객관식인데 '구하시오', 풀이에서 빠진 보기 판단)은 problemIssues 가 찾는다.
 * 확실한 경우만 찾으므로 못 찾는 경우도 있다. 이미 저장된 문제는 바꾸지 않는다.
 */

import { shadeColors } from "./figure.ts";

export type ProblemText = { question: string; answer: string; solution: string };

/** 문제 맨 앞의 시험지 문항 번호 ('11.', '5)', '(3)', '5 다음 중…'). '1.5배', '3 L', '2x+1' 같은 지문은 그대로 둔다. */
export function stripExamNumber(q: string): string {
  return q
    .replace(/^(\s*)\(?\d{1,2}\s*[.)](?![\d.])\s*/, "$1")
    .replace(/^(\s*)\d{1,2}\s+([가-힣]+)/, (m, sp: string, word: string) => (NOT_NUMBER.test(word) ? m : sp + word));
}
/** 번호가 아니라 지문의 수 뒤에 오는 말 ('10 이하의', '3 개', '5 cm', '2 배이다'). 단위는 뒤에 조사만 붙은 경우 */
const NOT_NUMBER =
  /^(?:이하|이상|미만|초과|보다|번째|가지)|^(?:개|명|번|배|권|원|살|자루|마리|대|장|송이|시간|분|초|일|주|년|달|층|칸|등|쪽)?(?:의|과|와|을|를|은|는|이|가|에|만|씩|도|로|으로|부터|까지|이다|입니다|동안|후|뒤|전)?$/;

/** 앱이 그린 좌표 그림(data-figure)이 아닌, AI가 직접 그린 SVG들 */
const rawSvgs = (text: string) => [...text.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0]).filter((s) => !/^<svg\b[^>]*data-figure=/.test(s));

/** 그림 글자 최소 크기 (점검에서 8~11px 글자가 학습지에서 안 읽힌다고 자주 나왔다) */
export const MIN_FONT = 12;

/** AI가 직접 그린 SVG의 너무 작은 글자를 MIN_FONT 로 키운다 */
export function raiseSmallFonts(text: string): string {
  return text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, (svg) => {
    if (/^<svg\b[^>]*data-figure=/.test(svg)) return svg;
    return svg
      .replace(/\bfont-size="(\d+(?:\.\d+)?)(px)?"/g, (m, n: string, px = "") => (Number(n) < MIN_FONT ? `font-size="${MIN_FONT}${px}"` : m))
      .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g, (m, n: string) => (Number(n) < MIN_FONT ? `font-size:${MIN_FONT}px` : m));
  });
}

/** 길이를 나타내는 그림 글자 ('3 cm', '7.5cm', 'x cm', '2a m') */
export const LENGTH_TEXT = /^\s*(?:\d+(?:\.\d+)?\s*|\d*[a-z]\s+)(?:mm|cm|m|km)\s*$/;
const HALO = ' stroke="#ffffff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"';

/** AI가 직접 그린 SVG의 길이 글자에 흰 테두리를 넣어, 글자와 겹치는 점선 호 부분이 지워져 보이게 한다 */
export function haloLengthTexts(text: string): string {
  return text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, (svg) => {
    if (/^<svg\b[^>]*data-figure=/.test(svg)) return svg;
    return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (m, tag: string, body: string) =>
      LENGTH_TEXT.test(body.replace(/&nbsp;|\u00a0/g, " ")) && !/\bstroke\s*=/.test(tag) ? `<text${tag}${HALO}>${body}</text>` : m,
    );
  });
}

/** 코드로 바로 고칠 수 있는 것을 고친다 */
export function tidyProblem<T extends ProblemText>(g: T): T {
  const fix = (t: string) => haloLengthTexts(raiseSmallFonts(t));
  return { ...g, question: fix(stripExamNumber(g.question)), solution: fix(g.solution) };
}

/** 길이 글자가 있는데 점선 호(점선 path·polyline)가 없는 직접 그린 SVG의 길이 글자들 */
export function lengthsWithoutArc(svg: string): string[] {
  const texts = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&nbsp;|\u00a0/g, " ").trim()).filter((t) => LENGTH_TEXT.test(t));
  if (!texts.length) return [];
  const dashedCurve = /<(?:path|polyline)\b[^>]*stroke-dasharray/.test(svg);
  return dashedCurve ? [] : texts;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? tag.match(new RegExp(`${name}\\s*:\\s*([^;"]+)`))?.[1];
const first = (v: string | undefined) => (v === undefined ? NaN : Number.parseFloat(v.trim().split(/[\s,]+/)[0]));
/** 글자 폭 어림 (한글은 글자 크기만큼, 나머지는 그보다 좁게) */
const textWidth = (t: string, fs: number) => [...t].reduce((a, ch) => a + (/[ㄱ-힝]/.test(ch) ? fs * 0.95 : /[il.,()'| ]/.test(ch) ? fs * 0.3 : fs * 0.55), 0);

/** SVG 안에서 그림 밖으로 나가 잘리는 글자들 */
export function clippedTexts(svg: string): string[] {
  const open = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "";
  const vb = (attr(open, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, first(attr(open, "width")), first(attr(open, "height"))];
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return [];
  const out: string[] = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const tag = m[1];
    if (/\btransform\s*=/.test(tag)) continue; // 돌린 글자는 어림하기 어렵다
    const content = m[2].replace(/<[^>]*>/g, "").replace(/&[a-z]+;|&#\d+;/g, "x").trim();
    if (!content) continue;
    const x = first(attr(tag, "x"));
    const y = first(attr(tag, "y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fs = first(attr(tag, "font-size")) || 14;
    const w = textWidth(content, fs);
    const anchor = attr(tag, "text-anchor") ?? "start";
    const x1 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const tol = 2;
    if (x1 < vx - tol || x1 + w > vx + vw + tol || y - fs * 0.8 < vy - tol || y + fs * 0.2 > vy + vh + tol) out.push(content);
  }
  return out;
}

const CHOICES = /[①②③④⑤]/;
/** 보기 ㄱ. ㄴ. ㄷ. 처럼 판단할 보기들 */
const judgeItems = (q: string) => [...new Set([...q.matchAll(/(?:^|\s|\()([ㄱ-ㅎ])\s*[.)]\s/gm)].map((m) => m[1]))];

/** AI에게 다시 쓰게 할 것들 (고칠 요청 문장들). 없으면 빈 배열. */
export function problemIssues(g: ProblemText): string[] {
  const issues: string[] = [];
  const clipped = [...rawSvgs(g.question), ...rawSvgs(g.solution)].flatMap(clippedTexts);
  if (clipped.length)
    issues.push(
      `그림의 글자(${clipped.slice(0, 4).map((t) => `'${t}'`).join(", ")})가 그림(viewBox) 밖으로 나가 잘린다. 점·선의 위치는 그대로 두고, viewBox를 넓히거나 글자 위치를 옮겨 모든 글자가 그림 안에 들어오게 고쳐라.`,
    );
  const noArc = rawSvgs(g.question).flatMap(lengthsWithoutArc);
  if (noArc.length)
    issues.push(
      `그림의 길이 글자(${noArc.slice(0, 4).map((t) => `'${t}'`).join(", ")})가 변 옆에 떠 있다. 규칙 2-3대로 그 변의 두 끝점을 잇는 점선 호(path Q, stroke-dasharray)를 도형 바깥쪽으로 휘게 그리고, 글자는 호 가운데에 흰 테두리(paint-order="stroke")로 놓아라. 도형·점의 위치와 숫자는 바꾸지 마라.`,
    );
  const ask = g.question.replace(/<svg\b[\s\S]*?<\/svg>/g, "");
  if (CHOICES.test(ask) && /(구하시오|쓰시오|서술하시오)\s*\.?\s*(\(단[^)]*\))?$/.test(ask.split(/[①②③④⑤]/)[0].trim()))
    issues.push("보기(①~⑤)가 있는 객관식인데 발문이 '구하시오/쓰시오'로 끝난다. 보기는 그대로 두고 발문만 '~은?'처럼 객관식으로 바꿔라.");
  issues.push(...shadingIssues(g));
  const items = judgeItems(ask);
  if (items.length >= 2) {
    const missing = items.filter((c) => !g.solution.includes(c));
    if (missing.length) issues.push(`풀이에 보기 ${missing.join(", ")}의 판단이 빠졌다. 풀이에서 보기마다 옳은지 옳지 않은지 하나씩 밝히고, 마지막 줄에 결론을 써라.`);
  }
  return issues;
}

/** 지문이 색칠한 부분을 말하는지 */
const SHADE_WORDS = /색칠|칠한|어두운\s*부분|빗금|음영/;
/** 이름 붙은 부분들 ('두 부분 A와 B', '부분 A, B, C', 'A와 B의 넓이') */
function shadedNames(ask: string): string[] {
  const m =
    ask.match(/부분\s*([A-Z](?:\s*(?:와|과|,|및)\s*[A-Z])+)/) ?? ask.match(/([A-Z](?:\s*(?:와|과|,)\s*[A-Z])+)\s*의\s*넓이/);
  return m ? [...new Set(m[1].match(/[A-Z]/g) ?? [])] : [];
}

/** 색칠 점검: 지문에 색칠한 부분이 있는데 그림에 색이 없거나, 이름이 다른 부분이 같은 색이면 고칠 요청 */
export function shadingIssues(g: ProblemText): string[] {
  const ask = g.question.replace(/<svg\b[\s\S]*?<\/svg>/g, "");
  if (!SHADE_WORDS.test(ask)) return [];
  const svgs = [...g.question.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  const fix = "칠하는 부분은 경계(원·호는 path의 A 명령, 겹친 부분은 clipPath, 뺀 부분은 fill-rule=\"evenodd\")를 정확히 따라 칠하고, 부분 이름 글자는 그 부분 안쪽 가운데에 놓아라. 점·선의 위치와 숫자·조건·정답은 바꾸지 마라.";
  if (!svgs.length) return /그림/.test(ask) ? [`지문에 그림과 색칠한 부분이 있는데 그림이 없다. 지문에 맞는 그림을 SVG로 그리고 색칠한 부분을 #3b82f6(fill-opacity 0.35)로 칠하라. ${fix}`] : [];
  const colors = new Set(svgs.flatMap(shadeColors));
  const names = shadedNames(ask);
  if (!colors.size)
    return [
      `지문에 색칠한 부분${names.length ? `(${names.join(", ")})` : ""}이 있는데 그림에 칠한 색이 없다. ${
        names.length > 1 ? `${names.map((n, i) => `${n}는 ${["#3b82f6", "#f97316", "#22c55e", "#a855f7"][i % 4]}`).join(", ")}로` : "색칠한 부분을 #3b82f6로"
      } fill-opacity="0.35"로 칠하라. ${fix}`,
    ];
  if (names.length > 1 && colors.size < names.length)
    return [`색칠한 부분 ${names.join(", ")}가 서로 같은 색이라 구별되지 않는다. ${names.map((n, i) => `${n}는 ${["#3b82f6", "#f97316", "#22c55e", "#a855f7"][i % 4]}`).join(", ")}로 서로 다른 색으로 칠하라. ${fix}`];
  return [];
}

/** AI에게 고치라고 보낼 요청 하나로 묶는다 */
export function issuesInstruction(issues: string[]) {
  return `문제 점검 기준에 맞지 않는 곳이 있다. 아래만 고치고 숫자·조건·정답은 바꾸지 마라.\n${issues.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}
