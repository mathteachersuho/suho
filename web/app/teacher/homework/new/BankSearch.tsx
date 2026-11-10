"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconCheck, IconPlus, IconSearch } from "@/components/Icons";
import DifficultyBadge from "@/components/DifficultyBadge";
import { DIFFICULTIES } from "@/lib/difficulty";
import type { OutlineRow } from "@/lib/problems";
import { bankSearchAction } from "../actions";

export type BankItem = { id: string; tag: string; difficulty: string; html: string };
type Item = BankItem;
type Filter = { grade: string; unit: string; type: string; frame: string; difficulty: string[]; q: string; verified: boolean };
const EMPTY: Filter = { grade: "", unit: "", type: "", frame: "", difficulty: [], q: "", verified: false };
const uniq = (xs: string[]) => [...new Set(xs)];

/** 문제 은행에서 찾아 더하기 (숙제 내기·숙제 고치기에서 같이 쓴다). picked: 지금 고른 문제, onToggle: 더하기/빼기 */
export default function BankSearch({ outline, picked, onToggle }: { outline: OutlineRow[]; picked: string[]; onToggle: (p: Item) => void }) {
  const [f, setF] = useState<Filter>(EMPTY);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ items: Item[]; total: number; more: boolean; page: number } | null>(null);
  const [searching, startSearch] = useTransition();

  const search = (next: Filter, page = 1) => {
    startSearch(async () => {
      const r = await bankSearchAction(next, page);
      setRes((old) => ({ ...r, page, items: page > 1 && old ? [...old.items, ...r.items] : r.items }));
    });
  };
  const setFilter = (o: Partial<Filter>) => {
    const next = { ...f, ...o, q };
    setF(next);
    search(next);
  };

  // 처음에는 최신 문제를 보여 준다
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    search(EMPTY);
  });

  const grades = uniq(outline.map((o) => o.grade));
  const units = uniq(outline.filter((o) => o.grade === f.grade).map((o) => o.unit));
  const types = uniq(outline.filter((o) => o.grade === f.grade && o.unit === f.unit).map((o) => o.type)).filter(Boolean);
  const frames = outline.find((o) => o.grade === f.grade && o.unit === f.unit && o.type === f.type)?.frames ?? [];
  const sel = "field w-auto py-1.5 text-sm";

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">직접 고르기 · 문제 은행에서 찾기</h3>
      <div className="flex flex-wrap gap-2">
        <select aria-label="학년" value={f.grade} onChange={(e) => setFilter({ grade: e.target.value, unit: "", type: "", frame: "" })} className={sel}>
          <option value="">학년 전체</option>
          {grades.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select aria-label="단원" value={f.unit} disabled={!f.grade} onChange={(e) => setFilter({ unit: e.target.value, type: "", frame: "" })} className={`${sel} max-w-[12rem]`}>
          <option value="">단원 전체</option>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <select aria-label="유형" value={f.type} disabled={!f.unit} onChange={(e) => setFilter({ type: e.target.value, frame: "" })} className={`${sel} max-w-[14rem]`}>
          <option value="">유형 전체</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select aria-label="세부 유형" value={f.frame} disabled={!f.type} onChange={(e) => setFilter({ frame: e.target.value })} className={`${sel} max-w-[14rem]`}>
          <option value="">세부 유형 전체</option>
          {frames.map((t) => (
            <option key={t.frame} value={t.frame}>
              {t.frame} ({t.n})
            </option>
          ))}
        </select>
        {/* 난이도는 여러 개 고를 수 있다. 아무것도 안 고르면 전체 */}
        <div className="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="난이도 (여러 개 고르기)">
          {["", ...DIFFICULTIES].map((d) => {
            const on = d ? f.difficulty.includes(d) : f.difficulty.length === 0;
            return (
              <button
                key={d || "all"}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setFilter({ difficulty: !d ? [] : DIFFICULTIES.filter((x) => (x === d ? !on : f.difficulty.includes(x))) })
                }
                className={`block rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-accent ${on ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
              >
                {d || "전체"}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 px-1 text-sm text-ink-soft">
          <input type="checkbox" checked={f.verified} onChange={(e) => setFilter({ verified: e.target.checked })} className="h-4 w-4 accent-accent" />
          검수한 문제만
        </label>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({});
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="문제, 풀이, 유형 이름에서 찾기" className="field py-2" aria-label="검색어" />
        <button className="btn-main shrink-0 whitespace-nowrap py-2">
          <IconSearch />
          검색
        </button>
      </form>

      {!res ? (
        <p className="text-sm text-ink-soft">찾는 중…</p>
      ) : !res.items.length ? (
        <p className="text-sm text-ink-soft">조건에 맞는 문제가 없어요.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">{res.total}문제 중 {res.items.length}개</p>
          <ul className={`space-y-2 ${searching ? "opacity-60" : ""}`}>
            {res.items.map((p) => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id} className={`flex gap-3 rounded-xl border p-3 ${on ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-soft">
                        <DifficultyBadge level={p.difficulty} />
                        {p.tag}
                      </p>
                    <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                  </div>
                  <button
                    type="button"
                    aria-pressed={on}
                    className={`${on ? "btn-main" : "btn-soft"} shrink-0 self-start px-3 py-1.5 text-sm`}
                    onClick={() => onToggle(p)}
                  >
                    {on ? <IconCheck className="h-4 w-4" /> : <IconPlus className="h-4 w-4" />}
                    {on ? "골랐어요" : "더하기"}
                  </button>
                </li>
              );
            })}
          </ul>
          {res.more && (
            <button type="button" className="btn-soft w-full" disabled={searching} onClick={() => search(f, res.page + 1)}>
              {searching ? "불러오는 중…" : "더 보기"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
