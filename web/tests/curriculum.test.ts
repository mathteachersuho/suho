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

import { outOfLevel } from "../lib/levelCheck.ts";

const levelCases: [string, string, string[]][] = [
  ["중1", "소인수 3의 개수는 $\\lfloor 18/3 \\rfloor + \\lfloor 18/9 \\rfloor = 8$", ["가우스 기호 [x]"]],
  ["중1", "개수는 $[18/3]+[18/9]=6+2=8$이다", ["가우스 기호 [x]"]],
  ["중1", "$12^8=(2^2 \\times 3)^8=2^{16} \\times 3^8$", ["지수법칙 공식 ((a^m)^n 꼴)"]],
  ["중1", "$(-2)^3=-8$ 이고 $2^3 \\times 3^2$ 를 소인수분해하면", []],
  ["중1", "$n-4 \\in \\{1, 3, 5\\}$", ["집합 기호 (∈, ⊂)"]],
  ["중1", "합이 18이 되는 소수의 조합은 5+13뿐이다", []],
  ["중2", "$\\sqrt{2}$ 를 곱하면", ["제곱근·√"]],
  ["중3", "$\\sqrt{2}$ 를 곱하면", []],
  ["", "\\lfloor x \\rfloor", []],
];
for (const [grade, text, want] of levelCases)
  test(`학년 밖 표현 찾기: ${grade || "(학년 없음)"} ${text.slice(0, 20)}`, () => assert.deepEqual(outOfLevel(grade, text), want));

test("중1 풀이의 ⟹, gcd, 볼록, ± 도 찾는다", () => {
  assert.deepEqual(outOfLevel("중1", "$2a-6=0 \\implies a=3$"), ["논리 기호 ⟹"]);
  assert.deepEqual(outOfLevel("중1", "$\\gcd(72, 108) = 36$"), ["gcd·lcm 기호"]);
  assert.deepEqual(outOfLevel("중1", "위로 볼록한 곡선"), ["볼록 (이차함수 용어)"]);
  assert.deepEqual(outOfLevel("중1", "$\\pm 1, \\pm 2$"), ["± 기호"]);
});
