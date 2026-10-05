"use server";

import { revalidatePath } from "next/cache";
import { deleteProblem, problemUsage } from "@/lib/problems";
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
