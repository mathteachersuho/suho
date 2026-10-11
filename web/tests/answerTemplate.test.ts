// 숫자만 넣는 답 틀이 정답 모양대로 만들어지고 바르게 채점되는지 지키는 시험. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerTemplate, answerTemplateWithValues, countSlots, gradeSlots, toAnswer, type TNode } from "../lib/answerTemplate.ts";

const tpl = (a: string) => {
  const t = answerTemplateWithValues(a);
  assert.ok(t, `틀을 만들 수 있어야 함: ${a}`);
  return t;
};

test("루트와 분수는 모양을 두고 숫자만 빈칸", () => {
  const t = tpl("$\\sqrt{3}+\\frac{3}{4}$");
  assert.deepEqual(answerTemplate("$\\sqrt{3}+\\frac{3}{4}$"), [
    { t: "sqrt", c: [{ t: "slot" }] },
    { t: "text", v: "+" },
    { t: "frac", n: [{ t: "slot" }], d: [{ t: "slot" }] },
  ]);
  assert.equal(countSlots(t), 3);
  assert.equal(toAnswer(t, ["3", "3", "4"]), "√3+3/4");
});

test("학생에게 보내는 틀에는 정답이 없다", () => {
  for (const a of ["$-\\frac{2}{3}$, $(2,3)$ 기울기 $3\\sqrt{3}$", "$x^2+3x$", "X"]) {
    const json = JSON.stringify(answerTemplate(a));
    assert.ok(!/"t":"slot"[^}]*"v"/.test(json), json);
  }
});

test("틀을 만들 수 없는 정답은 null (자유 칸)", () => {
  for (const a of ["", "참", "$\\sqrt[3]{2}$", "$a_1$"]) assert.equal(answerTemplate(a), null, a);
});

test("문자는 빈칸, 지수도 빈칸, 그리스 문자·단위·한글 앞 문자는 그대로", () => {
  assert.deepEqual(answerTemplate("$x^2+3x$"), [
    { t: "slot", k: "a" },
    { t: "sup", c: [{ t: "slot" }] },
    { t: "text", v: "+" },
    { t: "slot" },
    { t: "slot", k: "a" },
  ]);
  assert.deepEqual(answerTemplate("$\\theta=30^\\circ$"), [{ t: "text", v: "θ=" }, { t: "slot" }, { t: "text", v: "°" }]);
  assert.deepEqual(answerTemplate("$6\\,\\text{km}$"), [{ t: "slot" }, { t: "text", v: " km" }]);
  assert.deepEqual(answerTemplate("$y$절편 $4$"), [{ t: "text", v: "y절편 " }, { t: "slot" }]);
});

test("O/X 답은 고르기 칸", () => {
  assert.deepEqual(answerTemplate("O"), [{ t: "slot", k: "ox" }]);
  assert.deepEqual(answerTemplate("$\\times$"), [{ t: "slot", k: "ox" }]);
});

const cases: [string, string[], "Y" | "N" | "?", string][] = [
  ["$\\sqrt{3}+\\frac{3}{4}$", ["3", "3", "4"], "Y", "정답 그대로"],
  ["$\\sqrt{3}+\\frac{3}{4}$", ["3", "3", "5"], "N", "분모가 다름"],
  ["$\\sqrt{3}+\\frac{3}{4}$", ["3", "", "4"], "N", "빈칸이 있음"],
  ["$\\frac{1}{2}$", ["2", "4"], "Y", "약분 전 분수"],
  ["$2\\sqrt{3}$", ["1", "12"], "Y", "값이 같은 루트"],
  ["$-\\frac{2}{3}$", ["2", "3"], "Y", "빼기 기호는 틀에 있음"],
  ["$6\\,\\text{km}$", ["6"], "Y", "단위"],
  ["$20\\%$", ["20"], "Y", "퍼센트"],
  ["$60^\\circ$", ["60"], "Y", "각도"],
  ["③", ["3"], "Y", "동그라미 번호"],
  ["③", ["4"], "N", "다른 번호"],
  ["$(2,3), (3,2)$", ["3", "2", "2", "3"], "Y", "순서를 바꾼 답 묶음"],
  ["$(2,3), (3,2)$", ["3", "2", "3", "2"], "N", "같은 묶음 두 번"],
  ["$x=-1$ 또는 $x=4$", ["x", "4", "x", "1"], "N", "부호가 붙은 자리를 바꾸면 틀림"],
  ["$x=-1$ 또는 $x=4$", ["x", "4", "x", "1"].reverse(), "N", "같은 답을 두 번"],
  ["$x^2+3x$", ["x", "2", "3", "x"], "Y", "문자식 정답 그대로"],
  ["$x^2+3x$", ["x", "2", "4", "x"], "N", "모양이 고정된 문자식"],
  ["$x^2+3x$", ["y", "2", "3", "y"], "N", "다른 문자"],
  ["$x^2+3x$", ["X", "2", "3", "X"], "N", "대문자는 다른 문자"],
  ["$\\frac{2x}{4}$", ["1", "x", "2"], "Y", "문자식 분수, 값이 같음"],
  ["$y=\\frac{1}{2}x+3$", ["y", "1", "2", "x", "4"], "N", "식의 오른쪽이 다름"],
  ["$\\sqrt{x+1}$", ["x", "1"], "Y", "루트 안 문자"],
  ["O", ["O"], "Y", "O 고름"],
  ["O", ["X"], "N", "X 고름"],
  ["$(\\frac{1}{2}, 3)$", ["2", "4", "3"], "?", "괄호 안 분수 묶음은 선생님 확인"],
];
for (const [answer, vals, want, why] of cases) {
  test(`틀 채점: ${why}`, () => assert.equal(gradeSlots(tpl(answer), vals), want));
}

test("빈칸이 하나라도 비면 답 글자는 비어 있다", () => {
  const t: TNode[] = tpl("$\\frac{3}{4}$");
  assert.equal(toAnswer(t, ["3"]), "");
  assert.equal(toAnswer(t, ["3a", "4"]), "3/4");
});
