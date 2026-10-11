import "server-only";
import { db } from "./db";

/*
 * 무작위로 뽑기: 선생님이 고른 조건(학년·단원·유형·세부 유형·난이도·문제 수)마다 문제 은행에서 무작위로 고른다.
 * 받는 학생들이 아직 안 받은 문제를 먼저 고르고, 모자라면 받은 학생이 적은 문제부터 채운다.
 */

/** frame 이 null 이면 세부 유형 상관없이, '' 이면 세부 유형이 없는 문제만 */
export type QuickRow = { grade: string; unit: string; type: string; frame: string | null; difficulty: string; count: number };
export type QuickProblem = { id: string; question: string; type: string; frame: string; difficulty: string; verified: boolean; seen: number };
export type QuickResult = { picked: QuickProblem[]; available: number; fresh: number };
export type UnitCount = { type: string; frame: string; difficulty: string; n: number; fresh: number };

const seenBy = (studentIds: string[]) => db()`
  (select count(distinct hs.student_id)::int from homework_problems hp join homework_students hs on hs.hw_id = hp.hw_id
    where hp.problem_id = q.id and hs.student_id = any(${studentIds}))`;

/** 한 단원의 유형 › 세부 유형 › 난이도마다 문제 수와 받는 학생들이 안 받은 문제 수 */
export async function unitCounts(grade: string, unit: string, studentIds: string[], verifiedOnly: boolean): Promise<UnitCount[]> {
  const rows = await db()`
    select q.type, q.frame, q.difficulty, count(*)::int as n, count(*) filter (where ${seenBy(studentIds)} = 0)::int as fresh
    from problems q
    where q.grade = ${grade} and q.unit = ${unit} and (${!verifiedOnly} or q.verified)
    group by q.type, q.frame, q.difficulty
    order by q.type = '', q.type, q.frame = '', q.frame`;
  return rows.map((r) => ({ type: r.type, frame: r.frame, difficulty: r.difficulty, n: r.n, fresh: r.fresh }));
}

/** 조건마다 고른 문제. exclude(이미 고른 문제)와 앞 조건에서 고른 문제는 다시 고르지 않는다. */
export async function quickPick(rows: QuickRow[], studentIds: string[], verifiedOnly: boolean, exclude: string[] = []): Promise<QuickResult[]> {
  const sql = db();
  const taken = [...exclude];
  const out: QuickResult[] = [];
  for (const r of rows) {
    const found = await sql`
      with c as (
        select q.id, q.question, q.type, q.frame, q.difficulty, q.verified, ${seenBy(studentIds)} as seen
        from problems q
        where q.grade = ${r.grade}
          and (${r.unit} = '' or q.unit = ${r.unit})
          and (${r.type} = '' or q.type = ${r.type})
          and (${r.frame === null} or q.frame = ${r.frame ?? ""})
          and (${r.difficulty} = '' or q.difficulty = ${r.difficulty})
          and (${!verifiedOnly} or q.verified)
          and not (q.id = any(${taken}))
      )
      select *, count(*) over ()::int as available, (count(*) filter (where seen = 0) over ())::int as fresh
      from c order by seen, random() limit ${r.count}`;
    const picked = found.map((p) => ({
      id: p.id as string,
      question: p.question as string,
      type: p.type as string,
      frame: p.frame as string,
      difficulty: p.difficulty as string,
      verified: p.verified as boolean,
      seen: p.seen as number,
    }));
    taken.push(...picked.map((p) => p.id));
    out.push({ picked, available: found[0]?.available ?? 0, fresh: found[0]?.fresh ?? 0 });
  }
  return out;
}
