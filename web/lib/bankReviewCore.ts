import { createHash } from "node:crypto";
import { stripExamNumber } from "./problemCheck.ts";

/*
 * 문제 은행 자동 점검에서 DB 없이 계산하는 부분 (lib/bankReview.ts 가 쓴다. 테스트: tests/bankReview.test.ts).
 * - 고칠 것의 종류(kind)와 기본으로 자동 수정할 종류
 * - 자동으로 고쳐도 되는지 마지막 안전 확인 (정답·숫자가 바뀌면 자동으로 고치지 않고 확인함으로)
 * - AI 점검 답(JSON) 읽기
 * - 선생님이 처음 쓰는 기본 점검 기준
 */

export const KINDS = {
  figure: "그림",
  notation: "표기",
  format: "서식",
  wording: "문장",
  solution: "풀이",
  grade: "학년 밖 풀이",
  answer: "정답",
  question: "지문 내용",
  class: "분류·난이도",
} as const;
export type Kind = keyof typeof KINDS;
export const isKind = (k: unknown): k is Kind => typeof k === "string" && k in KINDS;

/** 처음에 자동으로 고치는 종류 (선생님이 기준 화면에서 바꿀 수 있다) */
export const DEFAULT_AUTO: Kind[] = ["figure", "notation", "format"];
/** 이 종류는 기준에서 골라도 자동으로 고치지 않는다 (정답·문제 내용이 바뀔 수 있어서) */
export const NEVER_AUTO: Kind[] = ["answer", "question", "class"];

export type Content = { question: string; answer: string; solution: string };

/** 문제·정답·풀이가 바뀌었는지 보는 값. SQL md5(concat_ws(chr(1), question, answer, solution)) 와 같다 */
export const contentHash = (c: Content) => createHash("md5").update([c.question, c.answer, c.solution].join("\u0001"), "utf8").digest("hex");

/** 그림(SVG) 빼고 남은 글 */
const textOnly = (t: string) => t.replace(/<svg\b[\s\S]*?<\/svg>/g, " ");
/** 글 속 수(크기 순으로). 숫자가 바뀌었는지 보는 데 쓴다 */
export const numbersIn = (t: string) => (textOnly(t).match(/\d+(?:\.\d+)?/g) ?? []).sort();
/** 정답 비교용: 띄어쓰기·$·{} 차이는 무시 */
const plainAnswer = (a: string) => a.replace(/[\s${}]/g, "").replace(/\\(?:left|right|,|;|!)/g, "");

/**
 * 고친 안을 선생님 확인 없이 바로 넣어도 되는지.
 * 고칠 종류가 모두 자동 수정 종류이고, 검수한 문제가 아니고, 정답이 같고, 지문(그림 밖)·풀이의 숫자가 그대로일 때만.
 * 아니면 이유를 돌려준다 (확인함에 그 이유를 적는다).
 */
export function autoVerdict(before: Content, after: Content, kinds: Kind[], autoKinds: Kind[], verified: boolean): { auto: true } | { auto: false; why: string } {
  const allowed = autoKinds.filter((k) => !NEVER_AUTO.includes(k));
  const manual = kinds.filter((k) => !allowed.includes(k));
  if (manual.length) return { auto: false, why: `${manual.map((k) => KINDS[k]).join(", ")} 수정이라 확인이 필요해요` };
  if (verified) return { auto: false, why: "검수한 문제라 확인이 필요해요" };
  if (plainAnswer(before.answer) !== plainAnswer(after.answer)) return { auto: false, why: "정답이 바뀌어서 확인이 필요해요" };
  // 문제 앞 시험지 번호('17.')를 지운 것은 숫자가 바뀐 것으로 보지 않는다
  if (numbersIn(stripExamNumber(before.question)).join() !== numbersIn(stripExamNumber(after.question)).join()) return { auto: false, why: "지문의 숫자가 바뀌어서 확인이 필요해요" };
  // 학년 밖 풀이·풀이 다듬기를 자동으로 고르면 풀이 숫자는 바뀔 수 있다
  if (!kinds.some((k) => k === "solution" || k === "grade") && numbersIn(before.solution).join() !== numbersIn(after.solution).join())
    return { auto: false, why: "풀이의 숫자가 바뀌어서 확인이 필요해요" };
  return { auto: true };
}

export type Finding = { id: string; kinds: Kind[]; what: string; fix: string };

/** AI 점검 답 읽기: {"results":[{"id","ok","findings":[{"kind","what","fix"}]}]} → 고칠 것이 있는 문제만 */
export function parseFindings(raw: unknown, ids: string[]): Finding[] {
  const list = (raw as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  const out: Finding[] = [];
  for (const r of list as { id?: unknown; findings?: unknown }[]) {
    const id = String(r?.id ?? "");
    if (!ids.includes(id) || !Array.isArray(r.findings)) continue;
    const fs = (r.findings as { kind?: unknown; what?: unknown; fix?: unknown }[]).filter((f) => isKind(f?.kind) && String(f?.what ?? "").trim());
    if (!fs.length) continue;
    out.push({
      id,
      kinds: [...new Set(fs.map((f) => f.kind as Kind))],
      what: fs.map((f) => String(f.what).trim()).join(" / ").slice(0, 2000),
      fix: fs
        .map((f) => String(f.fix ?? f.what).trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 3000),
    });
  }
  return out;
}

/** 처음 점검 기준. 선생님이 기준 화면에서 고쳐 저장하면 새 버전이 된다. 지금까지 정한 규칙(그림·학년 범위)을 담았다. */
export const DEFAULT_GUIDE = `[고치지 않아도 되는 것]
- 뜻이 통하는 말투·문장 차이, 띄어쓰기 정도는 고치지 않는다.
- 2026-11-10 이전에 만든 문제의 길이 표시(점선 호 없이 변 옆에 쓴 길이)는 틀린 것으로 보지 않는다.
- 그림이 조금 투박해도 문제를 푸는 데 지장이 없으면 그대로 둔다.

[손대지 말 것]
- 문제의 숫자·조건·보기 순서는 정답이 틀린 경우가 아니면 바꾸지 않는다.
- (예시) 특정 단원·유형의 그림은 지금 모양 그대로 둔다 — 필요하면 여기에 적어 주세요.

[그림 모양]
- 흰 바탕, 검은 선, 글자 13~14px. 글자가 그림 밖으로 잘리거나 서로 겹치면 고친다.
- 색칠한 부분은 경계를 정확히 따라 칠하고(#3b82f6, 투명도 0.35), 이름이 다른 부분은 서로 다른 색으로 칠한다.
- 길이 글자는 그 변의 두 끝점을 잇는 바깥쪽 점선 호 가운데에 둔다.
- 그림 보기(①~⑤)는 한 줄에 3개(보기 4개면 2개)씩 놓는다.
- 좌표를 읽어야 하는 그래프에는 눈금 숫자가 있어야 한다.

[틀린 것으로 볼 것]
- 정답이 틀렸거나 풀이에 계산·논리 오류가 있음, 풀이의 결론과 정답이 다름.
- 정답이 약분하지 않은 분수 (학원 규칙: 틀림).
- 조건이 빠져 답이 여러 개이거나 정해지지 않음, 그림과 지문이 맞지 않음.
- 풀이에 그 학년에서 아직 배우지 않은 개념·기호를 씀 (예: 중1 풀이의 가우스 기호, 연립방정식, √).
- 보기(①~⑤)가 있는데 발문이 '구하시오'로 끝남, 문제 앞에 시험지 번호('17.')가 남아 있음.`;
