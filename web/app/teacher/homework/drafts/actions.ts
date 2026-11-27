"use server";

import { revalidatePath } from "next/cache";
import { approveDraft, confirmDraftProblem, fillShort, makeDrafts, rejectDraft, removeDraftProblem, reopenDraft, swapDraftProblem, type FillResult, type MakeResult } from "@/lib/hwDraft";
import { reportError } from "@/lib/reportError";
import { requireTeacher } from "@/lib/session";

const PAGE = "/teacher/homework/drafts";
const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown, max: number) =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x).map((x) => x.slice(0, 80)))].slice(0, max);
const SORRY = "저장하지 못했어요. 잠시 뒤 다시 해 주세요.";

/** 초안 만들기: 고른 학생마다 약한 유형 문제로 초안 (학생에게는 안 보임) */
export async function makeDraftsAction(input: {
  studentIds: string[];
  count: number;
  verifiedOnly: boolean;
  dueOnly: boolean;
  title: string;
  dueDate: string;
  memo: string;
}): Promise<MakeResult | { error: string }> {
  await requireTeacher();
  const studentIds = ids(input?.studentIds, 60);
  if (!studentIds.length) return { error: "학생을 한 명 이상 골라 주세요." };
  const due = s(input.dueDate, 10);
  try {
    const r = await makeDrafts({
      studentIds,
      count: Math.min(30, Math.max(1, Math.round(Number(input.count) || 10))),
      verifiedOnly: !!input.verifiedOnly,
      dueOnly: !!input.dueOnly,
      title: s(input.title, 60) || "숙제",
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "",
      memo: s(input.memo, 300),
    });
    revalidatePath(PAGE);
    revalidatePath("/teacher/homework");
    return r;
  } catch (e) {
    await reportError("숙제 초안 만들기", e);
    return { error: "초안을 만들지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

type Done = { ok: true; note?: string } | { ok: false; error: string };

async function run(label: string, f: () => Promise<Done>): Promise<Done> {
  await requireTeacher();
  try {
    const r = await f();
    if (r.ok) revalidatePath(PAGE);
    return r;
  } catch (e) {
    await reportError(label, e);
    return { ok: false, error: SORRY };
  }
}

export async function removeDraftProblemAction(draftId: string, problemId: string) {
  return run("숙제 초안 문제 빼기", () => removeDraftProblem(s(draftId, 40), s(problemId, 80)));
}

export async function swapDraftProblemAction(draftId: string, problemId: string, skipped: string[]) {
  return run("숙제 초안 문제 바꾸기", () => swapDraftProblem(s(draftId, 40), s(problemId, 80), ids(skipped, 200)));
}

export async function confirmDraftProblemAction(draftId: string, problemId: string) {
  const r = await run("숙제 초안 AI 문제 확인", () => confirmDraftProblem(s(draftId, 40), s(problemId, 80)));
  if (r.ok) revalidatePath("/teacher/bank");
  return r;
}

export async function rejectDraftAction(draftId: string) {
  return run("숙제 초안 반려", () => rejectDraft(s(draftId, 40)));
}

export async function reopenDraftAction(draftId: string) {
  return run("숙제 초안 되살리기", () => reopenDraft(s(draftId, 40)));
}

/** 승인: 그 학생 숙제로 낸다 */
export async function approveDraftAction(draftId: string): Promise<{ ok: true; hwId: string } | { ok: false; error: string }> {
  await requireTeacher();
  try {
    const r = await approveDraft(s(draftId, 40));
    if (r.ok) {
      revalidatePath(PAGE);
      revalidatePath("/teacher/homework");
    }
    return r;
  } catch (e) {
    await reportError("숙제 초안 승인", e);
    return { ok: false, error: SORRY };
  }
}

/** 은행이 모자란 유형을 AI 유사문제로 채운다 */
export async function fillShortAction(draftId: string): Promise<FillResult> {
  await requireTeacher();
  try {
    const r = await fillShort(s(draftId, 40));
    if (r.ok) {
      revalidatePath(PAGE);
      revalidatePath("/teacher/bank");
    }
    return r;
  } catch (e) {
    await reportError("숙제 초안 AI로 채우기", e);
    return { ok: false, error: "문제를 만들지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}
