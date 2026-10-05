import type { Metadata } from "next";
import { todaySeoul } from "@/lib/hwFormat";
import { listStudents } from "@/lib/students";
import NewHomework from "./NewHomework";

export const metadata: Metadata = { title: "숙제 내기 · 수학클래스룸" };

export default async function NewHomeworkPage() {
  const students = await listStudents();
  const today = todaySeoul();
  return (
    <NewHomework
      students={students.map((s) => ({ studentId: s.studentId, name: s.name, classId: s.classId }))}
      today={today}
    />
  );
}
