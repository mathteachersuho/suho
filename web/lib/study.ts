import "server-only";
import { db } from "./db";
import { gradeAnswer } from "./grade";

/*
 * 학생 공부 도구: 오답노트(숙제에서 틀린 문제)와 중요 문제(학생이 별표한 문제).
 * 학생은 자기가 받은 숙제의 문제와, 그 문제와 같은 묶음·같은 문제틀의 비슷한 문제만 볼 수 있다.
 */

export type StudyProblem = {
  id: string;
  grade: string;
  unit: string;
  type: string;
  frame: string;
  difficulty: string;
  question: string;
  answer: string;
  solution: string;
};

export type WrongItem = StudyProblem & {
  myAnswer: string;
  hwTitle: string;
  day: string; // 숙제를 낸 날 (서울) YYYY-MM-DD
  starred: boolean;
  similar: StudyProblem[];
};

const P = (r: Record<string, unknown>, prefix = ""): StudyProblem => ({
  id: r[prefix + "id"] as string,
  grade: r[prefix + "grade"] as string,
  unit: r[prefix + "unit"] as string,
  type: r[prefix + "type"] as string,
  frame: r[prefix + "frame"] as string,
  difficulty: r[prefix + "difficulty"] as string,
  question: r[prefix + "question"] as string,
  answer: r[prefix + "answer"] as string,
  solution: r[prefix + "solution"] as string,
});

/** 이 학생이 숙제로 받은 문제 id들 (하위 질의) */
const received = (studentId: string) => db()`
  select hp.problem_id from homework_problems hp
  join homework_students hs on hs.hw_id = hp.hw_id and hs.student_id = ${studentId}`;

/**
 * 오답노트: 숙제에서 틀린(N) 문제, 최근 순. 같은 문제를 여러 번 틀렸으면 가장 최근 것 하나만.
 * 문제마다 비슷한 문제(같은 묶음 → 같은 문제틀 순서, 아직 받지 않은 것) 2개까지 붙인다.
 */
export async function wrongNotes(studentId: string): Promise<WrongItem[]> {
  const sql = db();
  const rows = await sql`
    with wrong as (
      select distinct on (r.problem_id) r.problem_id, r.answer as my_answer, h.title as hw_title,
        (h.created_at at time zone 'Asia/Seoul')::date::text as day, h.created_at
      from hw_results r join homework h on h.hw_id = r.hw_id
      where r.student_id = ${studentId} and r.correct = 'N'
      order by r.problem_id, h.created_at desc
    )
    select p.id, p.grade, p.unit, p.type, p.frame, p.difficulty, p.question, p.answer, p.solution, p.set_id,
      w.my_answer, w.hw_title, w.day,
      exists(select 1 from stars s where s.student_id = ${studentId} and s.problem_id = p.id) as starred
    from wrong w join problems p on p.id = w.problem_id
    order by w.created_at desc, p.id
    limit 200`;
  if (!rows.length) return [];
  const sims = await sql`
    select w.id as for_id, q.id, q.grade, q.unit, q.type, q.frame, q.difficulty, q.question, q.answer, q.solution
    from problems w
    cross join lateral (
      select * from problems q
      where q.id <> w.id
        and q.id not in (${received(studentId)})
        and ((w.set_id is not null and q.set_id = w.set_id) or (w.frame <> '' and q.type = w.type and q.frame = w.frame))
      order by (q.set_id is not distinct from w.set_id) desc, q.verified desc, q.created_at desc
      limit 2
    ) q
    where w.id = any(${rows.map((r) => r.id as string)})`;
  const byFor = new Map<string, StudyProblem[]>();
  for (const s of sims) {
    const k = s.for_id as string;
    if (!byFor.has(k)) byFor.set(k, []);
    byFor.get(k)!.push(P(s));
  }
  return rows.map((r) => ({
    ...P(r),
    myAnswer: r.my_answer as string,
    hwTitle: r.hw_title as string,
    day: r.day as string,
    starred: r.starred as boolean,
    similar: byFor.get(r.id as string) ?? [],
  }));
}

/** 중요 문제: 학생이 별표한 문제, 별표한 순서(최근 먼저) */
export async function starredProblems(studentId: string): Promise<StudyProblem[]> {
  const rows = await db()`
    select p.id, p.grade, p.unit, p.type, p.frame, p.difficulty, p.question, p.answer, p.solution
    from stars s join problems p on p.id = s.problem_id
    where s.student_id = ${studentId}
    order by s.created_at desc, p.id
    limit 300`;
  return rows.map((r) => P(r));
}

export async function starredIds(studentId: string): Promise<Set<string>> {
  const rows = await db()`select problem_id from stars where student_id = ${studentId}`;
  return new Set(rows.map((r) => r.problem_id as string));
}

/** 학생이 볼 수 있는 문제인가: 숙제로 받은 문제이거나, 받은 문제와 같은 묶음·같은 문제틀인 문제 */
export async function canSee(studentId: string, problemId: string) {
  const [r] = await db()`
    select exists(
      select 1 from problems q
      where q.id = ${problemId} and (
        q.id in (${received(studentId)})
        or exists (
          select 1 from problems w
          where w.id in (${received(studentId)})
            and ((w.set_id is not null and q.set_id = w.set_id) or (w.frame <> '' and q.type = w.type and q.frame = w.frame))
        )
      )
    ) as ok`;
  return !!r?.ok;
}

/** 다시 풀기: 답을 채점만 하고 저장하지 않는다. 볼 수 없는 문제면 null. */
export async function checkAnswer(studentId: string, problemId: string, given: string) {
  if (!(await canSee(studentId, problemId))) return null;
  const [p] = await db()`select answer, solution from problems where id = ${problemId}`;
  if (!p) return null;
  return { mark: gradeAnswer(given, p.answer as string), answer: p.answer as string, solution: p.solution as string };
}

export async function setStar(studentId: string, problemId: string, on: boolean) {
  if (on) {
    if (!(await canSee(studentId, problemId))) return false;
    await db()`insert into stars (student_id, problem_id) values (${studentId}, ${problemId}) on conflict do nothing`;
  } else {
    await db()`delete from stars where student_id = ${studentId} and problem_id = ${problemId}`;
  }
  return true;
}

/** 학생 홈 타일에 보여 줄 개수: 틀린 문제 수, 중요 문제 수 */
export async function studyCounts(studentId: string) {
  const [r] = await db()`
    select
      (select count(distinct problem_id) from hw_results where student_id = ${studentId} and correct = 'N')::int as wrong,
      (select count(*) from stars where student_id = ${studentId})::int as stars`;
  return { wrong: r.wrong as number, stars: r.stars as number };
}
