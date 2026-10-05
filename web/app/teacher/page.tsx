import { listStudents } from "@/lib/students";
import { deleteStudent, updateStudent } from "./actions";
import { AddStudentForm, DeleteStudentButton, ResetPasswordButton } from "./StudentForms";

const COLORS = ["bg-grape", "bg-bubble", "bg-sky", "bg-mint", "bg-sunny"];

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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl">학생 관리</h1>
          <p className="text-ink-soft">
            학생 {students.length}명 · 반 {classes.length}개
          </p>
        </div>
      </div>

      <AddStudentForm classes={classes} />

      {students.length === 0 ? (
        <div className="card text-center">
          <p className="text-5xl">🐣</p>
          <p className="mt-2 font-bold">아직 학생이 없어요</p>
          <p className="text-sm text-ink-soft">위에서 첫 학생을 추가해 보세요.</p>
        </div>
      ) : (
        [...groups.entries()].map(([classId, list], gi) => (
          <section key={classId || "none"} className="card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-xl">
              <span className={`inline-block h-3 w-3 rounded-full ${COLORS[gi % COLORS.length]}`} />
              {classId || "반 미정"}
              <span className="text-sm font-sans text-ink-soft">{list.length}명</span>
            </h2>
            <ul className="divide-y-2 divide-line">
              {list.map((s) => (
                <li key={s.studentId} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start">
                  <div className="min-w-40">
                    <p className="font-bold">{s.name || "(이름 없음)"}</p>
                    <p className="text-sm text-ink-soft">@{s.studentId}</p>
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
                    <button className="btn-soft px-3 py-2 text-sm">저장</button>
                  </form>
                  <div className="flex flex-wrap items-start gap-2">
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
