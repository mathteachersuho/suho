"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHomework, deleteHomework, hwTags, markResults, MARKS, priorCounts, setReasons, tagResults, type Mark } from "@/lib/homework";
import { isReason } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import { DIFFICULTIES } from "@/lib/difficulty";
import { getProblems, PAGE_SIZE, searchProblems } from "@/lib/problems";
import { requireTeacher } from "@/lib/session";
import { reportError } from "@/lib/reportError";
import { getStudent } from "@/lib/students";
import { quickPick, unitCounts } from "@/lib/quick";
import { weakPlan, type TypeKey } from "@/lib/weak";

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown, max: number) =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x).map((x) => x.slice(0, 80)))].slice(0, max);

/** 숙제 만들기 화면: 담은 문제를 미리 보여 준다 */
export async function cartPreviewAction(problemIds: string[]) {
  await requireTeacher();
  const ps = await getProblems(ids(problemIds, 60));
  return ps.map((p) => ({ id: p.id, tag: [p.type, p.frame].filter(Boolean).join(" · "), difficulty: p.difficulty, html: renderProblemHtml(p.question) }));
}

/** 숙제 내기 화면: 문제 은행에서 찾기 (한 쪽 20문제) */
export async function bankSearchAction(f: { grade?: string; unit?: string; type?: string; frame?: string; difficulty?: string[]; q?: string; verified?: boolean }, page: number) {
  await requireTeacher();
  const pg = Math.min(500, Math.max(1, Math.round(Number(page) || 1)));
  const { items, total } = await searchProblems(
    { grade: s(f?.grade, 20), unit: s(f?.unit, 60), type: s(f?.type, 80), frame: s(f?.frame, 120), difficulty: Array.isArray(f?.difficulty) ? DIFFICULTIES.filter((d) => f.difficulty!.includes(d)) : [], q: s(f?.q, 60), verified: !!f?.verified },
    pg,
  );
  return {
    items: items.map((p) => ({
      id: p.id,
      tag: [p.unit, p.type, p.frame, p.verified && "검수"].filter(Boolean).join(" · "),
      difficulty: p.difficulty,
      html: renderProblemHtml(p.question),
    })),
    total,
    more: pg * PAGE_SIZE < total,
  };
}

/** 무작위로 뽑기: 한 단원의 유형 › 세부 유형 › 난이도마다 문제 수 (안 받은 문제 수 포함) */
export async function unitCountsAction(grade: string, unit: string, studentIds: string[], verifiedOnly: boolean) {
  await requireTeacher();
  const g = s(grade, 20);
  const u = s(unit, 60);
  if (!g || !u) return [];
  return unitCounts(g, u, ids(studentIds, 60), !!verifiedOnly);
}

/**
 * 고른 문제 바꾸기: 같은 학년·단원·유형·세부 유형·난이도에서 다른 문제 하나를 고른다.
 * 받는 학생이 안 받은 문제를 먼저 고르고, 지금 고른 문제와 앞서 바꿔 뺀 문제는 되도록 다시 고르지 않는다.
 */
