/*
 * 보기(①~⑤)가 그림인 객관식: 번호와 그림을 한 묶음으로 묶어 가로 격자로 놓는다.
 * formatMath 가 SVG를 <div class="mt-figure"> 로 감싼 다음에 부른다.
 * 저장된 문제 글자는 그대로 두고 화면에 그릴 때만 바꾸므로, 예전에 만든 문제에도 바로 적용된다.
 *
 *   ①\n<그림>\n②\n<그림> …   →   <div class="mt-choices"> [① 그림] [② 그림] [③ 그림] … </div>
 *
 * 지문 + 문제 그림 하나 + 보기 격자 순서이면 문제 그림은 교재처럼 지문 오른쪽에 둔다.
 */

const FIG = String.raw`<div class="mt-figure"><div><svg\b[\s\S]*?<\/svg><\/div><\/div>`;
const ONE = String.raw`([①②③④⑤])[ \t ]*(?:\r?\n[ \t ]*)*(${FIG})`;
const ONE_RE = new RegExp(ONE, "g");
// 그림 보기가 두 개 이상 이어진 부분 (사이에는 빈칸, 줄바꿈만)
const RUN_RE = new RegExp(String.raw`(?:${ONE}\s*){2,}`, "g");
const STEM_RE = new RegExp(String.raw`^([\s\S]*?\S[\s\S]*?)\s*(${FIG})\s*$`);

export function layoutFigureChoices(text: string): string {
  let found = false;
  text = text.replace(RUN_RE, (run) => {
    const items = [...run.matchAll(ONE_RE)].map(
      (m) => `<div class="mt-choice"><span class="mt-choice-no">${m[1]}</span>${m[2]}</div>`,
    );
    found = true;
    const cols = items.length === 4 || items.length === 2 ? " cols-2" : "";
    return `<div class="mt-choices${cols}">${items.join("")}</div>`;
  });
  if (!found) return text;

  // 지문 + 문제 그림 + 보기 격자 → 문제 그림을 지문 오른쪽으로
  const at = text.indexOf('<div class="mt-choices');
  const before = text.slice(0, at);
  const m = before.match(STEM_RE);
  if (m && !/<(?:div|svg|table)\b/i.test(m[1])) {
    text = `<div class="mt-stem-row"><div class="mt-stem-text">${m[1].trim()}</div>${m[2]}</div>` + text.slice(at);
  } else {
    // 격자 앞뒤 빈 줄은 <br> 로 남아 틈만 벌어지므로 지운다
    text = before.replace(/\s+$/, "") + text.slice(at);
  }
  // 격자 뒤 빈 줄은 RUN_RE 의 마지막 \s* 가 이미 먹었다
  return text;
}
