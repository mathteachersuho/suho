"use server";

import { revalidatePath } from "next/cache";
import { AiError, geminiJson } from "@/lib/ai/clients";
import { examPrompt } from "@/lib/ai/examPrompt";
import { reportPrompt } from "@/lib/ai/reportPrompt";
import { todaySeoul } from "@/lib/hwFormat";
import { addExam, buildReport, deleteExam, EXAM_KINDS, getExam, parseAnalysis, setExamAnalysis, type ExamAnalysis } from "@/lib/report";
import { requireTeacher } from "@/lib/session";
import { getStudent } from "@/lib/students";
import { typeStats } from "@/lib/study";

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

const B64 = /^[A-Za-z0-9+/=]+$/;
const MAX_PAGES = 6;
const MAX_TOTAL = 4_000_000; // base64 글자 수 합계 (Vercel 요청 한도 4.5MB 안쪽)

/** 시험지 사진으로 문항별 분석. wrongText 에 틀린 번호(예: "3, 7, 서2")를 적으면 그것을 따른다. */
export async function analyzeExamAction(
  studentId: string,
  examId: string,
  images: string[],
  wrongText: string,
): Promise<{ analysis?: ExamAnalysis; error?: string }> {
  await requireTeacher();
  const exam = await getExam(studentId, examId);
  if (!exam) return { error: "시험 기록을 찾지 못했어요." };
  if (!Array.isArray(images) || !images.length) return { error: "시험지 사진을 골라 주세요." };
  if (images.length > MAX_PAGES) return { error: `사진은 ${MAX_PAGES}장까지 올릴 수 있어요.` };
  if (images.some((b) => typeof b !== "string" || !B64.test(b)) || images.reduce((a, b) => a + b.length, 0) > MAX_TOTAL)
    return { error: "사진이 너무 크거나 읽을 수 없는 형식이에요." };
  const wrong = [...new Set(String(wrongText || "").slice(0, 300).match(/서?\d+/g) ?? [])].slice(0, 60);
  try {
    const out = await geminiJson(examPrompt(exam, wrong, await typeStats(studentId)), images);
    const a = parseAnalysis({ ...out, wrong, analyzedAt: todaySeoul() });
    if (!a) return { error: "시험지에서 문항을 찾지 못했어요. 사진이 잘 보이게 다시 찍어 주세요." };
    // 선생님이 틀린 번호를 적었으면 AI 판단보다 그것을 따른다
    if (wrong.length) {
      const set = new Set(wrong.map((w) => w.replace(/\s/g, "")));
      for (const p of a.problems) p.result = set.has(p.no.replace(/\s|번/g, "")) ? "틀림" : "맞음";
    }
    await setExamAnalysis(studentId, examId, a);
    revalidatePath(`/teacher/report/${encodeURIComponent(studentId)}`);
    return { analysis: a };
  } catch (e) {
    if (!(e instanceof AiError)) console.error("시험지 분석 오류", e);
    return { error: e instanceof AiError ? e.message : "분석하지 못했어요. 다시 눌러 주세요." };
  }
}
