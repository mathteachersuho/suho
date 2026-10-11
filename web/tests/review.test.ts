// 틀린 유형 복습 (3일·7일·14일) 단계 계산. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { replayReview, type ReviewRow } from "../lib/reviewCore.ts";

const T = { studentId: "s1", grade: "중2", unit: "연립방정식", type: "가감법" };
const row = (day: string, ok: boolean): ReviewRow => ({ ...T, day, fail: !ok, pass: ok });
const state = (rows: ReviewRow[]) => replayReview(rows).get("s1")?.[0];

test("틀리면 3일 뒤 복습", () => {
  const s = state([row("2026-10-01", false)]);
  assert.equal(s?.due, "2026-10-04");
  assert.equal(s?.passed, 0);
});

test("복습에서 맞히면 7일, 14일 뒤로 넘어가고 세 번 맞히면 졸업", () => {
  const rows = [row("2026-10-01", false), row("2026-10-04", true)];
  assert.equal(state(rows)?.due, "2026-10-11");
  rows.push(row("2026-10-11", true));
  assert.equal(state(rows)?.due, "2026-10-25");
  rows.push(row("2026-10-25", true));
  const s = state(rows);
  assert.equal(s?.done, true);
  assert.equal(s?.due, "");
});

test("복습 중에 또 틀리면 처음(3일 뒤)부터", () => {
  const s = state([row("2026-10-01", false), row("2026-10-04", true), row("2026-10-11", false)]);
  assert.equal(s?.passed, 0);
  assert.equal(s?.due, "2026-10-14");
});

test("틀린 날 바로 맞힌 것은 복습으로 치지 않는다", () => {
  const s = state([row("2026-10-01", false), row("2026-10-01", true)]);
  assert.equal(s?.passed, 0);
  assert.equal(s?.due, "2026-10-04");
});

test("틀린 적 없는 유형은 복습 목록에 없다", () => {
  assert.equal(replayReview([row("2026-10-01", true)]).get("s1")?.length, 0);
});
