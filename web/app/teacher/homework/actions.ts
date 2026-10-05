"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHomework, deleteHomework, hwTags, markResults, MARKS, tagResults, type Mark } from "@/lib/homework";
import { renderProblemHtml } from "@/lib/mathText";
import { getProblems } from "@/lib/problems";
import { requireTeacher } from "@/lib/session";

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
  }).catch((e) => {
    console.error("숙제 저장 오류", e);
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
    console.error("채점 저장 오류", e);
    return { ok: false as const, error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

export async function deleteHomeworkAction(hwId: string) {
  await requireTeacher();
  await deleteHomework(s(hwId, 40));
  revalidatePath("/teacher/homework");
  redirect("/teacher/homework");
}
