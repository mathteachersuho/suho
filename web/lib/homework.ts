import "server-only";
import { db } from "./db";
import { answerTemplateWithValues, countSlots, gradeSlots, toAnswer } from "./answerTemplate";
import { gradeAnswer } from "./grade";
import { isReason, type Reason } from "./hwFormat";

/*
 * 숙제: homework(숙제 하나) + homework_students(받는 학생) + homework_problems(문제와 순서) + hw_results(학생·문제마다 답과 O/X).
 * correct: Y 맞음 / N 틀림 / ? 선생님 확인 필요 / '' 아직 안 매김. graded_by: auto(학생 제출 자동 채점) 또는 teacher.
 * 학생은 한 번만 낼 수 있다 (그 숙제에 결과 줄이 하나라도 있으면 낸 것으로 본다). Streamlit 과 같은 규칙.
 */

export type Mark = "" | "Y" | "N" | "?";
export const MARKS: Mark[] = ["", "Y", "N", "?"];

export type HomeworkSummary = {
  hwId: string;
  title: string;
  dueDate: string; // YYYY-MM-DD 또는 ''
  classId: string;
  memo: string;
  createdAt: Date;
  problemCount: number;
  studentCount: number;
  submittedCount: number;
  correctCount: number; // 모든 학생의 맞은 문제 수 합
};

export type HwResult = { studentId: string; problemId: string; answer: string; correct: Mark; gradedBy: string; tags: HwTag[]; reason: Reason | "" };

/**
 * 틀린 이유 칸(hw_results.reason)이 있는가. db/schema.sql 을 다시 실행하기 전에도 화면이 깨지지 않게 확인한다.
 * 한 번 있으면 기억하고, 없으면 다음에 다시 본다.
 */
let reasonOk = false;
export async function reasonReady() {
  if (reasonOk) return true;
  const [r] = await db()`
    select exists (select 1 from information_schema.columns where table_name = 'hw_results' and column_name = 'reason') as ok`;
  reasonOk = !!r?.ok;
  return reasonOk;
}

/** 선생님이 숙제 문제에 붙이는 표시 (학생마다). '틀림'은 Streamlit 이 쓰던 값이라 건드리지 않고 그대로 둔다. */
export const HW_TAGS = ["중요", "어려워함"] as const;
export type HwTag = (typeof HW_TAGS)[number];
export const hwTags = (v: unknown): HwTag[] => (Array.isArray(v) ? HW_TAGS.filter((t) => v.includes(t)) : []);

