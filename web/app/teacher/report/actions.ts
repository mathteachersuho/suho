"use server";

import { revalidatePath } from "next/cache";
import { AiError, geminiJson } from "@/lib/ai/clients";
import { reportPrompt } from "@/lib/ai/reportPrompt";
import { addExam, buildReport, deleteExam, EXAM_KINDS } from "@/lib/report";
import { requireTeacher } from "@/lib/session";
import { getStudent } from "@/lib/students";

type ExamValues = Record<"takenOn" | "kind" | "name" | "score" | "maxScore" | "memo", string>;
// 실패하면 입력한 값을 돌려줘서 칸이 비지 않게 한다
export type ExamState = { ok?: string; error?: string; values?: ExamValues } | undefined;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : NaN;
};

export async function addExamAction(_: ExamState, form: FormData): Promise<ExamState> {
  await requireTeacher();
  const studentId = text(form.get("studentId"), 40);
  const takenOn = text(form.get("takenOn"), 10);
  const kind = text(form.get("kind"), 10);
  const name = text(form.get("name"), 60);
  const score = num(form.get("score"));
  const maxScore = num(form.get("maxScore"));
  const memo = text(form.get("memo"), 200);
  const values = { takenOn, kind, name, memo, score: text(form.get("score"), 20), maxScore: text(form.get("maxScore"), 20) };
  const fail = (error: string) => ({ error, values });
  if (!(await getStudent(studentId))) return fail("학생을 찾지 못했어요.");
  if (!DAY.test(takenOn) || isNaN(Date.parse(takenOn))) return fail("날짜를 골라 주세요.");
  if (!(EXAM_KINDS as readonly string[]).includes(kind)) return fail("학원·학교 중에 골라 주세요.");
  if (!name) return fail("시험 이름을 적어 주세요.");
  if (score === null || Number.isNaN(score)) return fail("점수를 숫자로 적어 주세요.");
  if (maxScore === null || Number.isNaN(maxScore) || maxScore <= 0) return fail("만점을 숫자로 적어 주세요.");
  if (score > maxScore) return fail("점수가 만점보다 커요.");
  await addExam(studentId, { takenOn, kind, name, score, maxScore, memo });
  revalidatePath(`/teacher/report/${encodeURIComponent(studentId)}`);
  return { ok: `${name} 점수를 저장했어요.` };
}

export async function deleteExamAction(studentId: string, id: string) {
  await requireTeacher();
  const ok = await deleteExam(studentId, id);
  revalidatePath(`/teacher/report/${encodeURIComponent(studentId)}`);
  return ok;
}

export async function reportDraftAction(studentId: string, from: string, to: string): Promise<{ analysis?: string; comment?: string; error?: string }> {
  await requireTeacher();
  if (!DAY.test(from) || !DAY.test(to)) return { error: "기간이 올바르지 않아요." };
  const s = await getStudent(studentId);
  if (!s) return { error: "학생을 찾지 못했어요." };
  try {
    const out = await geminiJson(reportPrompt(s.name || s.studentId, await buildReport(studentId, from, to)));
    const analysis = String(out.analysis ?? "").trim();
    const comment = String(out.comment ?? "").trim();
    if (!analysis && !comment) return { error: "AI가 초안을 만들지 못했어요. 다시 눌러 주세요." };
    return { analysis, comment };
  } catch (e) {
    if (!(e instanceof AiError)) console.error("리포트 초안 오류", e);
    return { error: e instanceof AiError ? e.message : "초안을 만들지 못했어요. 다시 눌러 주세요." };
  }
}
