import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow, IconChart } from "@/components/Icons";
import { listStudents } from "@/lib/students";

export const metadata: Metadata = { title: "리포트 · 수학클래스룸" };

export default async function ReportHome() {
  const students = await listStudents();
  const groups = new Map<string, typeof students>();
  for (const s of students) groups.set(s.classId || "", [...(groups.get(s.classId || "") || []), s]);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Reports</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">학부모 리포트</h1>
        <p className="mt-1 text-sm text-ink-soft">학생을 고르면 시험 점수를 넣고, 기간을 정해 리포트를 만들어 인쇄할 수 있어요.</p>
      </div>
      {!students.length ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <IconChart className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 학생이 없어요</p>
          <p className="text-sm text-ink-soft">학생 관리에서 학생을 먼저 추가해 주세요.</p>
        </div>
      ) : (
        [...groups.entries()].map(([classId, list]) => (
          <section key={classId || "none"} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <h2 className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-5 py-3 text-sm font-semibold">
              {classId || "반 미정"}
              <span className="font-normal text-ink-faint">{list.length}명</span>
            </h2>
            <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
              {list.map((s) => (
                <li key={s.studentId}>
                  <Link href={`/teacher/report/${encodeURIComponent(s.studentId)}`} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                      {(s.name || s.studentId).slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{s.name || "(이름 없음)"}</span>
                      <span className="block text-sm text-ink-faint">@{s.studentId}</span>
                    </span>
                    <IconArrow className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
