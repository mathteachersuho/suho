/** 만든 문제끼리 "같은 문제"인지 보기 (숫자·글자가 거의 같으면 같은 문제로 본다) */

/** 그림은 설정(data-figure)만 남기고 태그·수식 명령·띄어쓰기를 지운 글자 */
function plain(q: string) {
  return q
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/g, (_m, attrs: string) => ` ${attrs.match(/data-figure="([^"]*)"/)?.[1] ?? ""} `)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;|&amp;|&lt;|&gt;|&nbsp;/g, " ")
    .replace(/\\(?:d?frac|left|right|times|cdot|quad|text|mathrm)/g, " ")
    .replace(/[\s$\\{}]/g, "");
}

const nums = (t: string) => t.match(/\d+(?:\.\d+)?/g) ?? [];

function bigrams(t: string) {
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 두 글자가 얼마나 겹치는지 (0~1, 다이스 계수) */
function dice(a: string, b: string) {
  if (!a || !b) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (Math.max(a.length - 1, 1) + Math.max(b.length - 1, 1));
}

export type Fingerprint = { text: string; nums: string };
export const fingerprint = (q: string): Fingerprint => {
  const text = plain(q);
  return { text, nums: nums(text).join(",") };
};

/** 쓰인 숫자가 모두 같고 글자도 많이 겹치면 같은 문제 (숫자를 바꾼 문제는 다른 문제로 본다). 숫자가 없으면 글자가 거의 같을 때만. */
export function sameProblem(a: Fingerprint, b: Fingerprint) {
  if (a.nums !== b.nums) return false;
  return dice(a.text, b.text) >= (a.nums ? 0.6 : 0.95);
}

/** AI에게 "이것과 겹치지 마라"로 보여 줄 짧은 글 (그림은 빼고) */
export const brief = (q: string) =>
  q
    .replace(/<svg\b[\s\S]*?<\/svg>/g, "[그림]")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
