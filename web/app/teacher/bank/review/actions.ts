"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { approveItem, processRun, rejectItem, RUN_SIZES, saveGuide, setSkip, startRun, stopRun, undoItem } from "@/lib/bankReview";
import { isKind, type Content } from "@/lib/bankReviewCore";
import { requireTeacher } from "@/lib/session";
import { reportError } from "@/lib/reportError";

type Res = { ok: true; note?: string } | { ok: false; error: string; changed?: boolean };
const sid = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
const PATH = "/teacher/bank/review";

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function guarded(place: string, f: () => Promise<Res>): Promise<Res> {
  await requireTeacher();
  try {
    const r = await f();
    revalidatePath(PATH, "layout");
    return r;
  } catch (e) {
    await reportError(place, e);
    return { ok: false, error: "하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 지금 점검 (멈춰 있는 점검이 있으면 이어서) */
export async function startRunAction(size: number): Promise<Res> {
  return guarded("자동 점검 시작", async () => {
    const n = (RUN_SIZES as readonly number[]).includes(size) ? size : RUN_SIZES[0];
    const r = await startRun("manual", n);
    if (!r.ok) return r;
    if (!r.total) return { ok: true, note: "점검할 문제가 없어요. 모두 최근에 지금 기준으로 봤어요." };
    const o = await origin();
    after(() => processRun(r.runId, o));
    return { ok: true, note: r.resumed ? "멈춰 있던 점검을 이어서 해요." : `${r.total}문제 점검을 시작했어요. 이 화면을 닫아도 계속돼요.` };
  });
}

export async function stopRunAction(runId: string): Promise<Res> {
  return guarded("자동 점검 멈추기", async () => {
    await stopRun(sid(runId));
    return { ok: true };
  });
}

export async function undoAction(itemId: string, force: boolean): Promise<Res> {
  return guarded("자동 수정 되돌리기", () => undoItem(sid(itemId), !!force));
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const content = (c: unknown): Content | null => {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  return { question: text(o.question, 20_000), answer: text(o.answer, 2000), solution: text(o.solution, 20_000) };
};

export async function approveAction(itemId: string, edited: unknown, force: boolean): Promise<Res> {
  return guarded("자동 점검 승인", () => approveItem(sid(itemId), content(edited), !!force));
}

export async function rejectAction(itemId: string, skip: boolean): Promise<Res> {
  return guarded("자동 점검 반려", () => rejectItem(sid(itemId), !!skip));
}

export async function unskipAction(problemId: string): Promise<Res> {
  return guarded("자동 점검 다시 넣기", async () => {
    await setSkip(sid(problemId), false);
    return { ok: true };
  });
}

export async function saveGuideAction(body: unknown, autoKinds: unknown, note: unknown): Promise<Res> {
  return guarded("점검 기준 저장", async () => {
    const b = text(body, 20_000).trim();
    if (!b) return { ok: false, error: "기준이 비어 있어요." };
    const kinds = Array.isArray(autoKinds) ? [...new Set(autoKinds.filter(isKind))] : [];
    const g = await saveGuide(b, kinds, text(note, 200).trim());
    return { ok: true, note: `${g.version}번째 기준으로 저장했어요. 다음 점검부터 이 기준을 따라요.` };
  });
}
