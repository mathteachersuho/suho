"use client";

import { useState, useTransition } from "react";
import DifficultyBadge from "@/components/DifficultyBadge";
import { IconPlus, IconSparkle, IconX } from "@/components/Icons";
import { DIFFICULTIES } from "@/lib/difficulty";
import { quickPickAction, type QuickPreview } from "../actions";
import type { OutlineRow } from "./WeakPlanner";

export type QuickRow = { grade: string; unit: string; type: string; frame: string; difficulty: string; count: number };
/** 뽑은 문제와 그때 받는 학생 (학생이 바뀌면 다시 뽑아야 하므로 같이 기억한다) */
export type QuickPicked = { stuKey: string; ids: string[] };

const STORE = "hw-quick-rows";
const BLANK: QuickRow = { grade: "", unit: "", type: "", frame: "", difficulty: "", count: 5 };
const uniq = (xs: string[]) => [...new Set(xs)];

const loadRows = (): QuickRow[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "null");
    if (Array.isArray(v) && v.length) return v.slice(0, 10).map((r) => ({ ...BLANK, ...r }));
  } catch {}
  return [{ ...BLANK }];
};
const saveRows = (rows: QuickRow[]) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(rows));
  } catch {}
};

/**
 * 숙제 내기 › 간단히: 유형·난이도·문제 수만 고르면 문제 은행에서 무작위로 뽑는다.
 * 받는 학생이 아직 안 받은 문제를 먼저 뽑고, 모자라면 받은 학생이 적은 문제로 채운다.
 */
export default function QuickPicker({
  studentIds,
  outline,
  picked,
  onPicked,
}: {
  studentIds: string[];
  outline: OutlineRow[];
  picked: QuickPicked;
  onPicked: (p: QuickPicked) => void;
}) {
  const [rows, setRowsState] = useState<QuickRow[]>(() => (typeof window === "undefined" ? [{ ...BLANK }] : loadRows()));
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [res, setRes] = useState<QuickPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const stuKey = studentIds.join(",");
  const stale = !!res && picked.stuKey !== stuKey;

  const setRows = (next: QuickRow[]) => {
    setRowsState(next);
    saveRows(next);
    // 조건이 바뀌면 뽑은 문제는 버리고 다시 뽑게 한다
    if (res) {
      setRes(null);
      onPicked({ stuKey, ids: [] });
    }
  };
  const edit = (i: number, o: Partial<QuickRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...o } : r)));

  const draw = () => {
    setError("");
    start(async () => {
      const r = await quickPickAction(rows, studentIds, verifiedOnly);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setRes(r);
      onPicked({ stuKey, ids: r.problems.map((p) => p.id) });
    });
  };
  const remove = (id: string) => {
    if (!res) return;
    const next = { ...res, problems: res.problems.filter((p) => p.id !== id) };
    setRes(next);
    onPicked({ stuKey, ids: next.problems.map((p) => p.id) });
  };

  const grades = uniq(outline.map((o) => o.grade));
  const sel = "field w-auto py-1.5 text-sm";
  const ready = rows.some((r) => r.grade);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs text-ink-faint">어떤 유형에서 어떤 난이도로 몇 문제 낼지 고르면, 받는 학생이 안 푼 문제를 무작위로 뽑아요.</p>
        <ol className="space-y-2">
          {rows.map((r, i) => {
            const units = uniq(outline.filter((o) => o.grade === r.grade).map((o) => o.unit));
            const types = uniq(outline.filter((o) => o.grade === r.grade && o.unit === r.unit).map((o) => o.type)).filter(Boolean);
            const frames = outline.find((o) => o.grade === r.grade && o.unit === r.unit && o.type === r.type)?.frames ?? [];
            const info = res && !stale ? res.rows[i] : null;
            return (
              <li key={i} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="학년" value={r.grade} onChange={(e) => edit(i, { grade: e.target.value, unit: "", type: "", frame: "" })} className={sel}>
                    <option value="">학년 고르기</option>
                    {grades.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  <select aria-label="단원" value={r.unit} disabled={!r.grade} onChange={(e) => edit(i, { unit: e.target.value, type: "", frame: "" })} className={`${sel} max-w-[12rem]`}>
                    <option value="">단원 전체</option>
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                  <select aria-label="유형" value={r.type} disabled={!r.unit} onChange={(e) => edit(i, { type: e.target.value, frame: "" })} className={`${sel} max-w-[14rem]`}>
                    <option value="">유형 전체</option>
                    {types.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select aria-label="세부 유형" value={r.frame} disabled={!r.type} onChange={(e) => edit(i, { frame: e.target.value })} className={`${sel} max-w-[14rem]`}>
                    <option value="">세부 유형 전체</option>
                    {frames.map((t) => (
                      <option key={t.frame} value={t.frame}>
                        {t.frame} ({t.n})
                      </option>
                    ))}
                  </select>
                  <select aria-label="난이도" value={r.difficulty} onChange={(e) => edit(i, { difficulty: e.target.value })} className={sel}>
                    <option value="">난이도 전체</option>
                    {DIFFICULTIES.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={30}
                      value={r.count}
                      onChange={(e) => edit(i, { count: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })}
                      aria-label="문제 수"
                      className="field w-16 py-1.5 text-center text-sm tabular-nums"
                    />
                    문제
                  </label>
                  {rows.length > 1 && (
                    <button type="button" aria-label="이 조건 빼기" title="빼기" className="btn-soft ml-auto h-8 w-8 p-0" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      <IconX className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {info && (info.got < r.count || info.fresh < info.got) && (
                  <p className="mt-2 text-xs text-warn">
                    {info.got < r.count ? `조건에 맞는 문제가 ${info.available}개뿐이라 ${info.got}문제만 뽑았어요.` : ""}
                    {info.fresh < info.got ? ` 안 푼 문제가 ${info.fresh}개라 받은 적 있는 문제 ${info.got - info.fresh}개가 섞였어요.` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          {rows.length < 10 && (
            <button type="button" className="btn-soft py-1.5 text-sm" onClick={() => setRows([...rows, { ...rows[rows.length - 1], count: rows[rows.length - 1].count }])}>
              <IconPlus className="h-4 w-4" />
              조건 더하기
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-4 w-4 accent-accent" />
            검수한 문제만
          </label>
          <button type="button" className="btn-main ml-auto py-2" disabled={!ready || busy} onClick={draw}>
            <IconSparkle />
            {busy ? "뽑는 중…" : res ? "다시 뽑기" : "문제 뽑기"}
          </button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>

      {res && (
        <div className={`space-y-2 border-t border-line pt-4 ${busy ? "opacity-60" : ""}`}>
          <h3 className="text-sm font-semibold">뽑은 문제 {stale ? 0 : res.problems.length}개</h3>
          {stale ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-soft">받는 학생이 바뀌었어요. 다시 뽑아 주세요.</p>
          ) : !res.problems.length ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-soft">조건에 맞는 문제가 없어요. 조건을 넓혀 보세요.</p>
          ) : (
            <ol className="space-y-2">
              {res.problems.map((p, i) => (
                <li key={p.id} className="flex gap-3 rounded-xl border border-line p-3">
                  <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                      <DifficultyBadge level={p.difficulty} />
                      {p.tag}
                      {p.seen > 0 && <span className="text-warn">{p.seen}명이 받은 적 있음</span>}
                    </p>
                    <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                  </div>
                  <button type="button" aria-label="이 문제 빼기" title="빼기" className="btn-soft h-8 w-8 shrink-0 p-0" onClick={() => remove(p.id)}>
                    <IconX className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
