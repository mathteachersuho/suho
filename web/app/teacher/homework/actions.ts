"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHomework, deleteHomework, hwTags, markResults, MARKS, tagResults, type Mark } from "@/lib/homework";
import { renderProblemHtml } from "@/lib/mathText";
import { getProblems } from "@/lib/problems";
import { requireTeacher } from "@/lib/session";
import { reportError } from "@/lib/reportError";
import { getStudent } from "@/lib/students";
import { weakPlan, type TypeKey } from "@/lib/weak";

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown, max: number) =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x).map((x) => x.slice(0, 80)))].slice(0, max);

/** 숙제 만들기 화면: 담은 문제를 미리 보여 준다 */
export async function cartPreviewAction(problemIds: string[]) {
  await requireTeacher();
  const ps = await getProblems(ids(problemIds, 60));
  return ps.map((p) => ({ id: p.id, tag: [p.type, p.frame, p.difficulty].filter(Boolean).join(" · "), html: renderProblemHtml(p.question) }));
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
) {
  await requireTeacher();
  const clean = (Array.isArray(marks) ? marks : [])
    .slice(0, 5000)
    .filter((m) => m && typeof m.studentId === "string" && typeof m.problemId === "string" && MARKS.includes(m.correct));
  const cleanTags = (Array.isArray(tags) ? tags : [])
    .slice(0, 5000)
    .filter((t) => t && typeof t.studentId === "string" && typeof t.problemId === "string")
    .map((t) => ({ studentId: t.studentId, problemId: t.problemId, tags: hwTags(t.tags) }));
  try {
    // 채점을 먼저 저장해야 종이 숙제처럼 새로 생긴 칸에도 표시가 붙는다
    const n = (await markResults(s(hwId, 40), clean)) + (await tagResults(s(hwId, 40), cleanTags));
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

export type WeakPreviewType = { grade: string; unit: string; type: string; wrong: number; hard: number; available: number };
export type WeakPreviewProblem = { id: string; typeIndex: number; tag: string; html: string };
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
): Promise<WeakPreview[] | { error: string }> {
  await requireTeacher();
  const n = Math.min(30, Math.max(1, Math.round(Number(count) || 10)));
  try {
    return await Promise.all(
      ids(studentIds, 60).map(async (studentId) => {
        const keys = typeKeys(chosen && typeof chosen === "object" ? chosen[studentId] : null);
        const plan = await weakPlan(studentId, n, !!verifiedOnly, keys);
        // 화면에서는 유형 순서가 아니라 돌아가며 고른 순서(유형이 섞이게)로 보여 준다
        const problems: WeakPreviewProblem[] = [];
        for (let round = 0; ; round++) {
          const row = plan.types.flatMap((t, i) => (t.picked[round] ? [{ p: t.picked[round], i }] : []));
          if (!row.length) break;
          for (const { p, i } of row)
            problems.push({
              id: p.id,
              typeIndex: i,
              tag: [plan.types[i].type, p.frame, p.difficulty && `난이도 ${p.difficulty}`, p.verified && "검수"].filter(Boolean).join(" · "),
              html: renderProblemHtml(p.question),
            });
        }
        return {
          studentId,
          types: plan.types.map((t) => ({ grade: t.grade, unit: t.unit, type: t.type, wrong: t.wrong, hard: t.hard, available: t.available })),
          detected: plan.detected,
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
