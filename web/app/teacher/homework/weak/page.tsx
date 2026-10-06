import type { Metadata } from "next";
import { todaySeoul } from "@/lib/hwFormat";
import { bankOutline } from "@/lib/problems";
import { listStudents } from "@/lib/students";
import WeakHomework from "./WeakHomework";

export const metadata: Metadata = { title: "약한 유형 숙제 · 수학클래스룸" };

export default async function WeakHomeworkPage({ searchParams }: PageProps<"/teacher/homework/weak">) {
  const sp = await searchParams;
  const [students, outline] = await Promise.all([listStudents(), bankOutline()]);
  const want = typeof sp.s === "string" ? sp.s : "";
  return (
    <WeakHomework
      students={students.map((s) => ({ studentId: s.studentId, name: s.name, classId: s.classId }))}
      today={todaySeoul()}
      initial={students.some((s) => s.studentId === want) ? [want] : []}
      outline={outline}
    />
  );
}
