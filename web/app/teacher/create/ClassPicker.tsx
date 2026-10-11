"use client";

import { useState } from "react";
import type { Classification } from "./types";

type Tax = { grade: string; unit: string; type: string; frame: string; description: string };
type Level = "grade" | "unit" | "type" | "frame";

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
const NEW = "__new__"; // 이름으로 쓸 일 없는 값

/**
 * 학년 › 단원 › 유형 › 문제틀 고르기. 칸마다 지금 있는 이름 중에서 고르거나 '새로 만들기'로 새 이름을 적는다.
 * 위 칸을 바꾸면 아래 칸은 새로 고른다 (단원이 바뀌면 그 단원의 유형만 보여야 하므로).
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

  const CHILDREN: Record<Level, Level[]> = { grade: ["unit", "type", "frame"], unit: ["type", "frame"], type: ["frame"], frame: [] };
  const pick = (k: Level, v: string) => {
    const next = { ...value, [k]: v };
    if (v !== value[k]) for (const c of CHILDREN[k]) next[c] = "";
    // 있는 문제틀이면 그 설명을, 새 문제틀이면 적던 설명을 쓴다 (있던 문제틀에서 새 이름으로 바꾸면 비운다)
    const hit = taxonomy.find((t) => t.grade === next.grade && t.unit === next.unit && t.type === next.type && t.frame === next.frame);
    next.description = hit ? hit.description : known || !next.frame ? "" : value.description;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <LevelField id={`${id}-grade`} label="학년" options={grades} value={value.grade} onPick={(v) => pick("grade", v)} ph="예: 중2" />
        <LevelField id={`${id}-unit`} label="단원" options={units} value={value.unit} onPick={(v) => pick("unit", v)} ph="예: 일차함수" />
        <LevelField id={`${id}-type`} label="유형" options={types} value={value.type} onPick={(v) => pick("type", v)} ph="예: 그래프의 기울기" />
        <LevelField
          id={`${id}-frame`}
          label="문제틀"
          options={frames.map((f) => f.frame)}
          value={value.frame}
          onPick={(v) => pick("frame", v)}
          ph="예: 두 점으로 기울기 구하기"
        />
      </div>
      {known?.description && <p className="text-xs text-ink-soft">문제틀 설명: {known.description}</p>}
      {isNew && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">새 문제틀</span>
            어떤 조건에서 무엇을 구하는 문제인지 한 문장으로
          </span>
          <input value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} className="field py-2" />
        </label>
      )}
    </div>
  );
}

/** 칸 하나: 있는 이름 목록에서 고르기 + '새로 만들기'를 고르면 이름을 적는 칸이 나온다 */
function LevelField({
  id,
  label,
  options,
  value,
  onPick,
  ph,
}: {
  id: string;
  label: string;
  options: string[];
  value: string;
  onPick: (v: string) => void;
  ph: string;
}) {
  // 목록에 없는 이름이면 새로 만드는 중으로 본다
  const [creating, setCreating] = useState(false);
  const typing = creating || (!!value && !options.includes(value));
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-soft">
        {label}
        {typing && value && <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">새 {label}</span>}
      </label>
      <select
        id={id}
        value={typing ? NEW : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW) {
            setCreating(true);
            onPick("");
          } else {
            setCreating(false);
            onPick(v);
          }
        }}
        className="field py-2"
      >
        <option value="">{options.length ? `${label} 고르기` : `${label} 없음`}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={NEW}>+ 새 {label} 만들기</option>
      </select>
      {typing && (
        <input
          value={value}
          onChange={(e) => {
            setCreating(true);
            onPick(e.target.value);
          }}
          placeholder={ph}
          aria-label={`새 ${label} 이름`}
          autoFocus={creating && !value}
          className="field mt-1.5 py-2"
          autoComplete="off"
        />
      )}
    </div>
  );
}
