"use server";

import { revalidatePath } from "next/cache";
import { submitHomework } from "@/lib/homework";
import { requireStudent } from "@/lib/session";
import { reportError } from "@/lib/reportError";

export async function submitAction(hwId: string, answers: Record<string, string>, slots?: Record<string, string[]>) {
  const me = await requireStudent();
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers && typeof answers === "object" ? answers : {}).slice(0, 100)) {
    if (typeof v === "string") clean[k.slice(0, 80)] = v.slice(0, 500);
  }
  // 답 틀에 넣은 숫자 (문제마다 빈칸 순서대로)
  const cleanSlots: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(slots && typeof slots === "object" ? slots : {}).slice(0, 100)) {
    if (Array.isArray(v)) cleanSlots[k.slice(0, 80)] = v.slice(0, 20).map((x) => (typeof x === "string" ? x.slice(0, 20) : ""));
  }
  try {
    const r = await submitHomework(me.studentId, String(hwId).slice(0, 40), clean, cleanSlots);
    if (r.ok) {
      revalidatePath(`/student/homework/${hwId}`);
      revalidatePath("/student/homework");
      revalidatePath("/student");
    }
    return r;
  } catch (e) {
    await reportError("숙제 제출", e);
    return { ok: false as const, error: "제출하지 못했어요. 잠시 뒤 다시 눌러 주세요." };
  }
}
