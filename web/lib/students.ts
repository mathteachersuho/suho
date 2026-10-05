import "server-only";
import { db } from "./db";

export type Student = { studentId: string; name: string; classId: string; createdAt: Date };

export const ID_RULE = /^[A-Za-z0-9가-힣_]{2,20}$/;

export async function listStudents(): Promise<Student[]> {
  const rows = await db()`
    select student_id, name, class_id, created_at from students order by class_id, name, student_id`;
  return rows.map((r) => ({
    studentId: r.student_id,
    name: r.name,
    classId: r.class_id,
    createdAt: r.created_at,
  }));
}

export async function getStudent(studentId: string): Promise<Student | null> {
  const [r] = await db()`select student_id, name, class_id, created_at from students where student_id = ${studentId}`;
  return r ? { studentId: r.student_id, name: r.name, classId: r.class_id, createdAt: r.created_at } : null;
}

export async function getPasswordHash(studentId: string): Promise<string | null> {
  const [r] = await db()`select password_hash from students where student_id = ${studentId}`;
  return r ? r.password_hash : null;
}
