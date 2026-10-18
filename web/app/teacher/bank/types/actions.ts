"use server";

import { revalidatePath } from "next/cache";
import { deleteEmptyFrame, moveFrame, renameType } from "@/lib/taxonomyEdit";
import { requireTeacher } from "@/lib/session";
import { reportError } from "@/lib/reportError";

type Where = { grade: string; unit: string; type: string; frame: string };
type Result = { error?: string; moved?: number; merged?: boolean };

const name = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const where = (w: Where): Where => ({ grade: name(w?.grade), unit: name(w?.unit), type: name(w?.type), frame: name(w?.frame, 120) });

function done() {
  // 유형 이름은 문제 은행·숙제·리포트 곳곳에 보이므로 선생님 화면 전체를 새로 그린다
  revalidatePath("/teacher", "layout");
  revalidatePath("/student", "layout");
}

export async function moveFrameAction(from: Where, to: { type: string; frame: string }, description?: string): Promise<Result> {
  await requireTeacher();
  const f = where(from);
  const t = { type: name(to?.type), frame: name(to?.frame, 120) };
  if (!f.grade || !f.unit) return { error: "학년·단원이 없어요." };
  if (!t.type || !t.frame) return { error: "유형과 세부 유형 이름을 모두 적어 주세요." };
  try {
    const r = await moveFrame(f, t, description === undefined ? undefined : name(description, 300));
    done();
    return r;
  } catch (err) {
    await reportError("세부 유형 고치기", err);
    return { error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

export async function renameTypeAction(grade: string, unit: string, from: string, to: string): Promise<Result> {
  await requireTeacher();
  const [g, u, a, b] = [name(grade), name(unit), name(from), name(to)];
  if (!g || !u) return { error: "학년·단원이 없어요." };
  if (!b) return { error: "새 유형 이름을 적어 주세요." };
  if (a === b) return {};
  try {
    const r = await renameType(g, u, a, b);
    done();
    return r;
  } catch (err) {
    await reportError("유형 이름 바꾸기", err);
    return { error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

export async function deleteFrameAction(w: Where): Promise<Result> {
  await requireTeacher();
  if (!(await deleteEmptyFrame(where(w)))) return { error: "문제가 들어 있어서 지울 수 없어요. 먼저 다른 세부 유형으로 합쳐 주세요." };
  done();
  return {};
}
