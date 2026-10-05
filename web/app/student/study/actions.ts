"use server";

import { revalidatePath } from "next/cache";
import { renderProblemHtml } from "@/lib/mathText";
import { requireStudent } from "@/lib/session";
import { checkAnswer, setStar } from "@/lib/study";

const pid = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

/** 다시 풀기 채점 (저장하지 않음) */
export async function checkAction(problemId: string, given: string) {
  const me = await requireStudent();
  const answer = typeof given === "string" ? given.trim().slice(0, 500) : "";
  if (!answer) return { error: "답을 적어 주세요." } as const;
  const r = await checkAnswer(me.studentId, pid(problemId), answer);
  if (!r) return { error: "볼 수 없는 문제예요." } as const;
  return { mark: r.mark, answerHtml: renderProblemHtml(r.answer), solutionHtml: renderProblemHtml(r.solution) } as const;
}

/** 별표(중요 문제) 켜기·끄기 */
export async function starAction(problemId: string, on: boolean) {
  const me = await requireStudent();
  const ok = await setStar(me.studentId, pid(problemId), !!on);
  revalidatePath("/student/stars");
  revalidatePath("/student/wrong");
  return ok;
}
