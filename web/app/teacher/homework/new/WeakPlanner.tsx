"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconPlus, IconSearch, IconX } from "@/components/Icons";
import { weakPlanAction, type WeakPreview } from "../actions";

const COUNTS = [5, 8, 10, 15, 20];

export type OutlineRow = { grade: string; unit: string; type: string; n: number };
export type WeakOpts = { count: number; verifiedOnly: boolean; dueOnly: boolean };
export type WeakReady = { studentId: string; problemIds: string[] };
type Key = { grade: string; unit: string; type: string };
const keyOf = (k: Key) => `${k.grade}\u0000${k.unit}\u0000${k.type}`;

/**
 * 숙제 내기 › 학생마다 약한 유형: 고른 학생마다 약한 유형을 찾아, 은행에서 아직 안 받은 같은 유형 문제를 고른다.
 * 학생을 바꾸면 부모가 key 를 바꿔 새로 그린다. 낼 수 있는 학생별 문제는 onReady 로 알려 준다.
 */
export default function WeakPlanner({
  studentIds,
  nameOf,
  outline,
  opts,
  onOpts,
  autoFind,
  onReady,
}: {
  studentIds: string[];
  nameOf: (id: string) => string;
  outline: OutlineRow[];
  opts: WeakOpts;
  onOpts: (o: WeakOpts) => void;
  autoFind: boolean; // 복습 숙제로 들어옴: 골라 둔 학생으로 바로 찾는다
  onReady: (r: WeakReady[]) => void;
}) {
  const [plans, setPlans] = useState<WeakPreview[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // "학생/문제"
  const [chosen, setChosen] = useState<Record<string, Key[]>>({}); // 선생님이 직접 고른 유형 (학생마다)
  const [refining, setRefining] = useState("");
  const [error, setError] = useState("");
  const [finding, startFind] = useTransition();

  const keep = (p: WeakPreview, rm: Set<string>) => p.problems.filter((q) => !rm.has(`${p.studentId}/${q.id}`));
  // 미리보기가 바뀔 때마다 낼 수 있는 숙제를 부모에게 알린다
  const commit = (ps: WeakPreview[] | null, rm: Set<string>) => {
    setPlans(ps);
    setRemoved(rm);
    onReady((ps ?? []).map((p) => ({ studentId: p.studentId, problemIds: keep(p, rm).map((q) => q.id) })).filter((r) => r.problemIds.length));
  };

  const setOpt = (o: Partial<WeakOpts>) => {
    commit(null, new Set());
    setError("");
    onOpts({ ...opts, ...o });
  };

  const find = () => {
    setError("");
    startFind(async () => {
      const r = await weakPlanAction(studentIds, opts.count, opts.verifiedOnly, chosen, opts.dueOnly);
      if ("error" in r) return setError(r.error);
      commit(r, new Set());
    });
  };

  const started = useRef(false);
  useEffect(() => {
    if (autoFind && studentIds.length && !started.current) {
      started.current = true;
      find();
    }
  });

  // 한 학생의 유형을 바꾸면 그 학생 문제만 다시 고른다. keys 가 null 이면 찾은 약한 유형으로 되돌린다.
  const refine = async (studentId: string, keys: Key[] | null) => {
    const next = { ...chosen };
    if (keys) next[studentId] = keys;
    else delete next[studentId];
    setChosen(next);
    setRefining(studentId);
    setError("");
    const r = await weakPlanAction([studentId], opts.count, opts.verifiedOnly, next, opts.dueOnly);
    setRefining("");
    if ("error" in r) return setError(r.error);
    commit(
      (plans ?? []).map((p) => (p.studentId === studentId ? r[0] : p)),
      new Set([...removed].filter((x) => !x.startsWith(studentId + "/"))),
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        학생이 숙제에서 틀렸거나 어려움으로 표시한 유형을 찾아, 은행에서 아직 안 받은 같은 유형 문제로 학생마다 따로 숙제를 내요. 틀린 유형은 3일, 7일, 14일
        뒤에 복습할 날이 오고, 복습에서 세 번 맞히면 졸업해요.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">학생마다</span>
          <select value={opts.count} onChange={(e) => setOpt({ count: Number(e.target.value) })} className="field w-auto py-1.5">
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}문제
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={opts.verifiedOnly} onChange={(e) => setOpt({ verifiedOnly: e.target.checked })} className="h-4 w-4 accent-accent" />
          검수한 문제만
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={opts.dueOnly} onChange={(e) => setOpt({ dueOnly: e.target.checked })} className="h-4 w-4 accent-accent" />
          복습 날이 된 유형만
        </label>
        <button type="button" className="btn-main ml-auto" disabled={!studentIds.length || finding} onClick={find}>
          <IconSearch />
          {finding ? "찾는 중…" : plans ? "다시 고르기" : "약한 유형 찾기"}
        </button>
      </div>
      {!studentIds.length && <p className="text-sm text-ink-faint">위에서 받는 학생을 먼저 골라 주세요.</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      {plans && (
        <div className="space-y-3">
          {plans.map((p) => (
            <StudentPlan
              key={p.studentId}
              p={p}
              name={nameOf(p.studentId)}
              count={opts.count}
              kept={keep(p, removed)}
              outline={outline}
              busy={refining === p.studentId}
              onTypes={(keys) => refine(p.studentId, keys)}
              onRemove={(qid) => commit(plans, new Set(removed).add(`${p.studentId}/${qid}`))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentPlan({
  p,
  name,
  count,
  kept,
  outline,
  busy,
  onTypes,
  onRemove,
}: {
  p: WeakPreview;
  name: string;
  count: number;
  kept: WeakPreview["problems"];
  outline: OutlineRow[];
  busy: boolean;
  onTypes: (keys: Key[] | null) => void;
  onRemove: (id: string) => void;
}) {
  const on = p.types.map((t) => ({ grade: t.grade, unit: t.unit, type: t.type }));
  const onSet = new Set(on.map(keyOf));
  // 칩: 지금 쓰는 유형 + 찾았지만 끈 유형
  const chips = [...p.types, ...p.detected.filter((d) => !onSet.has(keyOf(d))).map((d) => ({ ...d, available: -1 }))];
  const toggle = (k: Key) => onTypes(onSet.has(keyOf(k)) ? on.filter((x) => keyOf(x) !== keyOf(k)) : [...on, k]);
  const short = p.types.length > 0 && p.problems.length < count;
  return (
    <details open className="overflow-hidden rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-2/60 px-5 py-3 text-sm font-semibold hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {name}
        <span className="font-normal text-ink-faint">{busy ? "다시 고르는 중…" : p.types.length ? `${kept.length}문제` : "유형 없음"}</span>
      </summary>
      <div className={`space-y-3 border-t border-line px-5 py-4 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <div className="space-y-2">
          <p className="text-xs text-ink-faint">
            {!chips.length ? "유형을 직접 더해 고를 수 있어요." : `${p.chosen ? "선생님이 고른 유형이에요." : "숙제에서 찾은 약한 유형이에요."} 눌러서 켜고 끄거나 유형을 더할 수 있어요.`}
            {p.chosen && p.detected.length > 0 && (
              <>
                {" "}
                <button type="button" className="text-accent underline" onClick={() => onTypes(null)}>
                  찾은 유형으로 되돌리기
                </button>
              </>
            )}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((t) => {
              const active = onSet.has(keyOf(t));
              const stat = [t.wrong && `틀림 ${t.wrong}`, t.hard && `어려움 ${t.hard}`, active && `은행 ${t.available}`].filter(Boolean).join(" · ");
              const rv = t.review;
              return (
                <li key={keyOf(t)}>
                  <button
                    type="button"
                    aria-pressed={active}
                    title={`${t.grade} › ${t.unit} › ${t.type}`}
                    onClick={() => toggle(t)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active ? "border-accent bg-accent-soft" : "border-line bg-surface text-ink-faint line-through hover:bg-surface-2"
                    }`}
                  >
                    <span className="font-semibold">{t.type}</span>
                    {stat && <span className={active ? "text-ink-soft" : ""}> · {stat}</span>}
                    {rv && (
                      <span
                        className={`ml-1.5 inline-block rounded-full px-1.5 font-medium ${
                          rv.due ? "bg-bad-soft text-bad" : rv.done ? "bg-surface-2 text-good" : "bg-surface-2 text-ink-soft"
                        }`}
                      >
                        {rv.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            <li>
              <AddType outline={outline} exclude={onSet} onAdd={(k) => onTypes([...on, k])} />
            </li>
          </ul>
        </div>
        {!p.types.length ? (
          <p className="text-sm text-ink-soft">
            {p.detected.length
              ? "고른 유형이 없어요. 위에서 유형을 켜거나 더해 주세요."
              : p.untyped
                ? `틀린 문제 ${p.untyped}개에 유형이 없어서 찾지 못했어요. 위의 '유형 더하기'로 직접 골라 주세요.`
                : "아직 숙제에서 틀리거나 어려움으로 표시한 문제가 없어요. 위의 '유형 더하기'로 직접 골라 줄 수 있어요."}
          </p>
        ) : (
          <>
            {short && (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                은행에 아직 안 받은 같은 유형 문제가 모자라서 {p.problems.length}문제만 골랐어요.{" "}
                <Link href="/teacher/create" className="font-semibold underline">
                  문제 만들기
                </Link>
                에서 이 유형 문제를 더 만들어 두면 다음엔 채워져요.
              </p>
            )}
            {p.untyped > 0 && <p className="text-xs text-ink-faint">유형이 없는 틀린 문제 {p.untyped}개는 빠졌어요.</p>}
            {kept.length > 0 && (
              <ol className="space-y-2">
                {kept.map((q, i) => (
                  <li key={q.id} className="flex gap-3 rounded-xl border border-line p-3">
                    <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-xs text-ink-faint">{q.tag}</p>
                      <div className="problem-body line-clamp-4 text-sm" dangerouslySetInnerHTML={{ __html: q.html }} />
                    </div>
                    <button type="button" aria-label="이 문제 빼기" title="빼기" className="btn-soft h-8 w-8 shrink-0 p-0" onClick={() => onRemove(q.id)}>
                      <IconX className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** 문제 은행에 있는 학년 › 단원 › 유형 중에서 하나를 골라 더한다 */
function AddType({ outline, exclude, onAdd }: { outline: OutlineRow[]; exclude: Set<string>; onAdd: (k: Key) => void }) {
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState("");
  const [unit, setUnit] = useState("");
  const [type, setType] = useState("");
  const uniq = (xs: string[]) => [...new Set(xs)];
  const grades = uniq(outline.map((o) => o.grade));
  const units = uniq(outline.filter((o) => o.grade === grade).map((o) => o.unit));
  const types = outline.filter((o) => o.grade === grade && o.unit === unit && o.type && !exclude.has(keyOf(o)));
  if (!open)
    return (
      <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-surface-2" onClick={() => setOpen(true)}>
        <IconPlus className="h-3.5 w-3.5" />
        유형 더하기
      </button>
    );
  if (!outline.length) return <span className="text-xs text-ink-faint">문제 은행에 유형이 있는 문제가 아직 없어요.</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select aria-label="학년" value={grade} onChange={(e) => (setGrade(e.target.value), setUnit(""), setType(""))} className="field w-auto py-1 text-xs">
        <option value="">학년</option>
        {grades.map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
      <select aria-label="단원" value={unit} disabled={!grade} onChange={(e) => (setUnit(e.target.value), setType(""))} className="field w-auto max-w-[12rem] py-1 text-xs">
        <option value="">단원</option>
        {units.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
      <select aria-label="유형" value={type} disabled={!unit} onChange={(e) => setType(e.target.value)} className="field w-auto max-w-[14rem] py-1 text-xs">
        <option value="">유형</option>
        {types.map((t) => (
          <option key={t.type} value={t.type}>
            {t.type} ({t.n})
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn-main px-2.5 py-1 text-xs"
        disabled={!type}
        onClick={() => {
          onAdd({ grade, unit, type });
          setOpen(false);
          setType("");
        }}
      >
        더하기
      </button>
      <button type="button" aria-label="닫기" className="btn-soft h-7 w-7 p-0" onClick={() => setOpen(false)}>
        <IconX className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