/** 'hw' + 시각(ms) + 짧은 임의 글자 (여러 학생 숙제를 한 번에 낼 때 겹치지 않게) */
const newHwId = () => `hw${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export async function createHomework(input: {
  title: string;
  dueDate: string;
  classId: string;
  memo: string;
  studentIds: string[];
  problemIds: string[];
}): Promise<{ ok: true; hwId: string } | { ok: false; error: string }> {
  const sql = db();
  return sql.begin(async (tx) => {
    const studs = await tx`select student_id from students where student_id = any(${input.studentIds})`;
    const probs = await tx`select id from problems where id = any(${input.problemIds})`;
    const okStud = new Set(studs.map((r) => r.student_id as string));
    const okProb = new Set(probs.map((r) => r.id as string));
    const students = input.studentIds.filter((s) => okStud.has(s));
    const problems = input.problemIds.filter((p) => okProb.has(p));
    if (!students.length) return { ok: false as const, error: "받는 학생을 한 명 이상 골라 주세요." };
    if (!problems.length) return { ok: false as const, error: "숙제에 넣을 문제가 없어요. 문제 은행에서 담아 오세요." };
    const hwId = newHwId();
    await tx`
      insert into homework (hw_id, title, due_date, class_id, memo)
      values (${hwId}, ${input.title}, ${input.dueDate || null}, ${input.classId}, ${input.memo})`;
    await tx`insert into homework_students ${tx(students.map((student_id) => ({ hw_id: hwId, student_id })))}`;
    await tx`insert into homework_problems ${tx(problems.map((problem_id, i) => ({ hw_id: hwId, problem_id, position: i + 1 })))}`;
    return { ok: true as const, hwId };
  });
}

function toSummary(r: Record<string, unknown>): HomeworkSummary {
  return {
    hwId: r.hw_id as string,
    title: r.title as string,
    dueDate: (r.due as string) || "",
    classId: r.class_id as string,
    memo: r.memo as string,
    createdAt: r.created_at as Date,
    problemCount: Number(r.problem_count),
    studentCount: Number(r.student_count),
    submittedCount: Number(r.submitted_count),
    correctCount: Number(r.correct_count),
  };
}

export type ClassHomework = HomeworkSummary & { day: string }; // day: 낸 날(서울) YYYY-MM-DD

/**
 * 선생님: 낸 숙제 목록을 반별로 (최근 순). 여러 반에 낸 숙제는 반마다 한 줄씩 나오고,
 * 학생 수·낸 학생·맞은 수도 그 반 학생만 센다. classId '' = 반 없음.
 */
export async function listHomeworkByClass(limit = 300): Promise<ClassHomework[]> {
  const rows = await db()`
    with recent as (select * from homework order by created_at desc limit ${limit}),
    res as (
      select r.hw_id, r.student_id, count(*) as n, count(*) filter (where r.correct = 'Y') as y
      from hw_results r join recent h on h.hw_id = r.hw_id
      group by r.hw_id, r.student_id
    ),
    per as (
      select hs.hw_id, coalesce(s.class_id, '') as class_id, hs.student_id, coalesce(res.n, 0) as n, coalesce(res.y, 0) as y
      from homework_students hs join recent h on h.hw_id = hs.hw_id
      left join students s on s.student_id = hs.student_id
      left join res on res.hw_id = hs.hw_id and res.student_id = hs.student_id
    )
    select h.hw_id, h.title, h.due_date::text as due, coalesce(per.class_id, '') as class_id, h.memo, h.created_at,
      (h.created_at at time zone 'Asia/Seoul')::date::text as day,
      (select count(*) from homework_problems p where p.hw_id = h.hw_id) as problem_count,
      count(per.student_id) as student_count,
      count(per.student_id) filter (where per.n > 0) as submitted_count,
      coalesce(sum(per.y), 0) as correct_count
    from recent h left join per on per.hw_id = h.hw_id
    group by h.hw_id, h.title, h.due_date, h.memo, h.created_at, per.class_id
    order by h.created_at desc, class_id`;
  return rows.map((r) => ({ ...toSummary(r), day: r.day as string }));
}

export type HomeworkProblem = { id: string; position: number; question: string; answer: string; solution: string; type: string; frame: string; difficulty: string };

async function hwProblems(hwId: string): Promise<HomeworkProblem[]> {
  const rows = await db()`
    select p.id, hp.position, p.question, p.answer, p.solution, p.type, p.frame, p.difficulty
    from homework_problems hp join problems p on p.id = hp.problem_id
    where hp.hw_id = ${hwId}
    order by hp.position`;
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    question: r.question,
    answer: r.answer,
    solution: r.solution,
    type: r.type,
    frame: r.frame,
    difficulty: r.difficulty,
  }));
}

async function hwResults(hwId: string, studentId?: string): Promise<HwResult[]> {
  const sql = db();
  const ready = await reasonReady();
  const rows = await sql`
    select student_id, problem_id, answer, correct, graded_by, tags, ${ready ? sql`reason` : sql`''`} as reason from hw_results
    where hw_id = ${hwId} ${studentId ? sql`and student_id = ${studentId}` : sql``}`;
  return rows.map((r) => ({ studentId: r.student_id, problemId: r.problem_id, answer: r.answer, correct: r.correct as Mark, gradedBy: r.graded_by, tags: hwTags(r.tags), reason: isReason(r.reason) ? r.reason : "" }));
}

/** 선생님: 숙제 하나의 문제, 받는 학생, 결과 */
export async function getHomework(hwId: string) {
  const [h] = await db()`
    select hw_id, title, due_date::text as due, class_id, memo, created_at, 0 as problem_count, 0 as student_count, 0 as submitted_count, 0 as correct_count
    from homework where hw_id = ${hwId}`;
  if (!h) return null;
  const [problems, students, results] = await Promise.all([
    hwProblems(hwId),
    db()`
      select s.student_id, s.name, s.class_id from homework_students hs join students s on s.student_id = hs.student_id
      where hs.hw_id = ${hwId} order by s.class_id, s.name, s.student_id`,
    hwResults(hwId),
  ]);
  return {
    hw: toSummary(h),
    problems,
    students: students.map((s) => ({ studentId: s.student_id as string, name: s.name as string, classId: s.class_id as string })),
    results,
  };
}

export async function deleteHomework(hwId: string) {
  await db()`delete from homework where hw_id = ${hwId}`;
}

/** 선생님이 O/X를 넣거나 고친다. 학생이 적은 답은 그대로 둔다. */
export async function markResults(hwId: string, marks: { studentId: string; problemId: string; correct: Mark }[]) {
  if (!marks.length) return 0;
  const sql = db();
  return sql.begin(async (tx) => {
    // 이 숙제에 실제로 있는 학생·문제만
    const okS = new Set((await tx`select student_id from homework_students where hw_id = ${hwId}`).map((r) => r.student_id as string));
    const okP = new Set((await tx`select problem_id from homework_problems where hw_id = ${hwId}`).map((r) => r.problem_id as string));
    const ok = marks.filter((m) => okS.has(m.studentId) && okP.has(m.problemId) && MARKS.includes(m.correct));
    const set = ok.filter((m) => m.correct).map((m) => ({ hw_id: hwId, student_id: m.studentId, problem_id: m.problemId, correct: m.correct, graded_by: "teacher" }));
    if (set.length)
      await tx`
        insert into hw_results ${tx(set, "hw_id", "student_id", "problem_id", "correct", "graded_by")}
        on conflict (hw_id, student_id, problem_id) do update
          set correct = excluded.correct, graded_by = excluded.graded_by, updated_at = now()`;
    // 빈칸으로 되돌리기: 학생 답이 있으면 줄은 남기고 O/X만 지우고, 선생님이 넣기만 한 줄은 없앤다
    for (const m of ok.filter((m) => !m.correct)) {
      await tx`delete from hw_results where hw_id = ${hwId} and student_id = ${m.studentId} and problem_id = ${m.problemId} and graded_by = 'teacher' and answer = ''`;
      await tx`update hw_results set correct = '', graded_by = '', updated_at = now()
               where hw_id = ${hwId} and student_id = ${m.studentId} and problem_id = ${m.problemId}`;
    }
    return ok.length;
  });
}

/**
 * 선생님이 중요·어려워함 표시를 바꾼다. 결과 줄이 있는 칸(학생이 냈거나 선생님이 채점한 칸)만 바뀐다.
 * 줄을 새로 만들면 '낸 숙제'로 보이므로 만들지 않는다.
 */
export async function tagResults(hwId: string, tags: { studentId: string; problemId: string; tags: HwTag[] }[]) {
  if (!tags.length) return 0;
  const sql = db();
  return sql.begin(async (tx) => {
    let n = 0;
    for (const t of tags) {
      const r = await tx`
        update hw_results
        set tags = array(select x from unnest(tags) x where x <> all(${HW_TAGS as unknown as string[]})) || ${hwTags(t.tags)}::text[],
            updated_at = now()
        where hw_id = ${hwId} and student_id = ${t.studentId} and problem_id = ${t.problemId}`;
      n += r.count;
    }
    return n;
  });
}

/** 선생님이 틀린 이유를 고른다. 결과 줄이 있는 칸만 바뀐다. reason '' = 지우기 */
export async function setReasons(hwId: string, list: { studentId: string; problemId: string; reason: Reason | "" }[]) {
  if (!list.length || !(await reasonReady())) return 0;
  const sql = db();
  return sql.begin(async (tx) => {
    let n = 0;
    for (const x of list) {
      const r = await tx`
        update hw_results set reason = ${x.reason}, updated_at = now()
        where hw_id = ${hwId} and student_id = ${x.studentId} and problem_id = ${x.problemId}`;
      n += r.count;
    }
    return n;
  });
}

/** 학생: 받은 숙제 목록 (최근 순) + 내 결과 요약 */
export async function studentHomeworkList(studentId: string) {
  const rows = await db()`
    select h.hw_id, h.title, h.due_date::text as due, h.class_id, h.memo, h.created_at,
      (select count(*) from homework_problems p where p.hw_id = h.hw_id) as problem_count,
      1 as student_count,
      (select count(*) > 0 from hw_results r where r.hw_id = h.hw_id and r.student_id = ${studentId})::int as submitted_count,
      (select count(*) from hw_results r where r.hw_id = h.hw_id and r.student_id = ${studentId} and r.correct = 'Y') as correct_count
    from homework h join homework_students hs on hs.hw_id = h.hw_id and hs.student_id = ${studentId}
    order by h.created_at desc
    limit 100`;
  return rows.map(toSummary);
}

/** 학생: 내가 받은 숙제 하나 (받지 않은 숙제면 null) */
export async function getStudentHomework(studentId: string, hwId: string) {
  const [h] = await db()`
    select h.hw_id, h.title, h.due_date::text as due, h.class_id, h.memo, h.created_at, 0 as problem_count, 1 as student_count, 0 as submitted_count, 0 as correct_count
    from homework h join homework_students hs on hs.hw_id = h.hw_id and hs.student_id = ${studentId}
    where h.hw_id = ${hwId}`;
  if (!h) return null;
  const [problems, results] = await Promise.all([hwProblems(hwId), hwResults(hwId, studentId)]);
  // 틀린 이유는 선생님 화면과 리포트에만 쓴다
  return { hw: toSummary(h), problems, results: results.map((r) => ({ ...r, reason: "" as const })) };
}

/** 학생 제출: 서버에서 정답과 비교해 채점하고 저장한다. 이미 냈으면 다시 받지 않는다. */
export async function submitHomework(
  studentId: string,
  hwId: string,
  answers: Record<string, string>,
  slots: Record<string, string[]> = {},
): Promise<{ ok: true; correct: number; total: number } | { ok: false; error: string }> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [mine] = await tx`select 1 from homework_students where hw_id = ${hwId} and student_id = ${studentId}`;
    if (!mine) return { ok: false as const, error: "받은 숙제가 아니에요." };
    // 같은 학생이 동시에 두 번 눌러도 한 번만 저장되게 이 학생의 줄을 잠근다
    await tx`select pg_advisory_xact_lock(hashtext(${hwId + "/" + studentId}))`;
    const [done] = await tx`select 1 from hw_results where hw_id = ${hwId} and student_id = ${studentId} limit 1`;
    if (done) return { ok: false as const, error: "이미 낸 숙제예요." };
    const probs = await tx`
      select p.id, p.answer from homework_problems hp join problems p on p.id = hp.problem_id where hp.hw_id = ${hwId}`;
    const rows = probs.map((p) => {
      const base = { hw_id: hwId, student_id: studentId, problem_id: p.id as string, graded_by: "auto" };
      // 숫자만 넣는 답 틀로 낸 답은 빈칸 숫자를 정답 숫자와 비교한다 (꼴만 다르거나 판단이 어려우면 '?')
      const tpl = Array.isArray(slots[p.id as string]) ? answerTemplateWithValues(p.answer as string) : null;
      // 학생이 푸는 사이 선생님이 정답을 고쳐 빈칸 수가 달라졌으면 글자 답으로 채점한다
      if (tpl && countSlots(tpl) === slots[p.id as string].length) {
        const vals = slots[p.id as string];
        const given = toAnswer(tpl, vals);
        return { ...base, answer: given, correct: given ? gradeSlots(tpl, vals) : "N" };
      }
      const given = String(answers[p.id as string] ?? "").trim().slice(0, 500);
      return { ...base, answer: given, correct: gradeAnswer(given, p.answer as string) };
    });
    if (!rows.length) return { ok: false as const, error: "숙제에 문제가 없어요." };
    await tx`insert into hw_results ${tx(rows, "hw_id", "student_id", "problem_id", "answer", "correct", "graded_by")}`;
    return { ok: true as const, correct: rows.filter((r) => r.correct === "Y").length, total: rows.length };
  });
}

export type Repeat = { n: number; before: (Mark | "-")[] }; // n: 이번이 몇 번째, before: 전에 받았을 때의 결과 ('-' 안 냄)

/**
 * 선생님용: 이 숙제에서 학생이 전에 숙제로 받은 적 있는 문제. "학생\u0000문제" → 몇 번째인지와 전 결과.
 * 이 숙제보다 먼저 낸 숙제만 센다.
 */
export async function homeworkRepeats(hwId: string): Promise<Record<string, Repeat>> {
  const rows = await db()`
    with me as (select created_at, hw_id from homework where hw_id = ${hwId})
    select hs.student_id, hp.problem_id, count(*)::int as n,
      array_agg(coalesce(nullif(r.correct, ''), case when r.problem_id is null then '-' else '' end) order by h.created_at, h.hw_id) as marks
    from homework h
    join homework_students hs on hs.hw_id = h.hw_id
    join homework_problems hp on hp.hw_id = h.hw_id
    left join hw_results r on r.hw_id = h.hw_id and r.student_id = hs.student_id and r.problem_id = hp.problem_id
    where hs.student_id in (select student_id from homework_students where hw_id = ${hwId})
      and hp.problem_id in (select problem_id from homework_problems where hw_id = ${hwId})
      and (h.created_at, h.hw_id) <= (select created_at, hw_id from me)
    group by hs.student_id, hp.problem_id
    having count(*) > 1`;
  return Object.fromEntries(
    rows.map((r) => [`${r.student_id}\u0000${r.problem_id}`, { n: r.n as number, before: (r.marks as (Mark | "-")[]).slice(0, -1) }]),
  );
}

/** 숙제 내기 전에: 고른 학생이 이 문제들을 전에 숙제로 몇 번 받았는지. 문제 → [학생, 받은 횟수] */
export async function priorCounts(studentIds: string[], problemIds: string[]): Promise<Record<string, { studentId: string; n: number }[]>> {
  if (!studentIds.length || !problemIds.length) return {};
  const rows = await db()`
    select hp.problem_id, hs.student_id, count(*)::int as n
    from homework_problems hp join homework_students hs on hs.hw_id = hp.hw_id
    where hp.problem_id = any(${problemIds}) and hs.student_id = any(${studentIds})
    group by hp.problem_id, hs.student_id`;
  const out: Record<string, { studentId: string; n: number }[]> = {};
  for (const r of rows) (out[r.problem_id as string] ??= []).push({ studentId: r.student_id as string, n: r.n as number });
  return out;
}
