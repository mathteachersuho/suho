// KaTeX 가 모르는 명령어(호 기호 \overparen 등)가 빨간 오류 글자로 나오지 않는지 지키는 시험. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { KATEX_MACROS } from "../lib/katexMacros.ts";

const render = (tex: string) =>
  katex.renderToString(tex, { throwOnError: false, strict: "ignore", output: "html", macros: { ...KATEX_MACROS } });

for (const tex of [
  "\\overparen{AB}",
  "\\overparen{\\mathrm{AB}}",
  "\\overparen AB",
  "\\wideparen{AB}",
  "\\overarc{AB}",
  "\\arc{AB}",
  "\\overbar{AB}",
  "\\mbox{cm}",
]) {
  test(`수식 오류 없음: ${tex}`, () => {
    const html = render(tex);
    assert.ok(!html.includes("katex-error"), html);
    assert.ok(!html.includes("#cc0000"), html);
  });
}
