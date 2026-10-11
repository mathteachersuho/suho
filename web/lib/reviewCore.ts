import { addDays } from "./hwFormat.ts";

/*
 * 복습 단계 계산 (DB 없이 숙제 기록만 받아 계산하는 부분). lib/review.ts 가 DB에서 읽어 여기에 넘긴다.
 * 학생·유형마다 숙제를 낸 날짜 순으로 보면서
 *  - 그 숙제에서 그 유형을 하나라도 틀렸거나 '어려워함'이면 → 복습 1단계, 3일 뒤 복습
 *  - 복습 중에 그 유형을 모두 맞히면 → 다음 단계 (7일 뒤, 14일 뒤), 세 번 맞히면 졸업
 *  - 복습 중에 또 틀리면 → 처음(3일 뒤)부터 다시
 * 같은 날 숙제에서 맞힌 것은 복습으로 치지 않는다 (틀린 날 바로 다시 푼 것이라서).
 */

export const REVIEW_DAYS = [3, 7, 14];

export type ReviewState = {
  grade: string;
  unit: string;
  type: string;
  done: boolean; // 졸업 (세 번 연속 복습에서 맞힘)
  passed: number; // 이번 복습에서 맞힌 횟수 0~3
  due: string; // 다음 복습 날 YYYY-MM-DD (졸업이면 '')
  lastDay: string; // 마지막으로 이 유형을 푼 날
};

/** 숙제 하나에서 한 학생의 한 유형 결과 (날짜 순으로 넘긴다) */
export type ReviewRow = { studentId: string; grade: string; unit: string; type: string; day: string; fail: boolean; pass: boolean };

export const reviewKey = (k: { grade: string; unit: string; type: string }) => `${k.grade}\u0000${k.unit}\u0000${k.type}`;

/** 기록을 차례로 되짚어 학생별 유형 복습 상태를 만든다. 틀린 적이 있는 유형만 나온다. */
export function replayReview(rows: ReviewRow[]): Map<string, ReviewState[]> {
  const out = new Map<string, Map<string, ReviewState>>();
  for (const r of rows) {
    if (!out.has(r.studentId)) out.set(r.studentId, new Map());
    const m = out.get(r.studentId)!;
    const k = reviewKey(r);
    let st = m.get(k);
    if (r.fail) {
      st = { grade: r.grade, unit: r.unit, type: r.type, done: false, passed: 0, due: addDays(r.day, REVIEW_DAYS[0]), lastDay: r.day };
      m.set(k, st);
    } else if (r.pass && st && !st.done && r.day > st.lastDay) {
      st.passed++;
      st.lastDay = r.day;
      if (st.passed >= REVIEW_DAYS.length) {
        st.done = true;
        st.due = "";
      } else st.due = addDays(r.day, REVIEW_DAYS[st.passed]);
    }
  }
  return new Map([...out].map(([sid, m]) => [sid, [...m.values()]]));
}
