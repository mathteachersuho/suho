import "server-only";
import { db } from "./db";
import { reasonReady } from "./homework";
import { isReason, REASONS, type Reason } from "./hwFormat";

/*
 * 학부모 리포트: 기간 안의 숙제 결과·시험 점수를 모은다.
 * 날짜는 모두 서울 기준 YYYY-MM-DD. 숙제는 낸 날(created_at), 시험은 본 날(taken_on)로 기간에 넣는다.
 */

export type ExamProblem = {
  no: string;
  result: "맞음" | "틀림" | "";
  unit: string;
  type: string;
  difficulty: string;
  note: string;
  related: string;
};
/** 시험지 사진 분석 결과 (exams.analysis). Streamlit 에서 만든 것과 모양이 같다. */
export type ExamAnalysis = {
  problems: ExamProblem[];
  summary: string;
  advice: string;
  wrong: string[];
  analyzedAt: string;
};
export type Exam = {
  id: string;
  takenOn: string;
  kind: string;
  name: string;
  score: number | null;
  maxScore: number | null;
  memo: string;
  analysis: ExamAnalysis | null;
};
export const EXAM_KINDS = ["학원", "학교"] as const;

const str = (v: unknown, max = 400) =>
  typeof v === "string" || typeof v === "number"
    ? String(v).trim().slice(0, max)
    : "";

