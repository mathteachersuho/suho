// 그림 보기 격자 배치. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFigureChoices } from "../lib/choiceGrid.ts";

const fig = (n: number) => `<div class="mt-figure"><div><svg width="80" height="100"><rect id="r${n}"/></svg></div></div>`;

test("번호와 그림을 묶어 격자로, 문제 그림은 지문 오른쪽", () => {
  const text = `오른쪽 그림과 같은 입체도형은?\n\n${fig(0)}\n\n①\n${fig(1)}\n②\n${fig(2)}\n③ ${fig(3)}\n\n④\n\n${fig(4)}\n⑤\n${fig(5)}\n`;
  const out = layoutFigureChoices(text);
  assert.match(out, /^<div class="mt-stem-row"><div class="mt-stem-text">오른쪽 그림과 같은 입체도형은\?<\/div><div class="mt-figure">.*r0/);
  assert.equal((out.match(/class="mt-choice"/g) ?? []).length, 5);
  assert.match(out, /<div class="mt-choices"><div class="mt-choice"><span class="mt-choice-no">①<\/span><div class="mt-figure"><div><svg[^>]*><rect id="r1"/);
  assert.ok(!/\n/.test(out), "격자 앞뒤 빈 줄이 남지 않는다");
});

test("보기 4개면 2열", () => {
  const out = layoutFigureChoices(`①${fig(1)}②${fig(2)}③${fig(3)}④${fig(4)}`);
  assert.match(out, /^<div class="mt-choices cols-2">/);
});

test("글자 보기나 그림 하나는 그대로", () => {
  const plain = `값은?\n① 1\n② 2\n③ 3`;
  assert.equal(layoutFigureChoices(plain), plain);
  const one = `그림을 보고 답하시오.\n${fig(0)}\n① 1 ② 2`;
  assert.equal(layoutFigureChoices(one), one);
});

test("지문에 표나 그림이 더 있으면 문제 그림을 옮기지 않는다", () => {
  const text = `<div class="mt-table"><table></table></div>\n${fig(0)}\n①${fig(1)}②${fig(2)}`;
  const out = layoutFigureChoices(text);
  assert.ok(!out.includes("mt-stem-row"));
  assert.match(out, /<\/div><\/div><div class="mt-choices cols-2">/);
});
