"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/session";
import { sameSecret, verifyPassword } from "@/lib/password";
import { clearFailures, lockedMinutes, loginRules, recordFailure } from "@/lib/loginGuard";
import { getPasswordHash } from "@/lib/students";
import { reportError } from "@/lib/reportError";

export type LoginState = { error?: string } | undefined;

// 틀린 비밀번호를 빠르게 여러 번 시도하지 못하게 실패 응답을 조금 늦춘다.
const slow = () => new Promise((r) => setTimeout(r, 700));
const lockedMsg = (m: number) => ({ error: `비밀번호를 여러 번 틀려서 잠시 막혔어요. ${m}분 뒤에 다시 해 주세요.` });

export async function studentLogin(_: LoginState, form: FormData): Promise<LoginState> {
  const id = String(form.get("studentId") || "").trim();
  const pw = String(form.get("password") || "");
  if (!id || !pw) return { error: "아이디와 비밀번호를 모두 적어 주세요." };
  let hash: string | null = null;
  try {
    const rules = await loginRules("student", id);
    const locked = await lockedMinutes(rules);
    if (locked) return lockedMsg(locked);
    hash = await getPasswordHash(id);
    if (!hash || !(await verifyPassword(pw, hash))) {
      await recordFailure(rules);
      await slow();
      return { error: "아이디나 비밀번호가 맞지 않아요." };
    }
    await clearFailures(rules);
  } catch (e) {
    await reportError("학생 로그인", e);
    return { error: "잠시 연결이 안 돼요. 조금 뒤에 다시 해 주세요." };
  }
  await createSession({ role: "student", studentId: id }, hash);
  redirect("/student");
}

export async function teacherLogin(_: LoginState, form: FormData): Promise<LoginState> {
  const pw = String(form.get("password") || "");
  const real = process.env.TEACHER_PASSWORD || "";
  if (!real) return { error: "선생님 비밀번호(TEACHER_PASSWORD)가 아직 설정되지 않았어요." };
  try {
    const rules = await loginRules("teacher");
    const locked = await lockedMinutes(rules);
    if (locked) return lockedMsg(locked);
    if (!pw || !sameSecret(pw, real)) {
      await recordFailure(rules);
      await slow();
      return { error: "비밀번호가 맞지 않아요." };
    }
    await clearFailures(rules);
  } catch (e) {
    await reportError("선생님 로그인", e);
    return { error: "잠시 연결이 안 돼요. 조금 뒤에 다시 해 주세요." };
  }
  await createSession({ role: "teacher" });
  redirect("/teacher");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
