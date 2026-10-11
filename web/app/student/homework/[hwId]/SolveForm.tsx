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

const isOx = (t: TNode[]) => t.length === 1 && t[0].t === "slot" && t[0].k === "ox";

/**
 * 문제마다 답 칸. 다 쓰고 한 번에 낸다 (낸 뒤에는 고칠 수 없다). 쓰던 답은 이 기기에 잠깐 저장해 둔다.
 * 정답으로 틀을 만들 수 있는 문제는 빈칸만 채우는 틀(루트·분수 모양)을, 아니면 자유롭게 쓰는 칸을 보여 준다.
 * 정답과 다른 모양으로 쓰고 싶은 학생은 '다른 모양으로 쓰기'로 글자 칸을 쓴다 (글자 답으로 채점, 꼴만 다르면 선생님 확인).
 */
export default function SolveForm({ hwId, problems }: { hwId: string; problems: { id: string; html: string; template: TNode[] | null }[] }) {
  const store = `hw-draft-${hwId}`;
  const slotStore = `hw-slots-${hwId}`;
  const freeStore = `hw-free-${hwId}`; // 틀 대신 글자로 쓰기로 바꾼 문제
  // 쓰던 답은 이 기기(localStorage)에 두고 읽는다. 서버 화면에서는 빈칸.
  const raw = useSyncExternalStore(subscribe, () => read(store), () => "{}");
  const rawSlots = useSyncExternalStore(subscribe, () => read(slotStore), () => "{}");
  const typed = useMemo(() => parseObj<string>(raw), [raw]);
  const slots = useMemo(() => parseObj<string[]>(rawSlots), [rawSlots]);
  const rawFree = useSyncExternalStore(subscribe, () => read(freeStore), () => "{}");
  const free = useMemo(() => parseObj<boolean>(rawFree), [rawFree]);
  const byTpl = (p: { id: string; template: TNode[] | null }) => p.template && !free[p.id];
  // 틀 문제는 빈칸 숫자로 답 글자를 만든다 (빈칸이 하나라도 비면 '')
  const answers: Record<string, string> = {};
  for (const p of problems) answers[p.id] = byTpl(p) ? toAnswer(p.template!, Array.isArray(slots[p.id]) ? slots[p.id] : []) : typed[p.id] || "";
  // 틀로 쓴 문제만 빈칸 값을 보낸다 (글자로 쓴 문제는 글자 답으로 채점)
  const sentSlots = Object.fromEntries(problems.filter((p) => byTpl(p) && Array.isArray(slots[p.id])).map((p) => [p.id, slots[p.id]]));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (id: string, v: string) => write(store, JSON.stringify({ ...typed, [id]: v }));
  const setSlots = (id: string, v: string[]) => write(slotStore, JSON.stringify({ ...slots, [id]: v }));
  const setFree = (id: string, on: boolean) => write(freeStore, JSON.stringify({ ...free, [id]: on }));
  const blanks = problems.filter((p) => !(answers[p.id] || "").trim()).length;

  const submit = () => {
    if (blanks && !confirm(`빈칸이 ${blanks}개 있어요. 빈칸은 틀린 것으로 채점돼요. 그래도 낼까요?`)) return;
    if (!blanks && !confirm("한 번 내면 고칠 수 없어요. 낼까요?")) return;
    setError("");
    start(async () => {
      const r = await submitAction(hwId, answers, sentSlots);
      if (r.ok) {
        write(store, null);
        write(slotStore, null);
        write(freeStore, null);
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
        답 틀이 있는 문제는 루트·분수 모양이 그려져 있으니 <b>빈칸에 숫자나 문자만</b> 넣으세요. 점선 빈칸은 문자(x, y …) 자리, 오른쪽 위 작은 빈칸은
        지수예요. 엔터를 누르면 다음 빈칸으로 가요. O/X 문제는 버튼을 누르고, 자유롭게 쓰는 칸은 기호를 칸 아래 버튼으로 넣으세요.
      </p>
      <ol className="space-y-3">
        {problems.map((p, i) => (
          <li key={p.id} className="card p-4 sm:p-5">
            <p className="mb-2 font-semibold">{i + 1}번</p>
            <div className="problem-body" dangerouslySetInnerHTML={{ __html: p.html }} />
            <div className="mt-4">
              {byTpl(p) ? (
                <TemplateInput nodes={p.template!} values={slots[p.id] ?? []} onChange={(v) => setSlots(p.id, v)} label={`${i + 1}번 답`} />
              ) : (
                <AnswerInput value={answers[p.id] || ""} onChange={(v) => set(p.id, v)} label={`${i + 1}번 답`} />
              )}
              {p.template && !isOx(p.template) && (
                <button type="button" className="mt-2 text-xs text-ink-soft underline hover:text-accent" onClick={() => setFree(p.id, !free[p.id])}>
                  {free[p.id] ? "답 틀로 쓰기" : "다른 모양으로 쓰기"}
                </button>
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
