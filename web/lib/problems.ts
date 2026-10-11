import "server-only";
import { db } from "./db";
import { taxonomyId, type TaxRow } from "./taxonomy";

export type Problem = {
  id: string;
  grade: string;
  unit: string;
  type: string;
  frame: string;
  difficulty: string;
  source: string;
  question: string;
  answer: string;
  solution: string;
  verified: boolean;
  createdAt: Date;
};

export type BankFilter = { grade?: string; unit?: string; type?: string; difficulty?: string; q?: string; verified?: boolean };

export const PAGE_SIZE = 20;
export { DIFFICULTIES } from "./difficulty";

const COLS = "id, grade, unit, type, frame, difficulty, source, question, answer, solution, verified, created_at";

function toProblem(r: Record<string, unknown>): Problem {
  return {
    id: r.id as string,
    grade: r.grade as string,
    unit: r.unit as string,
    type: r.type as string,
    frame: r.frame as string,
    difficulty: r.difficulty as string,
    source: r.source as string,
    question: r.question as string,
    answer: r.answer as string,
    solution: r.solution as string,
    verified: r.verified as boolean,
    createdAt: r.created_at as Date,
  };
}

/** 문제 은행 검색: 고른 조건에 맞는 문제를 최신순으로 한 쪽씩, 전체 개수와 함께 한 번에 가져온다. */
export async function searchProblems(f: BankFilter, page: number) {
  const sql = db();
  const conds = [sql`true`];
  if (f.grade) conds.push(sql`grade = ${f.grade}`);
  if (f.unit) conds.push(sql`unit = ${f.unit}`);
  if (f.type) conds.push(sql`type = ${f.type}`);
  if (f.difficulty) conds.push(sql`difficulty = ${f.difficulty}`);
  if (f.verified) conds.push(sql`verified`);
  if (f.q) {
    const like = "%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    // 문제·정답·풀이(검색용 색인이 있는 식)와 유형·문제틀 이름에서 찾는다
    conds.push(sql`((question || ' ' || answer || ' ' || solution) ilike ${like} or type ilike ${like} or frame ilike ${like})`);
  }
  const where = conds.reduce((a, b) => sql`${a} and ${b}`);
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const rows = await sql`
    select ${sql.unsafe(COLS)}, count(*) over () as total
    from problems where ${where}
    order by created_at desc, id desc
    offset ${offset} limit ${PAGE_SIZE}`;
  let total = rows.length ? Number(rows[0].total) : 0;
  if (!rows.length && offset > 0) {
    const [c] = await sql`select count(*)::int as n from problems where ${where}`;
    total = c.n;
  }
  return { items: rows.map(toProblem), total };
}

/** 고르기 칸에 보여 줄 학년 › 단원 › 유형 목록 (문제가 있는 것만, 개수와 함께) */
export async function bankOutline() {
  const rows = await db()`
    select grade, unit, type, count(*)::int as n
    from problems where grade <> ''
    group by grade, unit, type order by grade, unit, type`;
  return rows.map((r) => ({ grade: r.grade as string, unit: r.unit as string, type: r.type as string, n: r.n as number }));
}

/** 학습지용: 고른 순서 그대로 */
export async function getProblems(ids: string[]): Promise<Problem[]> {
  if (!ids.length) return [];
  const rows = await db()`select ${db().unsafe(COLS)} from problems where id = any(${ids})`;
  const byId = new Map(rows.map((r) => [r.id as string, toProblem(r)]));
  return ids.map((id) => byId.get(id)).filter((p): p is Problem => !!p);
}

export type ProblemUsage = { homework: number; answers: number };

/** 지우기 전에 보여 줄 것: 이 문제가 들어간 숙제 수, 학생이 낸 답 수 */
export async function problemUsage(id: string): Promise<ProblemUsage | null> {
  const [r] = await db()`
    select
      exists(select 1 from problems where id = ${id}) as found,
      (select count(*) from homework_problems where problem_id = ${id}) as homework,
      (select count(*) from hw_results where problem_id = ${id}) as answers`;
  if (!r.found) return null;
  return { homework: Number(r.homework), answers: Number(r.answers) };
}

/** 문제 하나를 지운다. 들어 있던 숙제에서도 빠지고 그 문제의 학생 답·배정·별표도 함께 지워진다 (표 설계상 cascade). */
export async function deleteProblem(id: string) {
  const rows = await db()`delete from problems where id = ${id} returning id`;
  return rows.length > 0;
}

export type ProblemEdit = {
  question: string;
  answer: string;
  solution: string;
  difficulty: string;
  verified: boolean;
  cls: TaxRow;
};

/** 고치기 화면용: 문제 하나 + 문제틀 설명 */
export async function getProblemForEdit(id: string) {
  const [r] = await db()`
    select p.*, coalesce(t.description, '') as description,
      (select count(*) from homework_problems hp where hp.problem_id = p.id)::int as homework
    from problems p left join taxonomy t on t.id = p.taxonomy_id
    where p.id = ${id}`;
  if (!r) return null;
  return { ...toProblem(r), description: r.description as string, homework: r.homework as number };
}

/** 저장된 문제를 고친다. 분류가 유형표에 없으면 새로 넣는다. 숙제 기록은 그대로 둔다. */
export async function updateProblem(id: string, e: ProblemEdit) {
  return db().begin(async (sql) => {
    const taxId = await taxonomyId(sql, e.cls);
    const rows = await sql`
      update problems set
        question = ${e.question}, answer = ${e.answer}, solution = ${e.solution},
        difficulty = ${e.difficulty}, verified = ${e.verified}, taxonomy_id = ${taxId},
        grade = ${e.cls.grade}, unit = ${e.cls.unit}, type = ${e.cls.type}, frame = ${e.cls.frame}
      where id = ${id} returning id`;
    return rows.length > 0;
  });
}

/** 문제 만들기에서 겹침 확인용: 같은 학년·단원·유형의 은행 문제 (같은 문제틀 먼저, 최신순) */
export async function sameTypeProblems(t: { grade: string; unit: string; type: string; frame: string }, limit = 200) {
  if (!t.grade || !t.unit || !t.type) return [];
  const rows = await db()`
    select question, answer from problems
    where grade = ${t.grade} and unit = ${t.unit} and type = ${t.type}
    order by (frame = ${t.frame}) desc, created_at desc
    limit ${limit}`;
  return rows.map((r) => ({ question: r.question as string, answer: r.answer as string }));
}
