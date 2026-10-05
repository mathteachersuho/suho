"use server";

import { revalidatePath } from "next/cache";
import { DIFFICULTIES } from "@/lib/difficulty";
import { deleteProblem, problemUsage, updateProblem, type ProblemEdit } from "@/lib/problems";
import { requireTeacher } from "@/lib/session";

const pid = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

export async function problemUsageAction(id: string) {
  await requireTeacher();
  return problemUsage(pid(id));
}

export async function deleteProblemAction(id: string): Promise<{ error?: string }> {
  await requireTeacher();
  const ok = await deleteProblem(pid(id));
  revalidatePath("/teacher/bank");
  revalidatePath("/teacher/homework", "layout");
  return ok ? {} : { error: "이미 지워졌거나 없는 문제예요." };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const name = (v: unknown, max = 100) => text(v, max).trim();

export async function updateProblemAction(id: string, e: ProblemEdit): Promise<{ error?: string }> {
  await requireTeacher();
  const edit: ProblemEdit = {
    question: text(e?.question, 20_000),
    answer: text(e?.answer, 2000),
    solution: text(e?.solution, 20_000),
    difficulty: (DIFFICULTIES as readonly string[]).includes(e?.difficulty) ? e.difficulty : "",
    verified: !!e?.verified,
    cls: {
      grade: name(e?.cls?.grade),
      unit: name(e?.cls?.unit),
      type: name(e?.cls?.type),
      frame: name(e?.cls?.frame),
      description: name(e?.cls?.description, 300),
    },
  };
  if (!edit.question.trim()) return { error: "문제 내용이 비어 있어요." };
  const c = edit.cls;
  if (!(c.grade && c.unit && c.type && c.frame)) return { error: "학년·단원·유형·문제틀을 모두 정해 주세요." };
  try {
    if (!(await updateProblem(pid(id), edit))) return { error: "지워졌거나 없는 문제예요." };
  } catch (err) {
    console.error("문제 고치기 오류", err);
    return { error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
  revalidatePath("/teacher/bank", "layout");
  return {};
}
