"use client";

import Form from "next/form";
import { DIFFICULTIES } from "@/lib/difficulty";

import type { OutlineRow } from "@/lib/problems";

type Current = { grade: string; unit: string; type: string; frame: string; difficulty: string[]; q: string; verified: boolean };

const uniq = (xs: string[]) => [...new Set(xs)];

/** 학년 › 단원 › 유형 › 문제틀(세부 유형) › 난이도 고르기 + 글자 검색. 고르는 즉시 결과가 바뀐다. */
export default function BankFilters({ outline, current }: { outline: OutlineRow[]; current: Current }) {
  const grades = uniq(outline.map((o) => o.grade));
  const units = uniq(outline.filter((o) => o.grade === current.grade).map((o) => o.unit));
  const types = uniq(outline.filter((o) => o.grade === current.grade && o.unit === current.unit).map((o) => o.type));
  const frames = outline.find((o) => o.grade === current.grade && o.unit === current.unit && o.type === current.type)?.frames ?? [];

  // 위 칸을 바꾸면 아래 칸은 '전체'로 되돌린 뒤 바로 검색
  const change = (reset: string[]) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const f = e.currentTarget.form;
    if (!f) return;
    for (const name of reset) {
      const el = f.elements.namedItem(name) as HTMLSelectElement | null;
      if (el) el.value = "";
    }
    f.requestSubmit();
  };

  const select = "field py-2 sm:w-auto sm:min-w-40";
  const chip = "block rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft focus-visible:ring-2 focus-visible:ring-accent";
  const chipOn = "bg-surface text-ink shadow-sm";
  return (
    <Form action="/teacher/bank" replace scroll={false} className="card space-y-3">
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <select name="grade" defaultValue={current.grade} onChange={change(["unit", "type", "frame"])} className={select} aria-label="학년">
          <option value="">학년 전체</option>
          {grades.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select
          name="unit"
          defaultValue={current.unit}
          onChange={change(["type", "frame"])}
          disabled={!current.grade}
          className={select}
          aria-label="단원"
        >
          <option value="">단원 전체</option>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <select name="type" defaultValue={current.type} onChange={change(["frame"])} disabled={!current.unit} className={select} aria-label="유형">
          <option value="">유형 전체</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select name="frame" defaultValue={current.frame} onChange={change([])} disabled={!current.type} className={select} aria-label="세부 유형">
          <option value="">세부 유형 전체</option>
          {frames.map((t) => (
            <option key={t.frame} value={t.frame}>
              {t.frame} ({t.n})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* 난이도는 여러 개 고를 수 있다. 아무것도 안 고르면 전체 */}
        <div className="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="난이도 (여러 개 고르기)">
          <button
            type="button"
            aria-pressed={current.difficulty.length === 0}
            onClick={(e) => {
              const f = e.currentTarget.form;
              if (!f) return;
              f.querySelectorAll<HTMLInputElement>('input[name="difficulty"]').forEach((el) => (el.checked = false));
              f.requestSubmit();
            }}
            className={`${chip} ${current.difficulty.length === 0 ? chipOn : ""}`}
          >
            전체
          </button>
          {DIFFICULTIES.map((d) => (
            <label key={d} className="cursor-pointer">
              <input type="checkbox" name="difficulty" value={d} defaultChecked={current.difficulty.includes(d)} onChange={change([])} className="peer sr-only" />
              <span className={`${chip} peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent`}>{d}</span>
            </label>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-ink-soft">
          <input type="checkbox" name="verified" value="1" defaultChecked={current.verified} onChange={change([])} className="h-4 w-4 accent-accent" />
          검토한 문제만
        </label>
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <input name="q" defaultValue={current.q} placeholder="문제, 풀이, 유형 이름에서 찾기" className="field py-2 sm:w-64" aria-label="검색어" />
          <button className="btn-main shrink-0 whitespace-nowrap py-2">검색</button>
        </div>
      </div>
    </Form>
  );
}
