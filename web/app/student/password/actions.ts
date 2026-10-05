"use server";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, requireStudent } from "@/lib/session";
import { getPasswordHash } from "@/lib/students";

export type PwState = { ok?: string; error?: string } | undefined;

const slow = () => new Promise((r) => setTimeout(r, 700));

/** 학생이 자기 비밀번호를 바꾼다. 지금 비밀번호를 먼저 확인한다. */
export async function changeMyPassword(_: PwState, form: FormData): Promise<PwState> {
  const me = await requireStudent();
  const current = String(form.get("current") || "");
  const next = String(form.get("next") || "");
  const again = String(form.get("again") || "");
  if (next.length < 4 || next.length > 30) return { error: "새 비밀번호는 4~30자로 정해 주세요." };
  if (next !== again) return { error: "새 비밀번호 두 칸이 서로 달라요." };
  if (next === current) return { error: "지금 비밀번호와 다른 비밀번호로 정해 주세요." };
  try {
    const hash = await getPasswordHash(me.studentId);
    if (!hash || !(await verifyPassword(current, hash))) {
      await slow();
      return { error: "지금 비밀번호가 맞지 않아요." };
    }
    const newHash = await hashPassword(next);
    await db()`update students set password_hash = ${newHash} where student_id = ${me.studentId}`;
    // 이 기기는 로그인을 그대로 두고, 다른 기기의 예전 로그인은 끊는다.
    await createSession({ role: "student", studentId: me.studentId }, newHash);
  } catch (e) {
    console.error("비밀번호 바꾸기 오류", e);
    return { error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
  return { ok: "비밀번호를 바꿨어요. 다른 기기에서 로그인해 둔 것은 끊겼어요." };
}
