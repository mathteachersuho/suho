import Link from "next/link";
import { IconChart, IconUsers } from "@/components/Icons";
import { listStudents } from "@/lib/students";
import { deleteStudent, updateStudent } from "./actions";
import { AddStudentForm, DeleteStudentButton, ResetPasswordButton } from "./StudentForms";

export default async function TeacherHome() {
  const students = await listStudents();
  const groups = new Map<string, typeof students>();
  for (const s of students) {
    const key = s.classId || "";
    groups.set(key, [...(groups.get(key) || []), s]);
  }
  const classes = [...groups.keys()].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Students</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">학생 관리</h1>
        </div>
        <dl className="flex gap-2">
          <div className="rounded-xl border border-line bg-surface px-4 py-2">
            <dt className="text-xs text-ink-faint">학생</dt>
            <dd className="text-lg font-semibold tabular-nums">{students.length}</dd>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-2">
            <dt className="text-xs text-ink-faint">반</dt>
            <dd className="text-lg font-semibold tabular-nums">{classes.length}</dd>
          </div>
        </dl>
      </div>

      <AddStudentForm classes={classes} />

      {students.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <IconUsers className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 학생이 없어요</p>
          <p className="text-sm text-ink-soft">위에서 첫 학생을 추가해 보세요.</p>
        </div>
      ) : (
        [...groups.entries()].map(([classId, list]) => (
          <section key={classId || "none"} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <h2 className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-5 py-3 text-sm font-semibold">
              {classId || "반 미정"}
              <span className="font-normal text-ink-faint">{list.length}명</span>
            </h2>
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li key={s.studentId} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start">
                  <div className="flex min-w-44 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                      {(s.name || s.studentId).slice(0, 1)}
                    </span>
                    <Link href={`/teacher/students/${encodeURIComponent(s.studentId)}`} className="group">
                      <p className="font-medium leading-tight group-hover:text-accent group-hover:underline">{s.name || "(이름 없음)"}</p>
                      <p className="text-sm text-ink-faint">@{s.studentId}</p>
                    </Link>
                  </div>
                  <form action={updateStudent} className="flex flex-1 flex-wrap gap-2">
                    <input type="hidden" name="studentId" value={s.studentId} />
                    <input name="name" defaultValue={s.name} className="field w-36 py-2" placeholder="이름" aria-label="이름" />
                    <input
                      name="classId"
                      defaultValue={s.classId}
                      className="field w-32 py-2"
                      placeholder="반"
                      aria-label="반"
                      list="class-list"
                    />
                    <button className="btn-soft px-3 py-2">저장</button>
                  </form>
                  <div className="flex flex-wrap items-start gap-2">
                    <Link href={`/teacher/students/${encodeURIComponent(s.studentId)}`} className="btn-soft px-3 py-2">
                      <IconChart />
                      오답·유형
                    </Link>
                    <ResetPasswordButton studentId={s.studentId} />
                    <DeleteStudentButton studentId={s.studentId} action={deleteStudent} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
