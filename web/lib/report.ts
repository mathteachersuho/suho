import "server-only";
import { db } from "./db";

/*
 * 학부모 리포트: 기간 안의 숙제 결과·시험 점수를 모은다.
 * 날짜는 모두 서울 기준 YYYY-MM-DD. 숙제는 낸 날(created_at), 시험은 본 날(taken_on)로 기간에 넣는다.
 */

export type Exam = { id: string; takenOn: string; kind: string; name: string; score: number | null; maxScore: number | null; memo: string };
export const EXAM_KINDS = ["학원", "학교"] as const;

const toExam = (r: Record<string, unknown>): Exam => ({
  id: r.id as string,
  takenOn: r.taken_on as string,
  kind: r.kind as string,
  name: r.name as string,
  score: r.score === null ? null : Number(r.score),
  maxScore: r.max_score === null ? null : Number(r.max_score),
  memo: r.memo as string,
});

export async function listExams(studentId: string, from = "0001-01-01", to = "9999-12-31"): Promise<Exam[]> {
  const rows = await db()`
    select id, taken_on::text, kind, name, score, max_score, memo from exams
    where student_id = ${studentId} and taken_on between ${from}::date and ${to}::date
    order by taken_on desc, created_at desc
    limit 200`;
  return rows.map(toExam);
}

export async function addExam(studentId: string, e: Omit<Exam, "id">) {
  const id = `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await db()`
    insert into exams (id, student_id, taken_on, kind, name, score, max_score, memo)
    values (${id}, ${studentId}, ${e.takenOn}::date, ${e.kind}, ${e.name}, ${e.score}, ${e.maxScore}, ${e.memo})`;
  return id;
}

export async function deleteExam(studentId: string, id: string) {
  const r = await db()`delete from exams where id = ${id} and student_id = ${studentId}`;
  return r.count > 0;
}

export type HwScore = { hwId: string; day: string; title: string; total: number; right: number; wrong: number; pending: number; submitted: boolean };
export type UnitStat = { unit: string; total: number; right: number };
export type WeakType = { unit: string; type: string; total: number; right: number };
export type ReportWrong = { id: string; day: string; unit: string; type: string; question: string; answer: string; myAnswer: string };

export type ReportData = {
  from: string;
  to: string;
  hw: HwScore[]; // 오래된 순
  exams: Exam[]; // 오래된 순
  solved: number; // 채점된(O/X) 문제 수
  right: number;
  units: UnitStat[];
  weak: WeakType[];
  wrong: ReportWrong[];
};

export async function buildReport(studentId: string, from: string, to: string): Promise<ReportData> {
  const sql = db();
  const [hwRows, exams, unitRows, typeRows, wrongRows] = await Promise.all([
    sql`
      select h.hw_id, h.title, (h.created_at at time zone 'Asia/Seoul')::date::text as day,
        (select count(*) from homework_problems p where p.hw_id = h.hw_id)::int as total,
        count(r.problem_id) filter (where r.correct = 'Y')::int as right,
        count(r.problem_id) filter (where r.correct = 'N')::int as wrong,
        count(r.problem_id) filter (where r.correct in ('?', ''))::int as pending,
        count(r.problem_id) > 0 as submitted
      from homework h
      join homework_students hs on hs.hw_id = h.hw_id and hs.student_id = ${studentId}
      left join hw_results r on r.hw_id = h.hw_id and r.student_id = hs.student_id
      where (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      group by h.hw_id
      order by h.created_at`,
    listExams(studentId, from, to),
    sql`
      select p.unit, count(*)::int as total, count(*) filter (where r.correct = 'Y')::int as right
      from hw_results r join homework h on h.hw_id = r.hw_id join problems p on p.id = r.problem_id
      where r.student_id = ${studentId} and r.correct in ('Y', 'N') and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      group by p.unit order by p.unit`,
    sql`
      select p.unit, p.type, count(*)::int as total, count(*) filter (where r.correct = 'Y')::int as right
      from hw_results r join homework h on h.hw_id = r.hw_id join problems p on p.id = r.problem_id
      where r.student_id = ${studentId} and r.correct in ('Y', 'N') and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      group by p.unit, p.type`,
    sql`
      select distinct on (h.created_at, p.id) p.id, p.unit, p.type, p.question, p.answer, r.answer as my_answer,
        (h.created_at at time zone 'Asia/Seoul')::date::text as day
      from hw_results r join homework h on h.hw_id = r.hw_id join problems p on p.id = r.problem_id
      where r.student_id = ${studentId} and r.correct = 'N' and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      order by h.created_at desc, p.id
      limit 10`,
  ]);
  const hw = hwRows.map((r) => ({
    hwId: r.hw_id as string,
    day: r.day as string,
    title: r.title as string,
    total: r.total as number,
    right: r.right as number,
    wrong: r.wrong as number,
    pending: r.pending as number,
    submitted: r.submitted as boolean,
  }));
  const units = unitRows.map((r) => ({ unit: (r.unit as string) || "단원 없음", total: r.total as number, right: r.right as number }));
  // 보완이 필요한 유형: 2문제 이상 풀었고 정답률 80% 미만, 정답률 낮은 순 5개
  const weak = typeRows
    .map((r) => ({ unit: r.unit as string, type: (r.type as string) || "유형 없음", total: r.total as number, right: r.right as number }))
    .filter((t) => t.total >= 2 && t.right / t.total < 0.8)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total)
    .slice(0, 5);
  return {
    from,
    to,
    hw,
    exams: [...exams].reverse(),
    solved: units.reduce((a, u) => a + u.total, 0),
    right: units.reduce((a, u) => a + u.right, 0),
    units,
    weak,
    wrong: wrongRows.map((r) => ({
      id: r.id as string,
      day: r.day as string,
      unit: r.unit as string,
      type: r.type as string,
      question: r.question as string,
      answer: r.answer as string,
      myAnswer: r.my_answer as string,
    })),
  };
}

