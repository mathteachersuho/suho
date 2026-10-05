"use client";

import { useState, useTransition } from "react";
import type { HwResult, HwTag, Mark } from "@/lib/homework";
import { MARK_LABEL, TAG_STYLE } from "@/lib/hwFormat";
import { markAction } from "../actions";

type Stu = { studentId: string; name: string; classId: string };
type Mode = "mark" | HwTag;
const NEXT: Record<Mark, Mark> = { "": "Y", Y: "N", N: "?", "?": "" };
const key = (s: string, p: string) => `${s}\u0000${p}`;
const same = (a: HwTag[], b: HwTag[]) => a.length === b.length && a.every((t) => b.includes(t));

const tone: Record<Mark, string> = {
  Y: "text-good",
  N: "text-bad",
  "?": "text-ink-soft",
  "": "text-ink-faint",
};

const MODES: { mode: Mode; label: string; help: string }[] = [
  { mode: "mark", label: "채점", help: "칸을 누를 때마다 O → X → ? → 빈칸으로 바뀌어요." },
  { mode: "중요", label: "★ 중요", help: "칸을 누르면 중요 표시가 붙었다 떨어져요. 번호를 누르면 그 문제를 낸 학생 모두에게 붙어요." },
  { mode: "어려워함", label: "! 어려움", help: "칸을 누르면 어려움 표시가 붙었다 떨어져요. 어려움 표시한 문제는 맞았어도 오답노트에 들어가요." },
];

/** 학생 × 문제 O/X 표. 채점과 중요·어려움 표시를 바꾸고 한 번에 저장한다. 표시는 낸(또는 채점한) 칸에만 붙는다. */
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
  const [mode, setMode] = useState<Mode>("mark");
  const [edits, setEdits] = useState<Map<string, Mark>>(new Map());
  const [tagEdits, setTagEdits] = useState<Map<string, HwTag[]>>(new Map());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const markOf = (s: string, p: string): Mark => edits.get(key(s, p)) ?? saved.get(key(s, p))?.correct ?? "";
  const tagsOf = (s: string, p: string): HwTag[] => tagEdits.get(key(s, p)) ?? saved.get(key(s, p))?.tags ?? [];
  // 결과 줄이 있거나 이번에 O/X를 넣는 칸만 표시할 수 있다
  const canTag = (s: string, p: string) => saved.has(key(s, p)) || markOf(s, p) !== "";
  const nChanges = edits.size + tagEdits.size;

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
  const setTag = (cells: [string, string][], tag: HwTag, on: boolean) => {
    setMsg(null);
    setTagEdits((e) => {
      const n = new Map(e);
      for (const [s, p] of cells) {
        const k = key(s, p);
        const cur = tagsOf(s, p);
        const next = on ? (cur.includes(tag) ? cur : [...cur, tag]) : cur.filter((t) => t !== tag);
        if (same(next, saved.get(k)?.tags ?? [])) n.delete(k);
        else n.set(k, next);
      }
      return n;
    });
  };
  const clickCell = (s: string, p: string) => {
    if (mode === "mark") return cycle(s, p);
    if (!canTag(s, p)) return setMsg({ ok: false, text: "아직 안 낸 칸이에요. 학생이 내거나 O/X를 넣은 뒤에 표시할 수 있어요." });
    setTag([[s, p]], mode, !tagsOf(s, p).includes(mode));
  };
  const clickColumn = (p: string) => {
    if (mode === "mark") return;
    const cells = students.filter((s) => canTag(s.studentId, p)).map((s) => [s.studentId, p] as [string, string]);
    if (!cells.length) return setMsg({ ok: false, text: "이 문제를 낸 학생이 아직 없어요." });
    setTag(cells, mode, !cells.every(([s]) => tagsOf(s, p).includes(mode)));
  };
  const save = () =>
    start(async () => {
      const marks = [...edits].map(([k, correct]) => {
        const [studentId, problemId] = k.split("\u0000");
        return { studentId, problemId, correct };
      });
      const tags = [...tagEdits].map(([k, t]) => {
        const [studentId, problemId] = k.split("\u0000");
        return { studentId, problemId, tags: t };
      });
      const r = await markAction(hwId, marks, tags);
      if (r.ok) {
        setEdits(new Map());
        setTagEdits(new Map());
        setMsg({ ok: true, text: "저장했어요." });
      } else setMsg({ ok: false, text: r.error });
    });

  if (!students.length) return <p className="text-sm text-ink-soft">받는 학생이 없어요.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="표에서 할 일">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              onClick={() => setMode(m.mode)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${mode === m.mode ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-soft">{MODES.find((m) => m.mode === mode)!.help}</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-ink-soft">
              <th className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium">학생</th>
              {problems.map((p, i) => (
                <th key={p.id} className="min-w-14 px-1 py-1 text-center font-medium tabular-nums">
                  {mode === "mark" ? (
                    i + 1
                  ) : (
                    <button
                      type="button"
                      onClick={() => clickColumn(p.id)}
                      aria-label={`${i + 1}번 낸 학생 모두 ${TAG_STYLE[mode].label}`}
                      className="w-full rounded-md px-1 py-1 hover:bg-surface hover:text-ink"
                    >
                      {i + 1}
                    </button>
                  )}
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
                  {problems.map((p, i) => {
                    const k = key(s.studentId, p.id);
                    const m = markOf(s.studentId, p.id);
                    const r = saved.get(k);
                    const tags = tagsOf(s.studentId, p.id);
                    const changed = edits.has(k) || tagEdits.has(k);
                    const off = mode !== "mark" && !canTag(s.studentId, p.id);
                    return (
                      <td key={p.id} className="p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => clickCell(s.studentId, p.id)}
                          title={r?.answer ? `학생 답: ${r.answer}` : "학생 답 없음"}
                          aria-label={`${s.name || s.studentId} ${i + 1}번: ${MARK_LABEL[m] || "빈칸"}${tags.length ? `, ${tags.map((t) => TAG_STYLE[t].label).join(", ")}` : ""}`}
                          className={`relative flex h-12 w-full min-w-12 flex-col items-center justify-center rounded-lg hover:bg-surface-2 ${changed ? "ring-2 ring-accent/60" : ""} ${off ? "opacity-40" : ""}`}
                        >
                          <span className={`text-base font-bold leading-none ${tone[m]}`}>{MARK_LABEL[m] || "·"}</span>
                          {r?.answer && <span className="mt-1 max-w-16 truncate text-[11px] leading-none text-ink-faint">{r.answer}</span>}
                          {tags.length > 0 && (
                            <span className="absolute right-0.5 top-0.5 flex gap-0.5">
                              {tags.map((t) => (
                                <span key={t} className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none ${TAG_STYLE[t].cls}`}>
                                  {TAG_STYLE[t].icon}
                                </span>
                              ))}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 text-right tabular-nums">{any || ok ? `${ok}/${problems.length}` : "－"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-main" disabled={!nChanges || pending} onClick={save}>
          {pending ? "저장하는 중…" : nChanges ? `저장 (${nChanges}칸)` : "저장"}
        </button>
        {nChanges > 0 && !pending && (
          <button
            type="button"
            className="btn-soft"
            onClick={() => {
              setEdits(new Map());
              setTagEdits(new Map());
            }}
          >
            되돌리기
          </button>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
        <p className="ml-auto text-xs text-ink-faint">O 맞음 · X 틀림 · ? 확인 필요 · ★ 중요 · ! 어려움</p>
      </div>
    </div>
  );
}
