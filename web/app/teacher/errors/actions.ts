"use server";

import { revalidatePath } from "next/cache";
import { markErrorsSeen } from "@/lib/errorLog";
import { requireTeacher } from "@/lib/session";

export async function markSeenAction() {
  await requireTeacher();
  await markErrorsSeen();
  revalidatePath("/teacher/errors");
  revalidatePath("/teacher");
}
