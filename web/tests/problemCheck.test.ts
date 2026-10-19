// 매일 문제 점검에서 자주 나온 실수를 만들 때 바로 잡는지 지키는 시험. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clippedTexts, problemIssues, raiseSmallFonts, stripExamNumber, tidyProblem } from "../lib/problemCheck.ts";
import { renderFigure } from "../lib/figure.ts";

const strip: [string, string][] = [
  ["11. 다음 중 옳은 것은?", "다음 중 옳은 것은?"],
  ["2) 다음 그래프는", "다음 그래프는"],
  ["(3) 두 수의 합은?", "두 수의 합은?"],
  ["5 점 P(a, b)가 제2사분면 위의 점이다.", "점 P(a, b)가 제2사분면 위의 점이다."],
  // 지문의 수는 그대로
  ["10 이하의 자연수 중", "10 이하의 자연수 중"],
  ["3 L 음료를", "3 L 음료를"],
  ["1.5배가 되는 수는?", "1.5배가 되는 수는?"],
  ["3 개의 공이", "3 개의 공이"],
  ["2x+1=5일 때", "2x+1=5일 때"],
  ["12.5 cm인 선분", "12.5 cm인 선분"],
];
for (const [q, want] of strip) test(`문항 번호 지우기: ${q}`, () => assert.equal(stripExamNumber(q), want));

test("AI가 그린 SVG의 작은 글자는 12px로 키우고, 앱이 그린 그림은 그대로 둔다", () => {
  assert.equal(raiseSmallFonts('<svg viewBox="0 0 9 9"><text font-size="9">a</text><text font-size="14">b</text></svg>'), '<svg viewBox="0 0 9 9"><text font-size="12">a</text><text font-size="14">b</text></svg>');
  const app = '<svg viewBox="0 0 9 9" data-figure="{}"><text font-size="10.2">1</text></svg>';
  assert.equal(raiseSmallFonts(app), app);
});

test("그림 밖으로 잘리는 축 이름을 찾는다", () => {
  const svg = '<svg width="200" height="100" viewBox="0 0 200 100"><text x="190" y="90" font-size="12">x(분)</text><text x="4" y="50" font-size="12">A</text></svg>';
  assert.deepEqual(clippedTexts(svg), ["x(분)"]);
  assert.deepEqual(clippedTexts('<svg viewBox="0 0 200 100"><text x="2" y="50" font-size="12" text-anchor="end">거리(km)</text></svg>'), ["거리(km)"]);
});

test("보기가 있는데 '구하시오'로 끝나면 고치게 한다", () => {
  const issues = problemIssues({ question: "$x$의 값을 구하시오.\n① 1 ② 2 ③ 3", answer: "①", solution: "따라서 ①" });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /객관식/);
  assert.deepEqual(problemIssues({ question: "$x$의 값은?\n① 1 ② 2 ③ 3", answer: "①", solution: "따라서 ①" }), []);
});

test("풀이에서 빠진 보기 판단을 찾는다", () => {
  const question = "옳은 것을 모두 고른 것은?\nㄱ. 원점을 지난다.\nㄴ. 오른쪽 위로 향한다.\nㄷ. 제2사분면을 지난다.\n① ㄱ ② ㄱ, ㄴ";
  const issues = problemIssues({ question, answer: "②", solution: "ㄱ은 옳다. ㄴ도 옳다. 따라서 ②" });
  assert.match(issues[0], /ㄷ/);
  assert.deepEqual(problemIssues({ question, answer: "②", solution: "ㄱ 옳다. ㄴ 옳다. ㄷ 옳지 않다. 따라서 ②" }), []);
});

test("tidyProblem 은 문항 번호와 작은 글자를 함께 고친다", () => {
  const g = tidyProblem({ question: '7. 그림을 보고 답하시오.<svg viewBox="0 0 9 9"><text font-size="8">A</text></svg>', answer: "1", solution: "" });
  assert.equal(g.question, '그림을 보고 답하시오.<svg viewBox="0 0 9 9"><text font-size="12">A</text></svg>');
});

test("좌표그림: 눈금 숫자와 축 이름, 꺾은선을 그리고 글자가 그림 안에 있다", () => {
  const svg = renderFigure({
    x: [0, 65], y: [0, 3.5], xName: "x(분)", yName: "거리(km)",
    xticks: [10, 20, 35, 50, 60], yticks: [1, 3], guides: true,
    lines: [[[0, 0], [10, 1], [20, 1], [35, 3], [50, 3], [60, 0]]],
  });
  for (const t of ["10", "35", "60", ">1<", ">3<", "x(분)", "거리(km)"]) assert.ok(svg.includes(t), t);
  assert.match(svg, /<polyline points="[^"]+" fill="none"/);
  assert.match(svg, /stroke-dasharray="3 3"/);
  assert.deepEqual(clippedTexts(svg.replace(/ data-figure="[^"]*"/, "")), []);
});

test("좌표그림: ticks:true 면 원점 0 은 빼고 정수 눈금", () => {
  const svg = renderFigure({ x: [-5, 5], y: [-5, 5], ticks: true, grid: true });
  assert.ok(svg.includes(">−3<") && svg.includes(">4<"));
  assert.ok(!/>0</.test(svg));
});
