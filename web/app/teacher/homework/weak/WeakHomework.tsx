"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconArrow, IconClipboard, IconPlus, IconSearch, IconX } from "@/components/Icons";
import StudentPicker, { type PickStudent } from "@/components/StudentPicker";
import { addDays } from "@/lib/hwFormat";
import { createWeakHomeworkAction, weakPlanAction, type WeakPreview } from "../actions";

const COUNTS = [5, 8, 10, 15, 20];

export type OutlineRow = { grade: string; unit: string; type: string; n: number };
type Key = { grade: string; unit: string; type: string };
const keyOf = (k: Key) => `${k.grade}\u0000${k.unit}\u0000${k.type}`;

/** 학생마다 약한 유형을 찾아, 은행에서 아직 안 받은 같은 유형 문제로 각자 숙제를 낸다 */
export default function WeakHomework({
  students,
  today,
  initial,
  outline,
  review = false,
}: {
  students: PickStudent[];
  today: string;
  initial: string[];
  outline: OutlineRow[];
  review?: boolean; // 복습 숙제로 들어옴: 복습할 학생을 골라 두고 복습 날이 된 유형만
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [count, setCount] = useState(10);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(review);
  const [plans, setPlans] = useState<WeakPreview[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // "학생/문제"
  const [chosen, setChosen] = useState<Record<string, Key[]>>({}); // 선생님이 직접 고른 유형 (학생마다)
  const [refining, setRefining] = useState("");
  const [title, setTitle] = useState(`${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} ${review ? "복습 숙제" : "약한 유형 숙제"}`);
  const [due, setDue] = useState(addDays(today, 2));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [finding, startFind] = useTransition();
  const [sending, startSend] = useTransition();
  const [sent, setSent] = useState(false);
  const router = useRouter();

  const nameOf = (id: string) => {
    const s = students.find((x) => x.studentId === id);
    return s?.name || id;
  };
  // 고르는 조건이 바뀌면 미리보기를 지운다
  const reset = () => {
    setPlans(null);
    setRemoved(new Set());
    setError("");
  };

  const find = () => {
    setError("");
    const order = students.filter((s) => picked.has(s.studentId)).map((s) => s.studentId);
    startFind(async () => {
      const r = await weakPlanAction(order, count, verifiedOnly, chosen, dueOnly);
      if ("error" in r) return setError(r.error);
      setRemoved(new Set());
      setPlans(r);
    });
  };

  // 복습 숙제로 들어오면 골라 둔 학생으로 바로 찾는다
  const started = useRef(false);
  useEffect(() => {
    if (review && initial.length && !started.current) {
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
    const r = await weakPlanAction([studentId], count, verifiedOnly, next, dueOnly);
    setRefining("");
    if ("error" in r) return setError(r.error);
    setPlans((ps) => (ps ?? []).map((p) => (p.studentId === studentId ? r[0] : p)));
    setRemoved((rm) => new Set([...rm].filter((x) => !x.startsWith(studentId + "/"))));
  };

  const keep = (p: WeakPreview) => p.problems.filter((q) => !removed.has(`${p.studentId}/${q.id}`));
  const ready = (plans ?? []).filter((p) => keep(p).length > 0);

  const send = () => {
    setError("");
    startSend(async () => {
      const r = await createWeakHomeworkAction({
        title,
        dueDate: due,
        memo,
        plans: ready.map((p) => ({ studentId: p.studentId, problemIds: keep(p).map((q) => q.id) })),
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setSent(true);
      router.push("/teacher/homework");
    });
  };

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/teacher/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          숙제 목록
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">약한 유형 숙제</h1>
        <p className="mt-1 text-sm text-ink-soft">
          학생이 숙제에서 틀렸거나 어려움으로 표시한 문제의 유형을 찾아, 문제 은행에서 아직 안 받은 같은 유형 문제로 학생마다 따로 숙제를 내요.
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          틀린 유형은 3일, 7일, 14일 뒤에 다시 복습할 날이 와요. 복습에서 세 번 맞히면 졸업하고, 또 틀리면 3일 뒤부터 다시 시작해요.
        </p>
        {review && (
          <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm">
            {initial.length ? `오늘 복습할 유형이 있는 학생 ${initial.length}명을 골라 두었어요.` : "오늘 복습할 학생이 없어요."}
          </p>
        )}
      </div>

      {sent ? (
        <p className="card text-center text-sm text-ink-soft">숙제를 냈어요. 숙제 목록으로 가는 중…</p>
      ) : (
        <>
          <section className="card space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">받는 학생</h2>
              <span className="text-sm text-ink-soft">{picked.size}명 골랐어요</span>
            </div>
            <StudentPicker
              students={students}
              picked={picked}
              onChange={(n) => {
                setPicked(n);
                reset();
              }}
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-ink-soft">학생마다</span>
                <select
                  value={count}
                  onChange={(e) => {
                    setCount(Number(e.target.value));
                    reset();
                  }}
                  className="field w-auto py-1.5"
                >
                  {COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n}문제
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => {
                    setVerifiedOnly(e.target.checked);
                    reset();
                  }}
                  className="h-4 w-4 accent-accent"
                />
                검수한 문제만
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dueOnly}
                  onChange={(e) => {
                    setDueOnly(e.target.checked);
                    reset();
                  }}
                  className="h-4 w-4 accent-accent"
                />
                복습 날이 된 유형만
              </label>
              <button type="button" className="btn-main ml-auto" disabled={!picked.size || finding} onClick={find}>
                <IconSearch />
                {finding ? "찾는 중…" : plans ? "다시 고르기" : "약한 유형 찾기"}
              </button>
            </div>
          </section>

          {plans && (
            <section className="space-y-3">
              {plans.map((p) => (
                <StudentPlan
                  key={p.studentId}
                  p={p}
                  name={nameOf(p.studentId)}
                  count={count}
                  kept={keep(p)}
                  outline={outline}
                  busy={refining === p.studentId}
                  onTypes={(keys) => refine(p.studentId, keys)}
                  onRemove={(qid) => setRemoved((r) => new Set(r).add(`${p.studentId}/${qid}`))}
                />
              ))}
            </section>
          )}

          {plans && ready.length > 0 && (
            <section className="card space-y-4">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-soft">숙제 이름 (뒤에 학생 이름이 붙어요)</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} className="field" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-soft">마감일</span>
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="field" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-soft">메모 (선택 · 학생에게 보여요)</span>
                <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder="예: 틀렸던 유형이에요. 풀이도 써 오기" className="field" />
              </label>
            </section>
          )}

          {(error || (plans && ready.length > 0)) && (
            <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
              {error ? (
                <p className="text-sm text-bad">{error}</p>
              ) : (
                <p className="text-sm text-ink-soft">{ready.length}명에게 각자 숙제를 하나씩 내요</p>
              )}
              {plans && ready.length > 0 && (
                <button type="button" className="btn-accent ml-auto" disabled={sending} onClick={send}>
                  <IconClipboard />
                  {sending ? "내는 중…" : "숙제 내기"}
                </button>
              )}
            </div>
          )}
        </>
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