export async function swapProblemAction(
  problemId: string,
  studentIds: string[],
  chosen: string[],
  skipped: string[],
): Promise<{ item: { id: string; tag: string; difficulty: string; html: string } } | { error: string }> {
  await requireTeacher();
  const [p] = await getProblems([s(problemId, 80)]);
  if (!p) return { error: "문제를 찾지 못했어요." };
  const row = { grade: p.grade, unit: p.unit, type: p.type, frame: p.frame, difficulty: p.difficulty, count: 1 };
  const stu = ids(studentIds, 60);
  const keep = [p.id, ...ids(chosen, 200)];
  try {
    // 바꿔 뺀 문제까지 빼고 찾아보고, 없으면 바꿔 뺀 문제도 다시 후보로
    let [r] = await quickPick([row], stu, false, [...keep, ...ids(skipped, 200)]);
    if (!r.picked.length) [r] = await quickPick([row], stu, false, keep);
    const q = r.picked[0];
    if (!q) return { error: "같은 유형·난이도에 다른 문제가 없어요." };
    return {
      item: {
        id: q.id,
        tag: [q.type, q.frame, q.verified && "검수"].filter(Boolean).join(" · "),
        difficulty: q.difficulty,
        html: renderProblemHtml(q.question),
      },
    };
  } catch (e) {
    await reportError("고른 문제 바꾸기", e);
    return { error: "문제를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

export type RandomPick = { items: { id: string; tag: string; difficulty: string; html: string }[]; short: { label: string; want: number; got: number; fresh: number }[] };

/** 무작위로 뽑기: 조건마다 받는 학생이 안 받은 문제를 무작위로 고른다 (이미 고른 문제는 빼고) */
export async function randomPickAction(
  rows: { grade?: string; unit?: string; type?: string; frame?: string | null; difficulty?: string; count?: number }[],
  studentIds: string[],
  verifiedOnly: boolean,
  exclude: string[],
): Promise<RandomPick | { error: string }> {
  await requireTeacher();
  const clean = (Array.isArray(rows) ? rows : [])
    .slice(0, 300)
    .map((r) => ({
      grade: s(r?.grade, 20),
      unit: s(r?.unit, 60),
      type: s(r?.type, 80),
      frame: r?.frame === null || r?.frame === undefined ? null : s(r.frame, 120),
      difficulty: ["하", "중", "상"].includes(s(r?.difficulty, 4)) ? s(r?.difficulty, 4) : "",
      count: Math.min(30, Math.max(0, Math.round(Number(r?.count) || 0))),
    }))
    .filter((r) => r.grade && r.count > 0);
  if (!clean.length) return { error: "뽑을 문제 수를 적어 주세요." };
  if (clean.reduce((a, r) => a + r.count, 0) > 60) return { error: "한 번에 60문제까지 뽑을 수 있어요." };
  try {
    const res = await quickPick(clean, ids(studentIds, 60), !!verifiedOnly, ids(exclude, 200));
    return {
      items: res.flatMap((r) =>
        r.picked.map((p) => ({
          id: p.id,
          tag: [p.type, p.frame, p.verified && "검수"].filter(Boolean).join(" · "),
          difficulty: p.difficulty,
          html: renderProblemHtml(p.question),
        })),
      ),
      short: res.flatMap((r, i) => {
        const c = clean[i];
        const got = r.picked.length;
        const fresh = Math.min(r.fresh, got);
        return got < c.count || fresh < got ? [{ label: [c.type || "유형 없음", c.frame, c.difficulty].filter(Boolean).join(" · "), want: c.count, got, fresh }] : [];
      }),
    };
  } catch (e) {
    await reportError("무작위로 문제 뽑기", e);
    return { error: "문제를 고르지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 숙제 내기 화면: 고른 학생이 담은 문제를 전에 받은 적 있는지 (선생님에게만 보임) */
export async function priorCountsAction(studentIds: string[], problemIds: string[]) {
  await requireTeacher();
  return priorCounts(ids(studentIds, 300), ids(problemIds, 60));
}

export async function createHomeworkAction(input: {
  title: string;
  dueDate: string;
  classId: string;
  memo: string;
  studentIds: string[];
  problemIds: string[];
}): Promise<{ error: string } | { hwId: string }> {
  await requireTeacher();
  const due = s(input.dueDate, 10);
  const r = await createHomework({
    title: s(input.title, 60) || "숙제",
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "",
    classId: s(input.classId, 30),
    memo: s(input.memo, 300),
    studentIds: ids(input.studentIds, 300),
    problemIds: ids(input.problemIds, 60),
  }).catch(async (e) => {
    await reportError("숙제 내기", e);
    return { ok: false as const, error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/teacher/homework");
  return { hwId: r.hwId };
}

export async function markAction(
  hwId: string,
  marks: { studentId: string; problemId: string; correct: Mark }[],
  tags: { studentId: string; problemId: string; tags: string[] }[] = [],
  reasons: { studentId: string; problemId: string; reason: string }[] = [],
) {
  await requireTeacher();
  const clean = (Array.isArray(marks) ? marks : [])
    .slice(0, 5000)
    .filter((m) => m && typeof m.studentId === "string" && typeof m.problemId === "string" && MARKS.includes(m.correct));
  const cleanTags = (Array.isArray(tags) ? tags : [])
    .slice(0, 5000)
    .filter((t) => t && typeof t.studentId === "string" && typeof t.problemId === "string")
    .map((t) => ({ studentId: t.studentId, problemId: t.problemId, tags: hwTags(t.tags) }));
  const cleanReasons = (Array.isArray(reasons) ? reasons : [])
    .slice(0, 5000)
    .filter((x) => x && typeof x.studentId === "string" && typeof x.problemId === "string")
    .map((x) => ({ studentId: x.studentId, problemId: x.problemId, reason: isReason(x.reason) ? x.reason : ("" as const) }));
  try {
    // 채점을 먼저 저장해야 종이 숙제처럼 새로 생긴 칸에도 표시가 붙는다
    const n =
      (await markResults(s(hwId, 40), clean)) + (await tagResults(s(hwId, 40), cleanTags)) + (await setReasons(s(hwId, 40), cleanReasons));
    revalidatePath(`/teacher/homework/${hwId}`);
    revalidatePath("/teacher/homework");
    revalidatePath(`/student/homework/${hwId}`);
    return { ok: true as const, n };
  } catch (e) {
    await reportError("채점 저장", e);
    return { ok: false as const, error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

export async function deleteHomeworkAction(hwId: string) {
  await requireTeacher();
  await deleteHomework(s(hwId, 40));
  revalidatePath("/teacher/homework");
  redirect("/teacher/homework");
}

export type WeakPreviewType = {
  grade: string;
  unit: string;
  type: string;
  wrong: number;
  hard: number;
  review: { label: string; due: boolean; done: boolean } | null;
  available: number;
};
export type WeakPreviewProblem = { id: string; typeIndex: number; tag: string; difficulty: string; html: string };
export type WeakPreview = {
  studentId: string;
  types: WeakPreviewType[]; // 문제를 고른 유형
  detected: Omit<WeakPreviewType, "available">[]; // 숙제 결과에서 찾은 약한 유형 전부
  chosen: boolean; // 선생님이 유형을 직접 골랐는가
  problems: WeakPreviewProblem[];
  untyped: number;
};

const typeKeys = (v: unknown): TypeKey[] | null =>
  Array.isArray(v)
    ? v
        .filter((k) => k && typeof k.type === "string")
        .slice(0, 20)
        .map((k) => ({ grade: s(k.grade, 20), unit: s(k.unit, 60), type: s(k.type, 80) }))
    : null;

/** 약한 유형 숙제: 학생마다 약한 유형과 고른 문제를 미리 보여 준다 */
export async function weakPlanAction(
  studentIds: string[],
  count: number,
  verifiedOnly: boolean,
  chosen: Record<string, TypeKey[]> = {}, // 학생마다 선생님이 고른 유형 (없으면 찾은 약한 유형)
  dueOnly = false, // 복습 날이 된 유형만
): Promise<WeakPreview[] | { error: string }> {
  await requireTeacher();
  const n = Math.min(30, Math.max(1, Math.round(Number(count) || 10)));
  try {
    return await Promise.all(
      ids(studentIds, 60).map(async (studentId) => {
        const keys = typeKeys(chosen && typeof chosen === "object" ? chosen[studentId] : null);
        const plan = await weakPlan(studentId, n, !!verifiedOnly, keys, !!dueOnly);
        // 화면에서는 유형 순서가 아니라 돌아가며 고른 순서(유형이 섞이게)로 보여 준다
        const problems: WeakPreviewProblem[] = [];
        for (let round = 0; ; round++) {
          const row = plan.types.flatMap((t, i) => (t.picked[round] ? [{ p: t.picked[round], i }] : []));
          if (!row.length) break;
          for (const { p, i } of row)
            problems.push({
              id: p.id,
              typeIndex: i,
              tag: [plan.types[i].type, p.frame, p.verified && "검수"].filter(Boolean).join(" · "),
              difficulty: p.difficulty,
              html: renderProblemHtml(p.question),
            });
        }
        return {
          studentId,
          types: plan.types.map((t) => ({ grade: t.grade, unit: t.unit, type: t.type, wrong: t.wrong, hard: t.hard, review: t.review, available: t.available })),
          detected: plan.detected.map((t) => ({
            grade: t.grade,
            unit: t.unit,
            type: t.type,
            wrong: t.wrong,
            hard: t.hard,
            review: t.review && { label: t.review.label, due: t.review.due, done: t.review.done },
          })),
          chosen: !!keys,
          problems,
          untyped: plan.untyped,
        };
      }),
    );
  } catch (e) {
    await reportError("약한 유형 찾기", e);
    return { error: "문제를 고르지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 약한 유형 숙제: 학생마다 따로 숙제를 하나씩 낸다 (학생마다 문제가 다르니까) */
export async function createWeakHomeworkAction(input: {
  title: string;
  dueDate: string;
  memo: string;
  plans: { studentId: string; problemIds: string[] }[];
}): Promise<{ error: string; made: number } | { made: number }> {
  await requireTeacher();
  const due = s(input.dueDate, 10);
  const title = s(input.title, 40) || "약한 유형 숙제";
  const plans = (Array.isArray(input.plans) ? input.plans : []).slice(0, 60);
  let made = 0;
  for (const pl of plans) {
    const st = await getStudent(s(pl?.studentId, 40));
    const problemIds = ids(pl?.problemIds, 60);
    if (!st || !problemIds.length) continue;
    const r = await createHomework({
      title: `${title} · ${st.name || st.studentId}`,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "",
      classId: st.classId,
      memo: s(input.memo, 300),
      studentIds: [st.studentId],
      problemIds,
    }).catch(async (e) => {
      await reportError("약한 유형 숙제 내기", e);
      return { ok: false as const, error: "저장하지 못했어요." };
    });
    if (!r.ok) {
      revalidatePath("/teacher/homework");
      return { error: `${st.name || st.studentId} 숙제를 내지 못했어요. ${made}명은 냈어요. 잠시 뒤 다시 해 주세요.`, made };
    }
    made++;
  }
  revalidatePath("/teacher/homework");
  return { made };
}
