"use client";

import type { Classification } from "./types";

type Tax = { grade: string; unit: string; type: string; frame: string; description: string };

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * 학년 › 단원 › 유형 › 문제틀 고르기. 기존 이름은 목록에서 고르고, 없으면 그냥 새로 적으면 된다.
 * 문제틀이 유형표에 없으면 '새 문제틀'로 보고 설명 칸을 보여 준다.
 */
export default function ClassPicker({
  id,
  value,
  onChange,
  taxonomy,
}: {
  id: string;
  value: Classification;
  onChange: (v: Classification) => void;
  taxonomy: Tax[];
}) {
  const grades = uniq(taxonomy.map((t) => t.grade));
  const units = uniq(taxonomy.filter((t) => t.grade === value.grade).map((t) => t.unit));
  const types = uniq(taxonomy.filter((t) => t.grade === value.grade && t.unit === value.unit).map((t) => t.type));
  const frames = taxonomy.filter((t) => t.grade === value.grade && t.unit === value.unit && t.type === value.type);
  const known = frames.find((t) => t.frame === value.frame);
  const isNew = !!value.frame && !known;

  const set = (k: keyof Classification) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const next = { ...value, [k]: v };
    if (k === "frame") {
      const hit = frames.find((t) => t.frame === v);
      next.description = hit ? hit.description : known ? "" : value.description;
    }
    onChange(next);
  };

  const field = (k: "grade" | "unit" | "type" | "frame", label: string, list: string[], ph: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      <input value={value[k]} onChange={set(k)} list={`${id}-${k}`} placeholder={ph} className="field py-2" autoComplete="off" />
      <datalist id={`${id}-${k}`}>
        {list.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-4">
        {field("grade", "학년", grades, "예: 중2")}
        {field("unit", "단원", units, "예: 일차함수")}
        {field("type", "유형", types, "예: 그래프의 기울기")}
        {field("frame", "문제틀", frames.map((f) => f.frame), "예: 두 점으로 기울기 구하기")}
      </div>
      {known?.description && <p className="text-xs text-ink-soft">문제틀 설명: {known.description}</p>}
      {isNew && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">새 문제틀</span>
            어떤 조건에서 무엇을 구하는 문제인지 한 문장으로
          </span>
          <input value={value.description} onChange={set("description")} className="field py-2" />
        </label>
      )}
    </div>
  );
}
