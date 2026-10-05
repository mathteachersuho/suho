"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { hashPassword, makeTempPassword } from "@/lib/password";
import { requireTeacher } from "@/lib/session";
import { ID_RULE } from "@/lib/students";

export type ActionState =
  | {
      ok?: string;
      error?: string;
      tempPassword?: string;
      studentId?: string;
      // 실패했을 때 입력한 값을 다시 채워 주기 위해 돌려준다
      values?: { studentId: string; name: string; classId: string };
    }
  | undefined;

const clean = (v: FormDataEntryValue | null, max = 30) => String(v || "").trim().slice(0, max);

export async function addStudent(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeacher();
  const studentId = clean(form.get("studentId"), 40);
  const name = clean(form.get("name"));
  const classId = clean(form.get("classId"));
  const values = { studentId, name, classId };
  if (!ID_RULE.test(studentId)) return { error: "아이디는 2~20자의 한글, 영어, 숫자, _ 만 쓸 수 있어요.", values };
  const tempPassword = makeTempPassword();
  try {
    await db()`
      insert into students (student_id, password_hash, class_id, name)
      values (${studentId}, ${await hashPassword(tempPassword)}, ${classId}, ${name})`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { error: `'${studentId}'는 이미 있는 아이디예요.`, values };
    console.error("학생 추가 오류", e);
    return { error: "저장하지 못했어요. 잠시 뒤 다시 해 주세요.", values };
  }
  revalidatePath("/teacher");
  return { ok: `${name || studentId} 학생을 추가했어요.`, tempPassword, studentId };
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  await requireTeacher();
  const studentId = clean(form.get("studentId"), 40);
  const tempPassword = makeTempPassword();
  const rows = await db()`
    update students set password_hash = ${await hashPassword(tempPassword)}
    where student_id = ${studentId} returning student_id`;
  if (!rows.length) return { error: "학생을 찾지 못했어요." };
  return { ok: "새 비밀번호를 만들었어요.", tempPassword, studentId };
}

export async function updateStudent(form: FormData) {
  await requireTeacher();
  const studentId = clean(form.get("studentId"), 40);
  await db()`
    update students set name = ${clean(form.get("name"))}, class_id = ${clean(form.get("classId"))}
    where student_id = ${studentId}`;
  revalidatePath("/teacher");
}

export async function deleteStudent(form: FormData) {
  await requireTeacher();
  const studentId = clean(form.get("studentId"), 40);
  // 학생을 지우면 그 학생에게 배정한 문제, 숙제 기록도 함께 지워진다(표 설계상 cascade).
  await db()`delete from students where student_id = ${studentId}`;
  revalidatePath("/teacher");
}
