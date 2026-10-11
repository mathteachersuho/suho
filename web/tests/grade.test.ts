// 자동 채점이 바뀌어 학생 점수가 어긋나지 않도록 지키는 시험. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer } from "../lib/grade.ts";

const cases: [string, string, "Y" | "N" | "?", string][] = [
  ["3", "3", "Y", "같은 수"],
  ["3", "4", "N", "다른 수"],
  [" 3 ", "3", "Y", "앞뒤 빈칸"],
  ["1/2", "0.5", "Y", "분수와 소수"],
  ["2/4", "1/2", "Y", "약분 전 분수"],
  ["x=3", "3", "Y", "x= 붙여 씀"],
  ["③", "3", "Y", "동그라미 번호"],
  ["2,1", "1,2", "Y", "순서 없는 여러 답"],
  ["(1,2)", "(2,1)", "N", "순서쌍은 순서가 중요"],
  ["3sqrt(3)", "3√3", "Y", "루트 쓰는 방식"],
  ["-1", "−1", "Y", "빼기 기호 종류"],
  ["x^2+1", "1+x^2", "Y", "식의 순서"],
  ["3", "3cm", "Y", "단위 생략"],
  ["", "3", "N", "빈 답"],
  ["abc", "3", "N", "엉뚱한 답"],
];

for (const [given, correct, want, why] of cases) {
  test(`채점: ${why} (${given} / ${correct})`, () => {
    assert.equal(gradeAnswer(given, correct), want);
  });
}
