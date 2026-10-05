"use client";

import { useState, useTransition } from "react";
import type { HwResult, Mark } from "@/lib/homework";
import { MARK_LABEL } from "@/lib/hwFormat";
import { markAction } from "../actions";

type Stu = { studentId: string; name: string; classId: string };
const NEXT: Record<Mark, Mark> = { "": "Y", Y: "N", N: "?", "?": "" };
const key = (s: string, p: string) => `${s}\u0000${p}`;

const tone: Record<Mark, string> = {
  Y: "text-good",
  N: "text-bad",
  "?": "text-ink-soft",
  "": "text-ink-faint",
};

/** 학생 × 문제 O/X 표. 칸을 눌러 바꾸고 한 번에 저장한다. */
export default function MarkGrid({
  hwId,
  problems,
  students,
  results,
}: {
  hwId: string;
  problems: { id: string; answer: string }[];
  students: Stu[];
  results: HwResult[];
}) {
  const saved = new Map(results.map((r) => [key(r.studentId, r.problemId), r]));
  const [edits, setEdits] = useState<Map<string, Mark>>(new Map());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const markOf = (s: string, p: string): Mark => edits.get(key(s, p)) ?? saved.get(key(s, p))?.correct ?? "";
  const cycle = (s: string, p: string) => {
    setMsg(null);
    setEdits((e) => {
      const n = new Map(e);
      const k = key(s, p);
      const next = NEXT[markOf(s, p)];
      if (next === (saved.get(k)?.correct ?? "")) n.delete(k);
      else n.set(k, next);
      return n;
    });
  };
  const save = () =>
    start(async () => {
      const marks = [...edits].map(([k, correct]) => {
        const [studentId, problemId] = k.split("\u0000");
        return { studentId, problemId, correct };
      });
      const r = await markAction(hwId, marks);
      if (r.ok) {
        setEdits(new Map());
        setMsg({ ok: true, text: "채점을 저장했어요." });
      } else setMsg({ ok: false, text: r.error });
    });

  if (!students.length) return <p className="text-sm text-ink-soft">받는 학생이 없어요.</p>;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-ink-soft">
              <th className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium">학생</th>
              {problems.map((p, i) => (
                <th key={p.id} className="min-w-14 px-1 py-2 text-center font-medium tabular-nums">
                  {i + 1}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">점수</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const ok = problems.filter((p) => markOf(s.studentId, p.id) === "Y").length;
              const any = problems.some((p) => saved.has(key(s.studentId, p.id)));
              return (
                <tr key={s.studentId} className="border-b border-line last:border-0">
                  <th className="sticky left-0 bg-surface px-3 py-1.5 text-left font-medium">
                    <span className="block whitespace-nowrap">{s.name || s.studentId}</span>
                    {!any && <span className="block text-xs font-normal text-ink-faint">아직 안 냄</span>}
                  </th>
                  {problems.map((p) => {
                    const m = markOf(s.studentId, p.id);
                    const r = saved.get(key(s.studentId, p.id));
                    const changed = edits.has(key(s.studentId, p.id));
                    return (
                      <td key={p.id} className="p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => cycle(s.studentId, p.id)}
                          title={r?.answer ? `학생 답: ${r.answer}` : "학생 답 없음"}
                          aria-label={`${s.name || s.studentId} ${problems.indexOf(p) + 1}번: ${MARK_LABEL[m] || "빈칸"}`}
                          className={`flex h-12 w-full min-w-12 flex-col items-center justify-center rounded-lg hover:bg-surface-2 ${changed ? "ring-2 ring-accent/60" : ""}`}
                        >
                          <span className={`text-base font-bold leading-none ${tone[m]}`}>{MARK_LABEL[m] || "·"}</span>
                          {r?.answer && <span className="mt-1 max-w-16 truncate text-[11px] leading-none text-ink-faint">{r.answer}</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 text-right tabular-nums">
                    {any || ok ? `${ok}/${problems.length}` : "－"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-main" disabled={!edits.size || pending} onClick={save}>
          {pending ? "저장하는 중…" : edits.size ? `채점 저장 (${edits.size}칸)` : "채점 저장"}
        </button>
        {edits.size > 0 && !pending && (
          <button type="button" className="btn-soft" onClick={() => setEdits(new Map())}>
            되돌리기
          </button>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
        <p className="ml-auto text-xs text-ink-faint">O 맞음 · X 틀림 · ? 확인 필요(정답이 없거나 식 모양이 달라요)</p>
      </div>
    </div>
  );
}
