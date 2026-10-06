"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconCheck, IconDown, IconPlus, IconSearch, IconUp, IconX } from "@/components/Icons";
import { cart } from "@/lib/cart";
import { DIFFICULTIES } from "@/lib/difficulty";
import { bankSearchAction, cartPreviewAction, priorCountsAction } from "../actions";
import type { OutlineRow } from "./WeakPlanner";

type Item = { id: string; tag: string; html: string };
type Filter = { grade: string; unit: string; type: string; difficulty: string; q: string; verified: boolean };
const EMPTY: Filter = { grade: "", unit: "", type: "", difficulty: "", q: "", verified: false };
const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * 숙제 내기 › 모두 같은 문제: 문제 은행에서 찾아 고르고, 고른 문제의 순서를 정한다.
 * 고른 문제는 문제 은행의 '담기'와 같은 목록이라 은행에서 담아 온 문제도 그대로 들어온다.
 */
export default function SamePicker({
  ids,
  studentIds,
  nameOf,
  outline,
}: {
  ids: string[];
  studentIds: string[];
  nameOf: (id: string) => string;
  outline: OutlineRow[];
}) {
  const [known, setKnown] = useState<Record<string, Item>>({});
  const [f, setF] = useState<Filter>(EMPTY);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ items: Item[]; total: number; more: boolean; page: number } | null>(null);
  const [searching, startSearch] = useTransition();

  const remember = (items: Item[]) => setKnown((k) => ({ ...k, ...Object.fromEntries(items.map((p) => [p.id, p])) }));

  const search = (next: Filter, page = 1) => {
    startSearch(async () => {
      const r = await bankSearchAction(next, page);
      remember(r.items);
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

  // 은행에서 담아 온 문제처럼 아직 모르는 문제는 따로 불러온다
  const missing = ids.filter((id) => !known[id]).join(",");
  useEffect(() => {
    let alive = true;
    if (missing) cartPreviewAction(missing.split(",")).then((ps) => alive && remember(ps));
    return () => {
      alive = false;
    };
  }, [missing]);

  // 고른 학생이 전에 받은 적 있는 문제 (선생님에게만 보임)
  const [prior, setPrior] = useState<Record<string, { studentId: string; n: number }[]>>({});
  const key = ids.join(",");
  const stuKey = studentIds.join(",");
  useEffect(() => {
    let alive = true;
    if (!key || !stuKey) Promise.resolve().then(() => alive && setPrior({}));
    else priorCountsAction(stuKey.split(","), key.split(",")).then((p) => alive && setPrior(p));
    return () => {
      alive = false;
    };
  }, [key, stuKey]);

  const grades = uniq(outline.map((o) => o.grade));
  const units = uniq(outline.filter((o) => o.grade === f.grade).map((o) => o.unit));
  const types = uniq(outline.filter((o) => o.grade === f.grade && o.unit === f.unit).map((o) => o.type)).filter(Boolean);
  const picked = new Set(ids);
  const sel = "field w-auto py-1.5 text-sm";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">고른 문제 {ids.length}개</h3>
          {ids.length > 0 && (
            <span className="flex gap-3 text-sm">
              <Link href={`/print?ids=${encodeURIComponent(key)}`} className="text-accent underline">
                학습지로 보기
              </Link>
              <button type="button" className="text-ink-soft underline" onClick={() => cart.clear()}>
                모두 빼기
              </button>
            </span>
          )}
        </div>
        {!ids.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-soft">아래에서 문제를 찾아 더해 주세요.</p>
        ) : (
          <ol className="space-y-2">
            {ids.map((id, i) => {
              const p = known[id];
              return (
                <li key={id} className="flex gap-3 rounded-xl border border-line p-3">
                  <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    {!p ? (
                      <p className="text-sm text-ink-faint">불러오는 중…</p>
                    ) : (
                      <>
                        {p.tag && <p className="mb-1 text-xs text-ink-faint">{p.tag}</p>}
                        <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                      </>
                    )}
                    {prior[id]?.length > 0 && (
                      <p className="mt-1.5 text-xs text-warn">다시 푸는 학생: {prior[id].map((x) => `${nameOf(x.studentId)} (이번이 ${x.n + 1}번째)`).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" aria-label="위로" className="btn-soft h-7 w-7 p-0" disabled={i === 0} onClick={() => cart.move(id, -1)}>
                      <IconUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="아래로" className="btn-soft h-7 w-7 p-0" disabled={i === ids.length - 1} onClick={() => cart.move(id, 1)}>
                      <IconDown className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="이 문제 빼기" className="btn-soft h-7 w-7 p-0" onClick={() => cart.remove(id)}>
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">문제 은행에서 찾기</h3>
        <div className="flex flex-wrap gap-2">
          <select aria-label="학년" value={f.grade} onChange={(e) => setFilter({ grade: e.target.value, unit: "", type: "" })} className={sel}>
            <option value="">학년 전체</option>
            {grades.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select aria-label="단원" value={f.unit} disabled={!f.grade} onChange={(e) => setFilter({ unit: e.target.value, type: "" })} className={`${sel} max-w-[12rem]`}>
            <option value="">단원 전체</option>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <select aria-label="유형" value={f.type} disabled={!f.unit} onChange={(e) => setFilter({ type: e.target.value })} className={`${sel} max-w-[14rem]`}>
            <option value="">유형 전체</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select aria-label="난이도" value={f.difficulty} onChange={(e) => setFilter({ difficulty: e.target.value })} className={sel}>
            <option value="">난이도 전체</option>
            {DIFFICULTIES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
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
            <p className="text-xs text-ink-faint">{res.total}문제 중 {res.items.length}개</p>
            <ul className={`space-y-2 ${searching ? "opacity-60" : ""}`}>
              {res.items.map((p) => {
                const on = picked.has(p.id);
                return (
                  <li key={p.id} className={`flex gap-3 rounded-xl border p-3 ${on ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                    <div className="min-w-0 flex-1">
                      {p.tag && <p className="mb-1 text-xs text-ink-faint">{p.tag}</p>}
                      <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                    </div>
                    <button
                      type="button"
                      aria-pressed={on}
                      className={`${on ? "btn-main" : "btn-soft"} shrink-0 self-start px-3 py-1.5 text-sm`}
                      onClick={() => cart.toggle(p.id)}
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
    </div>
  );
}
