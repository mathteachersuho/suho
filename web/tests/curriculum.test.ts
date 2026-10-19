// 학년 이름마다 맞는 교육과정 안내가 붙는지 지키는 시험. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { findGuide, levelRules } from "../lib/ai/curriculum.ts";

const cases: [string, string | null][] = [
  ["중1", "중학교 1학년"],
  ["중 2", "중학교 2학년"],
  ["중학교 3학년", "중학교 3학년"],
  ["공통수학1", "고등학교 공통수학1"],
  ["공통수학2", "고등학교 공통수학2"],
  ["수학(상)", "고등학교 공통수학1"],
  ["대수", "고등학교 대수"],
  ["수학I", "고등학교 대수"],
  ["수학II", "고등학교 미적분I"],
  ["미적분I", "고등학교 미적분I"],
  ["미적분II", "고등학교 미적분II"],
  ["미적분", "고등학교 미적분II"],
  ["확률과 통계", "고등학교 확률과 통계"],
  ["기하", "고등학교 기하"],
  ["", null],
  ["초6", null],
];

for (const [grade, name] of cases)
  test(`학년 ${grade || "(빈칸)"} → ${name ?? "안내 없음"}`, () => assert.equal(findGuide(grade)?.name ?? null, name));

test("중1 안내에는 가우스 기호와 지수법칙 공식을 쓰지 말라는 말이 있다", () => {
  const r = levelRules({ grade: "중1", unit: "소인수분해", type: "소인수분해" });
  assert.match(r, /중학교 1학년/);
  assert.match(r, /가우스 기호/);
  assert.match(r, /지수법칙/);
});

test("학년을 모르면 문제를 보고 학년을 판단하라고 한다", () => {
  assert.match(levelRules({}), /몇 학년 문제인지 먼저 판단/);
});
