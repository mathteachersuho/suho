// 날짜 계산 (마감일, 복습 날짜). 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dueLabel } from "../lib/hwFormat.ts";

test("날짜 더하기: 달·해가 바뀌어도 맞다", () => {
  assert.equal(addDays("2026-10-11", 3), "2026-10-14");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addDays("2026-12-25", 14), "2027-01-08");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("마감일 글자", () => {
  assert.equal(dueLabel("2026-10-07"), "10/7까지");
  assert.equal(dueLabel(""), "");
});
