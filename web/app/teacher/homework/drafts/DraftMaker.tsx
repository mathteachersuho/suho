"use client";

import { useState, useTransition } from "react";
import { IconSparkle } from "@/components/Icons";
import StudentPicker, { type PickStudent } from "@/components/StudentPicker";
import { makeDraftsAction } from "./actions";

const COUNTS = [5, 8, 10, 15, 20];

/** 초안 만들기: 학생 고르기 → 문제 수·이름·마감일 → 버튼 한 번에 학생마다 초안 */
export default function DraftMaker({
  students,
  dueIds,
  pendingIds,
  defaultTitle,
  defaultDue,
}: {
  students: PickStudent[];
  dueIds: string[]; // 오늘 복습할 유형이 있는 학생
  pendingIds: string[]; // 검토 중인 초안이 있는 학생
  defaultTitle: string;
  defaultDue: string;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(10);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [due, setDue] = useState(defaultDue);
  const [memo, setMemo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; skipped?: string[] } | null>(null);
  const [pending, start] = useTransition();

  const nameOf = (id: string) => students.find((s) => s.studentId === id)?.name || id;
  const replacing = [...picked].filter((id) => pendingIds.includes(id));

  const make = () => {
    if (replacing.length && !window.confirm(`${replacing.map(nameOf).join(", ")} 학생은 검토 중인 초안이 있어요. 새 초안으로 바꿀까요?`)) return;
    setMsg(null);
    start(async () => {
      const r = await makeDraftsAction({ studentIds: [...picked], count, verifiedOnly, dueOnly, title, dueDate: due, memo });
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      const short = r.made.reduce((a, m) => a + m.short, 0);
      setMsg({
        ok: true,
        text: r.made.length
          ? `${r.made.length}명 초안을 만들었어요.${short ? ` 은행이 모자라 ${short}문제를 못 채웠어요. 초안에서 'AI로 채우기'를 누를 수 있어요.` : ""} 아래에서 검토해 주세요.`
          : "만든 초안이 없어요.",
        skipped: r.skipped.map((x) => `${nameOf(x.studentId)}: ${x.reason}`),
      });
      setPicked(new Set());
    });
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">초안 만들기</h2>
        <span className="text-sm text-ink-soft">{picked.size}명 골랐어요</span>
        {dueIds.length > 0 && (
          <button type="button" className="ml-auto text-sm text-accent underline" onClick={() => setPicked(new Set(dueIds))}>
            오늘 복습할 학생 {dueIds.length}명 고르기
          </button>
        )}
      </div>
      <StudentPicker students={students} picked={picked} onChange={setPicked} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">학생마다</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field w-auto py-1.5">
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}문제
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-4 w-4 accent-accent" />
          검수한 문제만
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} className="h-4 w-4 accent-accent" />
          복습 날이 된 유형만
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">숙제 이름 (승인하면 뒤에 학생 이름이 붙어요)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">마감일</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="field" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-soft">메모 (선택 · 승인하면 학생에게 보여요)</span>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder="예: 풀이 과정도 공책에 써 오기" className="field" />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-soft">은행에서 학생이 아직 안 받은 같은 유형 문제를 골라요. 학생에게는 아직 아무것도 안 나가요.</p>
        <button type="button" className="btn-main ml-auto" disabled={!picked.size || pending} onClick={make}>
          <IconSparkle />
          {pending ? "만드는 중…" : `초안 만들기${picked.size ? ` (${picked.size}명)` : ""}`}
        </button>
      </div>
      {msg && (
        <div className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-accent-soft" : "bg-bad-soft text-bad"}`}>
          <p>{msg.text}</p>
          {!!msg.skipped?.length && (
            <ul className="mt-1 list-disc pl-5 text-ink-soft">
              {msg.skipped.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
