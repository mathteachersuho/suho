import "server-only";
import { db } from "./db";
import { todaySeoul } from "./hwFormat";
import { REVIEW_DAYS, replayReview, type ReviewState } from "./reviewCore";

/* 틀린 유형 간격 두고 다시 내기 (간격 반복). 단계 계산은 lib/reviewCore.ts, 여기서는 DB에서 읽어 넘긴다. */

export { REVIEW_DAYS, reviewKey, type ReviewState } from "./reviewCore";

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
  return replayReview(
    rows.map((r) => ({
      studentId: r.student_id as string,
      grade: r.grade as string,
      unit: r.unit as string,
      type: r.type as string,
      day: r.day as string,
      fail: !!r.fail,
      pass: !!r.pass,
    })),
  );
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
