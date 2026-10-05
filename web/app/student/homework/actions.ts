"use server";

import { revalidatePath } from "next/cache";
import { submitHomework } from "@/lib/homework";
import { requireStudent } from "@/lib/session";

export async function submitAction(hwId: string, answers: Record<string, string>) {
  const me = await requireStudent();
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers && typeof answers === "object" ? answers : {}).slice(0, 100)) {
    if (typeof v === "string") clean[k.slice(0, 80)] = v.slice(0, 500);
  }
  try {
    const r = await submitHomework(me.studentId, String(hwId).slice(0, 40), clean);
    if (r.ok) {
      revalidatePath(`/student/homework/${hwId}`);
      revalidatePath("/student/homework");
      revalidatePath("/student");
    }
    return r;
  } catch (e) {
    console.error("숙제 제출 오류", e);
    return { ok: false as const, error: "제출하지 못했어요. 잠시 뒤 다시 눌러 주세요." };
  }
}
