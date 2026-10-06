"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconArrow, IconClipboard, IconSearch, IconX } from "@/components/Icons";
import StudentPicker, { type PickStudent } from "@/components/StudentPicker";
import { addDays } from "@/lib/hwFormat";
import { createWeakHomeworkAction, weakPlanAction, type WeakPreview } from "../actions";

const COUNTS = [5, 8, 10, 15, 20];

/** 학생마다 약한 유형을 찾아, 은행에서 아직 안 받은 같은 유형 문제로 각자 숙제를 낸다 */
export default function WeakHomework({ students, today, initial }: { students: PickStudent[]; today: string; initial: string[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [count, setCount] = useState(10);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [plans, setPlans] = useState<WeakPreview[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // "학생/문제"
  const [title, setTitle] = useState(`${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} 약한 유형 숙제`);
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
      const r = await weakPlanAction(order, count, verifiedOnly);
      if ("error" in r) return setError(r.error);
      setRemoved(new Set());
      setPlans(r);
    });
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
  onRemove,
}: {
  p: WeakPreview;
  name: string;
  count: number;
  kept: WeakPreview["problems"];
  onRemove: (id: string) => void;
}) {
  const short = p.types.length > 0 && p.problems.length < count;
  return (
    <details open className="overflow-hidden rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-2/60 px-5 py-3 text-sm font-semibold hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {name}
        <span className="font-normal text-ink-faint">{p.types.length ? `${kept.length}문제` : "약한 유형 없음"}</span>
      </summary>
      <div className="space-y-3 border-t border-line px-5 py-4">
        {!p.types.length ? (
          <p className="text-sm text-ink-soft">
            {p.untyped
              ? `틀린 문제 ${p.untyped}개에 유형이 없어서 고를 수 없어요. 문제 은행에서 유형을 넣어 주세요.`
              : "아직 숙제에서 틀리거나 어려움으로 표시한 문제가 없어요."}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1.5">
              {p.types.map((t) => (
                <li key={`${t.grade}/${t.unit}/${t.type}`} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                  <span className="font-semibold">{t.type}</span>
                  <span className="text-ink-soft">
                    {" "}
                    · {[t.wrong && `틀림 ${t.wrong}`, t.hard && `어려움 ${t.hard}`].filter(Boolean).join(" · ")} · 은행 {t.available}
                  </span>
                </li>
              ))}
            </ul>
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
