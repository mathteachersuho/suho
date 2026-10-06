import "server-only";
import { db } from "./db";
import { addDays, todaySeoul } from "./hwFormat";

/*
 * 틀린 유형 간격 두고 다시 내기 (간격 반복).
 * 숙제 기록만으로 계산하고 따로 저장하지 않는다. 학생·유형마다 숙제를 낸 날짜 순으로 보면서
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

export const reviewKey = (k: { grade: string; unit: string; type: string }) => `${k.grade}\u0000${k.unit}\u0000${k.type}`;

/** 오늘 기준으로 복습이 필요한가 (복습 날이 오늘이거나 지났음) */
export const isDue = (r: ReviewState, today = todaySeoul()) => !r.done && r.due <= today;

/** 학생들의 유형별 복습 상태. 틀린 적이 있는 유형만 나온다. */
export async function reviewStates(studentIds?: string[]): Promise<Map<string, ReviewState[]>> {
  const sql = db();
  const rows = await sql`
    select r.student_id, p.grade, p.unit, p.type, (h.created_at at time zone 'Asia/Seoul')::date::text as day,
      bool_or(r.correct = 'N' or '어려워함' = any(r.tags)) as fail,
      bool_and(r.correct = 'Y' and not ('어려워함' = any(r.tags))) as pass
    from hw_results r
    join homework h on h.hw_id = r.hw_id
    join problems p on p.id = r.problem_id
    where p.type <> '' ${studentIds ? sql`and r.student_id = any(${studentIds})` : sql``}
    group by r.student_id, p.grade, p.unit, p.type, h.hw_id, h.created_at
    order by r.student_id, h.created_at`;
  const out = new Map<string, Map<string, ReviewState>>();
  for (const r of rows) {
    const sid = r.student_id as string;
    if (!out.has(sid)) out.set(sid, new Map());
    const m = out.get(sid)!;
    const k = reviewKey(r as unknown as ReviewState);
    const day = r.day as string;
    let st = m.get(k);
    if (r.fail) {
      st = { grade: r.grade, unit: r.unit, type: r.type, done: false, passed: 0, due: addDays(day, REVIEW_DAYS[0]), lastDay: day };
      m.set(k, st);
    } else if (r.pass && st && !st.done && day > st.lastDay) {
      st.passed++;
      st.lastDay = day;
      if (st.passed >= REVIEW_DAYS.length) {
        st.done = true;
        st.due = "";
      } else st.due = addDays(day, REVIEW_DAYS[st.passed]);
    }
  }
  return new Map([...out].map(([sid, m]) => [sid, [...m.values()]]));
}

/** 오늘 복습할 유형이 있는 학생들 (학생 id → 복습할 유형 수) */
export async function dueStudents(): Promise<Map<string, number>> {
  const today = todaySeoul();
  const all = await reviewStates();
  const out = new Map<string, number>();
  for (const [sid, list] of all) {
    const n = list.filter((r) => isDue(r, today)).length;
    if (n) out.set(sid, n);
  }
  return out;
}

/** 화면 표시: '복습 지남' / '오늘 복습' / '10/9 복습' / '졸업' + 단계 */
export function reviewLabel(r: ReviewState, today = todaySeoul()) {
  if (r.done) return "졸업";
  const step = `${r.passed + 1}/${REVIEW_DAYS.length}`;
  if (r.due < today) return `복습 지남 · ${step}`;
  if (r.due === today) return `오늘 복습 · ${step}`;
  const [, m, d] = r.due.split("-").map(Number);
  return `${m}/${d} 복습 · ${step}`;
}