/** 저장된 분석(JSON)을 믿지 않고 모양을 맞춘다. 문항이 없으면 null. */
export function parseAnalysis(v: unknown): ExamAnalysis | null {
  const o =
    typeof v === "string"
      ? (() => {
          try {
            return JSON.parse(v);
          } catch {
            return null;
          }
        })()
      : v;
  if (!o || typeof o !== "object") return null;
  const a = o as Record<string, unknown>;
  const problems = (Array.isArray(a.problems) ? a.problems : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .slice(0, 60)
    .map((p) => {
      const r = str(p.result, 4);
      return {
        no: str(p.no, 10),
        result: (r === "맞음" || r === "틀림"
          ? r
          : "") as ExamProblem["result"],
        unit: str(p.unit, 60),
        type: str(p.type, 80),
        difficulty: str(p.difficulty, 4),
        note: str(p.note, 200),
        related: str(p.related, 120),
      };
    });
  if (!problems.length) return null;
  return {
    problems,
    summary: str(a.summary, 2000),
    advice: str(a.advice, 1500),
    wrong: (Array.isArray(a.wrong) ? a.wrong : [])
      .map((x) => str(x, 10))
      .filter(Boolean),
    analyzedAt: str(a.analyzedAt ?? a.analyzed_at, 10),
  };
}

const toExam = (r: Record<string, unknown>): Exam => ({
  id: r.id as string,
  takenOn: r.taken_on as string,
  kind: r.kind as string,
  name: r.name as string,
  score: r.score === null ? null : Number(r.score),
  maxScore: r.max_score === null ? null : Number(r.max_score),
  memo: r.memo as string,
  analysis: parseAnalysis(r.analysis),
});

export async function listExams(
  studentId: string,
  from = "0001-01-01",
  to = "9999-12-31",
): Promise<Exam[]> {
  const rows = await db()`
    select id, taken_on::text, kind, name, score, max_score, memo, analysis from exams
    where student_id = ${studentId} and taken_on between ${from}::date and ${to}::date
    order by taken_on desc, created_at desc
    limit 200`;
  return rows.map(toExam);
}

export async function getExam(
  studentId: string,
  id: string,
): Promise<Exam | null> {
  const [r] = await db()`
    select id, taken_on::text, kind, name, score, max_score, memo, analysis from exams where id = ${id} and student_id = ${studentId}`;
  return r ? toExam(r) : null;
}

export async function setExamAnalysis(
  studentId: string,
  id: string,
  a: ExamAnalysis,
) {
  await db()`update exams set analysis = ${db().json(a)} where id = ${id} and student_id = ${studentId}`;
}

export async function addExam(
  studentId: string,
  e: Omit<Exam, "id" | "analysis">,
) {
  const id = `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await db()`
    insert into exams (id, student_id, taken_on, kind, name, score, max_score, memo)
    values (${id}, ${studentId}, ${e.takenOn}::date, ${e.kind}, ${e.name}, ${e.score}, ${e.maxScore}, ${e.memo})`;
  return id;
}

export async function deleteExam(studentId: string, id: string) {
  const r =
    await db()`delete from exams where id = ${id} and student_id = ${studentId}`;
  return r.count > 0;
}

export type HwScore = {
  hwId: string;
  day: string;
  title: string;
  total: number;
  right: number;
  wrong: number;
  pending: number;
  submitted: boolean;
};
export type UnitStat = { unit: string; total: number; right: number };
export type WeakType = {
  unit: string;
  type: string;
  total: number;
  right: number;
  hard: number; // 선생님이 '어려워함'으로 표시한 문제 수
};
export type ReasonCount = { reason: Reason; n: number };
export type ReportWrong = {
  id: string;
  day: string;
  unit: string;
  type: string;
  question: string;
  answer: string;
  myAnswer: string;
  reason: Reason | "";
};

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
  reasons: ReasonCount[]; // 기간 안에 틀렸거나 어려워한 칸의 틀린 이유 개수 (선생님이 고른 것만)
};

export async function buildReport(
  studentId: string,
  from: string,
  to: string,
): Promise<ReportData> {
  const sql = db();
  const ready = await reasonReady();
  const [hwRows, exams, unitRows, typeRows, wrongRows, reasonRows] = await Promise.all([
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
      select p.unit, p.type, count(*)::int as total, count(*) filter (where r.correct = 'Y')::int as right,
        count(*) filter (where '어려워함' = any(r.tags))::int as hard
      from hw_results r join homework h on h.hw_id = r.hw_id join problems p on p.id = r.problem_id
      where r.student_id = ${studentId} and r.correct in ('Y', 'N') and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      group by p.unit, p.type`,
    sql`
      select distinct on (h.created_at, p.id) p.id, p.unit, p.type, p.question, p.answer, r.answer as my_answer,
        ${ready ? sql`r.reason` : sql`''`} as reason,
        (h.created_at at time zone 'Asia/Seoul')::date::text as day
      from hw_results r join homework h on h.hw_id = r.hw_id join problems p on p.id = r.problem_id
      where r.student_id = ${studentId} and r.correct = 'N' and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      order by h.created_at desc, p.id
      limit 10`,
    ready
      ? sql`
      select r.reason, count(*)::int as n
      from hw_results r join homework h on h.hw_id = r.hw_id
      where r.student_id = ${studentId} and r.reason <> '' and (r.correct = 'N' or '어려워함' = any(r.tags))
        and (h.created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date
      group by r.reason`
      : [],
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
  const units = unitRows.map((r) => ({
    unit: (r.unit as string) || "단원 없음",
    total: r.total as number,
    right: r.right as number,
  }));
  // 보완이 필요한 유형: 2문제 이상 풀었고 정답률 80% 미만이거나, 선생님이 어려워함으로 표시한 문제가 있는 유형. 정답률 낮은 순 5개
  const weak = typeRows
    .map((r) => ({
      unit: r.unit as string,
      type: (r.type as string) || "유형 없음",
      total: r.total as number,
      right: r.right as number,
      hard: r.hard as number,
    }))
    .filter((t) => (t.total >= 2 && t.right / t.total < 0.8) || t.hard > 0)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.hard - a.hard || b.total - a.total)
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
      reason: isReason(r.reason) ? r.reason : "",
    })),
    reasons: REASONS.map((reason) => ({ reason, n: Number(reasonRows.find((x) => x.reason === reason)?.n ?? 0) })).filter((x) => x.n > 0),
  };
}
