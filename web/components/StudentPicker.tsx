"use client";

import Link from "next/link";

export type PickStudent = { studentId: string; name: string; classId: string };

/** 반별로 학생 고르기 (반 전체 고르기·빼기 포함) */
export default function StudentPicker({
  students,
  picked,
  onChange,
}: {
  students: PickStudent[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const classes = [...new Set(students.map((s) => s.classId))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ko")));
  const byClass = (c: string) => students.filter((s) => s.classId === c);
  const toggle = (id: string) => {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange(n);
  };
  const setClass = (c: string, on: boolean) => {
    const n = new Set(picked);
    for (const s of byClass(c)) {
      if (on) n.add(s.studentId);
      else n.delete(s.studentId);
    }
    onChange(n);
  };

  if (!students.length)
    return (
      <p className="text-sm text-ink-soft">
        아직 학생이 없어요. <Link href="/teacher" className="text-accent underline">학생 관리</Link>에서 먼저 추가해 주세요.
      </p>
    );
  return (
    <>
      {classes.map((c) => {
        const list = byClass(c);
        const all = list.every((s) => picked.has(s.studentId));
        return (
          <div key={c || "none"} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{c || "반 없음"}</span>
              <button type="button" className="btn-soft px-2.5 py-1 text-xs" onClick={() => setClass(c, !all)}>
                {all ? "반 전체 빼기" : "반 전체 고르기"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((s) => {
                const on = picked.has(s.studentId);
                return (
                  <button
                    key={s.studentId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.studentId)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:bg-surface-2"
                    }`}
                  >
                    {s.name || s.studentId}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
