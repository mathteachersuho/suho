"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { submitAction } from "../actions";
import AnswerInput from "@/components/AnswerInput";
import TemplateInput from "@/components/TemplateInput";
import { toAnswer, type TNode } from "@/lib/answerTemplate";

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const memory = new Map<string, string>(); // localStorage 를 못 쓰는 브라우저용
function parseObj<T>(raw: string): Record<string, T> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? "{}";
  } catch {
    return memory.get(key) ?? "{}";
  }
}
function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  listeners.forEach((fn) => fn());
}

/**
 * 문제마다 답 칸. 다 쓰고 한 번에 낸다 (낸 뒤에는 고칠 수 없다). 쓰던 답은 이 기기에 잠깐 저장해 둔다.
 * 정답으로 틀을 만들 수 있는 문제는 숫자만 넣는 틀(루트·분수 모양)을, 아니면 자유롭게 쓰는 칸을 보여 준다.
 */
export default function SolveForm({ hwId, problems }: { hwId: string; problems: { id: string; html: string; template: TNode[] | null }[] }) {
  const store = `hw-draft-${hwId}`;
  const slotStore = `hw-slots-${hwId}`;
  // 쓰던 답은 이 기기(localStorage)에 두고 읽는다. 서버 화면에서는 빈칸.
  const raw = useSyncExternalStore(subscribe, () => read(store), () => "{}");
  const rawSlots = useSyncExternalStore(subscribe, () => read(slotStore), () => "{}");
  const typed = useMemo(() => parseObj<string>(raw), [raw]);
  const slots = useMemo(() => parseObj<string[]>(rawSlots), [rawSlots]);
  // 틀 문제는 빈칸 숫자로 답 글자를 만든다 (빈칸이 하나라도 비면 '')
  const answers: Record<string, string> = {};
  for (const p of problems) answers[p.id] = p.template ? toAnswer(p.template, Array.isArray(slots[p.id]) ? slots[p.id] : []) : typed[p.id] || "";
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (id: string, v: string) => write(store, JSON.stringify({ ...typed, [id]: v }));
  const setSlots = (id: string, v: string[]) => write(slotStore, JSON.stringify({ ...slots, [id]: v }));
  const blanks = problems.filter((p) => !(answers[p.id] || "").trim()).length;

  const submit = () => {
    if (blanks && !confirm(`빈칸이 ${blanks}개 있어요. 빈칸은 틀린 것으로 채점돼요. 그래도 낼까요?`)) return;
    if (!blanks && !confirm("한 번 내면 고칠 수 없어요. 낼까요?")) return;
    setError("");
    start(async () => {
      const r = await submitAction(hwId, answers, slots);
      if (r.ok) {
        write(store, null);
        write(slotStore, null);
        router.refresh();
      } else setError(r.error);
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-ink-soft">
        답 틀이 있는 문제는 루트·분수 모양이 그려져 있으니 <b>빈칸에 숫자만</b> 넣으세요. 엔터를 누르면 다음 빈칸으로 가요. 자유롭게 쓰는 칸은
        기호를 칸 아래 버튼으로 넣고, 분수는 <b>3/4</b>, 답이 여러 개면 쉼표로 나눠 쓰세요.
      </p>
      <ol className="space-y-3">
        {problems.map((p, i) => (
          <li key={p.id} className="card p-4 sm:p-5">
            <p className="mb-2 font-semibold">{i + 1}번</p>
            <div className="problem-body" dangerouslySetInnerHTML={{ __html: p.html }} />
            <div className="mt-4">
              {p.template ? (
                <TemplateInput nodes={p.template} values={slots[p.id] ?? []} onChange={(v) => setSlots(p.id, v)} label={`${i + 1}번 답`} />
              ) : (
                <AnswerInput value={answers[p.id] || ""} onChange={(v) => set(p.id, v)} label={`${i + 1}번 답`} />
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
        {error ? (
          <p className="text-sm text-bad">{error}</p>
        ) : (
          <p className="text-sm text-ink-soft">{blanks ? `빈칸 ${blanks}개` : "다 썼어요"}</p>
        )}
        <button type="submit" className="btn-accent ml-auto" disabled={pending}>
          {pending ? "채점하는 중…" : "내고 채점하기"}
        </button>
      </div>
    </form>
  );
}
