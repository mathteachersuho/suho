import "server-only";
import { db } from "./db";
import { isDue, reviewKey, reviewLabel, reviewStates } from "./review";

/*
 * 약한 유형 숙제: 학생이 숙제에서 틀렸거나 선생님이 '어려워함'으로 표시한 문제의 유형(학년·단원·유형)을 찾아,
 * 문제 은행에서 그 학생이 아직 받지 않은 같은 유형 문제를 고른다.
 * 같은 묶음(틀린 문제와 함께 만든 유사문제) → 같은 문제틀 → 검수한 문제 → 최신 순으로 먼저 고른다.
 */

export type TypeKey = { grade: string; unit: string; type: string };
export type WeakProblem = { id: string; question: string; frame: string; difficulty: string; verified: boolean };
export type WeakType = {
  grade: string;
  unit: string;
  type: string;
  wrong: number; // 틀린 문제 수
  hard: number; // 어려워함 표시 수
  review: { label: string; due: boolean; done: boolean } | null; // 복습 상태 (lib/review.ts)
  available: number; // 은행에 남은 (아직 안 받은) 같은 유형 문제 수
  picked: WeakProblem[];
};
/** types: 문제를 고른 유형들, detected: 숙제 결과에서 찾은 약한 유형 전부 (선생님이 끈 것 포함) */
export type WeakPlan = { types: WeakType[]; detected: Omit<WeakType, "available" | "picked">[]; untyped: number };

const same = (a: TypeKey, b: TypeKey) => a.grade === b.grade && a.unit === b.unit && a.type === b.type;

/** 유형마다 미리 가져올 후보 수 (한 학생 숙제는 많아야 30문제) */
const PER_TYPE = 30;

/**
 * chosen 이 있으면 선생님이 고른 유형(그 순서대로)으로만 고른다.
 * 없으면 찾은 약한 유형 중 졸업하지 않은 것을 쓴다: 복습 날이 된 유형 먼저, 그다음 많이 틀린 순.
 * dueOnly 면 복습 날이 된 유형만.
 */
export async function weakPlan(
  studentId: string,
  count: number,
  verifiedOnly: boolean,
  chosen?: TypeKey[] | null,
  dueOnly = false,
): Promise<WeakPlan> {
  const sql = db();
  const weak = await sql`
    with mine as (
      select distinct on (r.problem_id) r.problem_id, r.correct = 'N' as wrong, '어려워함' = any(r.tags) as hard, h.created_at
      from hw_results r join homework h on h.hw_id = r.hw_id
      where r.student_id = ${studentId} and (r.correct = 'N' or '어려워함' = any(r.tags))
      order by r.problem_id, h.created_at desc
    )
    select p.grade, p.unit, p.type,
      count(*) filter (where m.wrong)::int as wrong,
      count(*) filter (where m.hard)::int as hard,
      array_agg(p.id) as ids,
      max(m.created_at) as last
    from mine m join problems p on p.id = m.problem_id
    group by p.grade, p.unit, p.type
    order by 2 * count(*) filter (where m.wrong) + count(*) filter (where m.hard) desc, max(m.created_at) desc`;
  const states = new Map(((await reviewStates([studentId])).get(studentId) ?? []).map((r) => [reviewKey(r), r]));
  const reviewOf = (k: TypeKey) => {
    const r = states.get(reviewKey(k));
    return r ? { label: reviewLabel(r), due: isDue(r), done: r.done, dueDay: r.due } : null;
  };
  const detected = weak
    .filter((w) => w.type)
    .map((w) => {
      const k = { grade: w.grade as string, unit: w.unit as string, type: w.type as string };
      return { ...k, wrong: w.wrong as number, hard: w.hard as number, review: reviewOf(k) };
    });
  const untyped = weak.filter((w) => !w.type).reduce((a, w) => a + (w.ids as string[]).length, 0);
  const auto = detected
    .filter((d) => !d.review?.done && (!dueOnly || d.review?.due))
    .map((d, i) => ({ d, i }))
    // 복습 날이 된 유형 먼저 (오래 밀린 것부터), 나머지는 많이 틀린 순 그대로
    .sort((a, b) => Number(!!b.d.review?.due) - Number(!!a.d.review?.due) || (a.d.review?.due ? a.d.review.dueDay.localeCompare(b.d.review!.dueDay) : 0) || a.i - b.i)
    .map(({ d }) => d);
  const typed = chosen
    ? chosen
        .filter((k, i) => k.type && chosen.findIndex((x) => same(x, k)) === i)
        .map((k) => detected.find((d) => same(d, k)) ?? { ...k, wrong: 0, hard: 0, review: reviewOf(k) })
    : auto;
  if (!typed.length) return { types: [], detected, untyped };

  const wrongIds = weak.flatMap((w) => w.ids as string[]);
  const ords = typed.map((_, i) => i);
  const cands = await sql`
    select t.ord, c.id, c.question, c.frame, c.difficulty, c.verified, c.avail
    from unnest(${typed.map((w) => w.grade as string)}::text[], ${typed.map((w) => w.unit as string)}::text[],
                ${typed.map((w) => w.type as string)}::text[], ${ords}::int[]) as t(grade, unit, type, ord)
    cross join lateral (
      select q.id, q.question, q.frame, q.difficulty, q.verified, count(*) over () as avail
      from problems q
      where q.grade = t.grade and q.unit = t.unit and q.type = t.type
        and (${!verifiedOnly} or q.verified)
        and not exists (
          select 1 from homework_problems hp join homework_students hs on hs.hw_id = hp.hw_id
          where hp.problem_id = q.id and hs.student_id = ${studentId})
        and not exists (select 1 from assignments a where a.problem_id = q.id and a.student_id = ${studentId})
      order by
        exists (select 1 from problems w where w.id = any(${wrongIds}) and w.set_id = q.set_id) desc,
        exists (select 1 from problems w where w.id = any(${wrongIds}) and w.type = q.type and w.frame <> '' and w.frame = q.frame) desc,
        q.verified desc, q.created_at desc, q.id
      limit ${PER_TYPE}
    ) c
    order by t.ord`;

  const pool = typed.map(() => [] as WeakProblem[]);
  const avail = typed.map(() => 0);
  for (const c of cands) {
    pool[c.ord].push({ id: c.id, question: c.question, frame: c.frame, difficulty: c.difficulty, verified: c.verified });
    avail[c.ord] = Number(c.avail);
  }
  // 많이 틀린 유형부터 한 문제씩 돌아가며 고른다 → 여러 약한 유형을 고르게 다룬다
  const picked = typed.map(() => [] as WeakProblem[]);
  let left = Math.max(0, count);
  for (let round = 0; left > 0; round++) {
    let took = false;
    for (let i = 0; i < typed.length && left > 0; i++) {
      const p = pool[i][round];
      if (!p) continue;
      picked[i].push(p);
      left--;
      took = true;
    }
    if (!took) break;
  }
  return {
    detected,
    types: typed.map((w, i) => ({
      grade: w.grade,
      unit: w.unit,
      type: w.type,
      wrong: w.wrong,
      hard: w.hard,
      review: w.review && { label: w.review.label, due: w.review.due, done: w.review.done },
      available: avail[i],
      picked: picked[i],
    })),
    untyped,
  };
}
