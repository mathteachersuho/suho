"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { IconArrow, IconCheck } from "@/components/Icons";
import { DIFFICULTIES } from "@/lib/difficulty";
import type { ProblemEdit } from "@/lib/problems";
import type { TaxRow } from "@/lib/taxonomy";
import { aiEditAction } from "../../create/actions";
import AskBox from "../../create/AskBox";
import ClassPicker from "../../create/ClassPicker";
import RichEditor from "../../create/RichEditor";
import { usePreview } from "../../create/usePreview";
import { updateProblemAction } from "../actions";

type Body = { question: string; answer: string; solution: string };

/** 문제 은행에 저장된 문제 하나 고치기: 분류, 난이도, 검토 여부, 문제·정답·풀이 (직접 / 코드로 / AI로) */
export default function EditProblem({
  id,
  back,
  homework,
  taxonomy,
  initial,
}: {
  id: string;
  back: string;
  homework: number;
  taxonomy: TaxRow[];
  initial: ProblemEdit;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [code, setCode] = useState(false);
  const [undo, setUndo] = useState<Body | null>(null);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const html = usePreview([v.question, v.answer, v.solution]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (patch: Partial<ProblemEdit>) => setV((cur) => ({ ...cur, ...patch }));
  const clsReady = !!(v.cls.grade.trim() && v.cls.unit.trim() && v.cls.type.trim() && v.cls.frame.trim());

  // 고친 내용이 있는데 창을 닫거나 새로고침하면 한 번 묻는다
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const aiEdit = async (instruction: string, target: "problem" | "solution") => {
    const before = { question: v.question, answer: v.answer, solution: v.solution };
    const r = await aiEditAction({ ...before, instruction, target });
    if (!r.ok) return r.error;
    set({ ...r.data, verified: false });
    setUndo(before);
    return null;
  };

  const save = () =>
    start(async () => {
      setError("");
      const r = await updateProblemAction(id, v);
      if (r.error) {
        setError(r.error);
        return;
      }
      router.push(back);
      router.refresh();
    });

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Link href={back} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
            <IconArrow className="h-4 w-4 rotate-180" />
            문제 은행
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">문제 고치기</h1>
        </div>
      </div>

      {homework > 0 && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-ink-soft">
          이 문제는 숙제 {homework}개에 들어 있어요. 고치면 그 숙제에도 고친 내용이 보여요. 이미 채점된 결과는 바뀌지 않아요.
        </p>
      )}

      <section className="card space-y-4">
        <p className="text-sm font-semibold">분류</p>
        <ClassPicker id="cls" value={v.cls} onChange={(cls) => set({ cls })} taxonomy={taxonomy} />
        <div className="flex flex-wrap items-center gap-3">
          <select value={v.difficulty} onChange={(e) => set({ difficulty: e.target.value })} className="field w-auto py-1.5 text-sm" aria-label="난이도">
            <option value="">난이도 없음</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                난이도 {d}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-soft" title="정답과 풀이까지 확인한 문제만 체크하세요">
            <input type="checkbox" checked={v.verified} onChange={(e) => set({ verified: e.target.checked })} className="h-4 w-4 accent-accent" />
            검토함
          </label>
        </div>
      </section>

      <section className="card">
        <p className="mb-3 text-sm font-semibold">미리보기</p>
        <div className="problem-body" dangerouslySetInnerHTML={{ __html: html[0] ?? "" }} />
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex gap-2">
            <span className="shrink-0 font-semibold">정답</span>
            <div className="problem-body" dangerouslySetInnerHTML={{ __html: html[1] ?? "" }} />
          </div>
          {v.solution && <div className="problem-body text-ink-soft" dangerouslySetInnerHTML={{ __html: html[2] ?? "" }} />}
        </div>
      </section>

      <section className="card grid gap-4">
        <AskBox
          id="ask-q"
          label="AI로 고치기 · 그림이나 문제를 어떻게 바꿀지 말로 적어 주세요"
          placeholder="예: 그림에서 점 P를 x축 위로 옮기고, 선분 AB 길이 6cm 표시해 줘"
          onAsk={(t) => aiEdit(t, "problem")}
        />
        <AskBox id="ask-s" label="AI로 풀이 고치기" placeholder="예: 풀이를 더 자세히, 근의 공식 쓰는 과정을 넣어 줘" onAsk={(t) => aiEdit(t, "solution")} />
        {undo && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span>AI가 고쳤어요. 정답과 풀이도 맞는지 확인하고, 마음에 안 들면 되돌리세요.</span>
            <button
              type="button"
              className="btn-soft px-2.5 py-1"
              onClick={() => {
                set(undo);
                setUndo(null);
                          }}
            >
              되돌리기
            </button>
          </div>
        )}
      </section>

      <section className="card grid gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">직접 고치기</p>
          <p className="hidden text-xs text-ink-soft sm:block">글자는 바로 고치고, 색칠된 수식은 눌러서 고치세요.</p>
          <button type="button" className="ml-auto shrink-0 text-xs text-ink-soft underline" onClick={() => setCode(!code)}>
            {code ? "화면에서 고치기" : "코드로 고치기"}
          </button>
        </div>
        {code ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-soft">문제</span>
              <textarea value={v.question} onChange={(e) => set({ question: e.target.value })} rows={8} className="field font-mono text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-soft">정답</span>
              <textarea value={v.answer} onChange={(e) => set({ answer: e.target.value })} rows={2} className="field font-mono text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-soft">풀이</span>
              <textarea value={v.solution} onChange={(e) => set({ solution: e.target.value })} rows={6} className="field font-mono text-sm" />
            </label>
          </>
        ) : (
          <>
            <RichEditor label="문제" value={v.question} onChange={(q) => set({ question: q })} minRows={4} />
            <RichEditor label="정답" value={v.answer} onChange={(a) => set({ answer: a })} minRows={1} />
            <RichEditor label="풀이" value={v.solution} onChange={(s) => set({ solution: s })} minRows={4} />
          </>
        )}
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
        <div className="pointer-events-auto mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 pl-4 shadow-lg shadow-black/10 backdrop-blur">
          <p className={`text-sm ${error ? "text-bad" : "text-ink-soft"}`}>
            {error || (!clsReady ? "학년·단원·유형·문제틀을 모두 정해 주세요." : dirty ? "고친 내용이 있어요." : "아직 고친 내용이 없어요.")}
          </p>
          <Link href={back} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
            취소
          </Link>
          <button type="button" className="btn-main py-2" onClick={save} disabled={!dirty || !clsReady || saving}>
            <IconCheck />
            {saving ? "저장하는 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
