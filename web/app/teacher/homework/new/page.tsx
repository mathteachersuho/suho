import type { Metadata } from "next";
import { todaySeoul } from "@/lib/hwFormat";
import { bankOutline } from "@/lib/problems";
import { dueStudents } from "@/lib/review";
import { listStudents } from "@/lib/students";
import NewHomework from "./NewHomework";

export const metadata: Metadata = { title: "숙제 내기 · 수학클래스룸" };

/** ?mode=weak 학생마다 약한 유형, ?s=학생 골라 두기, ?due=1 오늘 복습할 학생을 골라 두고 바로 찾기 */
export default async function NewHomeworkPage({ searchParams }: PageProps<"/teacher/homework/new">) {
  const sp = await searchParams;
  const review = sp.due === "1";
  const [students, outline, due] = await Promise.all([listStudents(), bankOutline(), review ? dueStudents() : null]);
  const want = typeof sp.s === "string" ? sp.s : "";
  return (
    <NewHomework
      students={students.map((s) => ({ studentId: s.studentId, name: s.name, classId: s.classId }))}
      today={todaySeoul()}
      outline={outline}
      mode={sp.mode === "weak" || review ? "weak" : "same"}
      initial={due ? students.filter((s) => due.has(s.studentId)).map((s) => s.studentId) : students.some((s) => s.studentId === want) ? [want] : []}
      review={review}
    />
  );
}
