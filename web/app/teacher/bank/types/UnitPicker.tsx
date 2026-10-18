"use client";

import Form from "next/form";
import type { UnitRow } from "@/lib/taxonomyEdit";

const uniq = (xs: string[]) => [...new Set(xs)];

/** 유형 정리: 학년 › 단원 고르기. 고르는 즉시 그 단원의 유형이 나온다. */
export default function UnitPicker({ units, grade, unit }: { units: UnitRow[]; grade: string; unit: string }) {
  const grades = uniq(units.map((u) => u.grade));
  const list = units.filter((u) => u.grade === grade);
  const select = "field py-2 sm:w-auto sm:min-w-48";
  return (
    <Form action="/teacher/bank/types" replace scroll={false} className="card grid gap-2 sm:flex sm:flex-wrap">
      <select
        name="grade"
        defaultValue={grade}
        onChange={(e) => {
          const f = e.currentTarget.form;
          if (!f) return;
          (f.elements.namedItem("unit") as HTMLSelectElement).value = "";
          f.requestSubmit();
        }}
        className={select}
        aria-label="학년"
      >
        <option value="">학년 고르기</option>
        {grades.map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
      <select name="unit" defaultValue={unit} onChange={(e) => e.currentTarget.form?.requestSubmit()} disabled={!grade} className={select} aria-label="단원">
        <option value="">단원 고르기</option>
        {list.map((u) => (
          <option key={u.unit} value={u.unit}>
            {u.unit} ({u.n})
          </option>
        ))}
      </select>
    </Form>
  );
}
