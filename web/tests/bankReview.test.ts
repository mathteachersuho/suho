// 문제 은행 자동 점검: 자동으로 고쳐도 되는지 판단, AI 점검 답 읽기. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoVerdict, contentHash, DEFAULT_AUTO, parseFindings } from "../lib/bankReviewCore.ts";

const base = { question: "두 수 $3$과 $5$의 합을 구하시오.<svg viewBox=\"0 0 10 10\"><text x=\"1\" y=\"5\" font-size=\"9\">3</text></svg>", answer: "$8$", solution: "$3+5=8$" };

test("그림만 고친 수정은 바로 고친다", () => {
  const after = { ...base, question: base.question.replace('font-size="9"', 'font-size="13"').replace('x="1"', 'x="2"') };
  assert.deepEqual(autoVerdict(base, after, ["figure"], DEFAULT_AUTO, false), { auto: true });
});

test("시험지 번호를 지운 것은 숫자가 바뀐 것으로 보지 않는다", () => {
  const before = { ...base, question: "17. " + base.question };
  assert.deepEqual(autoVerdict(before, base, ["format"], DEFAULT_AUTO, false), { auto: true });
});

test("정답이 바뀌면 확인함으로", () => {
  const v = autoVerdict(base, { ...base, answer: "$9$" }, ["figure"], DEFAULT_AUTO, false);
  assert.equal(v.auto, false);
});

test("정답 표기만 다르면(띄어쓰기·$) 같은 정답", () => {
  assert.equal(autoVerdict({ ...base, answer: "$\\frac{1}{2}$" }, { ...base, answer: "\\frac12" }, ["notation"], DEFAULT_AUTO, false).auto, true);
  assert.deepEqual(autoVerdict({ ...base, answer: "$ 8 $" }, base, ["notation"], DEFAULT_AUTO, false), { auto: true });
});

test("지문 숫자가 바뀌면 확인함으로", () => {
  const v = autoVerdict(base, { ...base, question: base.question.replace("$5$", "$6$") }, ["notation"], DEFAULT_AUTO, false);
  assert.equal(v.auto, false);
});

test("자동 종류가 아니거나 검수한 문제면 확인함으로", () => {
  assert.equal(autoVerdict(base, base, ["solution"], DEFAULT_AUTO, false).auto, false);
  assert.equal(autoVerdict(base, base, ["figure"], DEFAULT_AUTO, true).auto, false);
  // 정답 수정은 기준에서 골라도 자동으로 하지 않는다
  assert.equal(autoVerdict(base, base, ["answer"], [...DEFAULT_AUTO, "answer"], false).auto, false);
});

test("학년 밖 풀이를 자동 종류로 고르면 풀이 숫자는 바뀌어도 된다 (정답은 같아야)", () => {
  const after = { ...base, solution: "$3$에 $5$를 더하면 $8$, 즉 $8$" };
  assert.equal(autoVerdict(base, after, ["grade"], [...DEFAULT_AUTO, "grade"], false).auto, true);
});

test("AI 점검 답: 모르는 kind·빈 findings·모르는 id는 버린다", () => {
  const raw = {
    results: [
      { id: "a", findings: [] },
      { id: "b", findings: [{ kind: "figure", what: "글자가 잘려요", fix: "viewBox 넓히기" }, { kind: "zzz", what: "?" }] },
      { id: "x", findings: [{ kind: "answer", what: "틀림" }] },
    ],
  };
  assert.deepEqual(parseFindings(raw, ["a", "b"]), [{ id: "b", kinds: ["figure"], what: "글자가 잘려요", fix: "viewBox 넓히기" }]);
  assert.deepEqual(parseFindings({}, ["a"]), []);
});

test("contentHash 는 SQL md5(concat_ws(chr(1), question, answer, solution)) 와 같은 값", () => {
  // Postgres: select md5(concat_ws(chr(1), 'a', 'b', 'c')) → 18f15c478e2373e2301a19f2299270bf
  assert.equal(contentHash({ question: "a", answer: "b", solution: "c" }), "18f15c478e2373e2301a19f2299270bf");
});
