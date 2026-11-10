"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import DifficultyBadge from "@/components/DifficultyBadge";
import { IconDown, IconRefresh, IconUp, IconX } from "@/components/Icons";
import type { OutlineRow } from "@/lib/problems";
import { saveHomeworkProblemsAction, swapProblemAction } from "../actions";
import BankSearch, { type BankItem } from "../new/BankSearch";

/**
 * 아직 아무도 풀지 않은 숙제의 문제 고치기: 순서 바꾸기, 같은 유형·난이도의 다른 문제로 바꾸기, 빼기, 문제 은행에서 더하기.
 * 바꾼 것은 '저장'을 눌러야 숙제에 들어간다.
 */
export default function EditProblems({
  hwId,
  studentIds,
  outline,
  initial,
}: {
  hwId: string;
  studentIds: string[];
  outline: OutlineRow[];
  initial: BankItem[];
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BankItem[]>(initial);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [swapping, setSwapping] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const skipped = useRef<string[]>([]);
  const router = useRouter();

  const ids = list.map((p) => p.id);
  const changed = ids.join(",") !== initial.map((p) => p.id).join(",");

  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const remove = (id: string) => setList((l) => l.filter((p) => p.id !== id));
  const toggle = (p: BankItem) => setList((l) => (l.some((x) => x.id === p.id) ? l.filter((x) => x.id !== p.id) : [...l, p]));

  const swap = async (id: string) => {
    setSwapping(id);
    setNote(null);
    try {
      const r = await swapProblemAction(id, studentIds, ids, skipped.current);
      if ("error" in r) setNote({ id, text: r.error });
      else {
        skipped.current = [...skipped.current.filter((x) => x !== r.item.id), id].slice(-200);
        setList((l) => l.map((p) => (p.id === id ? r.item : p)));
      }
    } catch {
      setNote({ id, text: "문제를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setSwapping(null);
    }
  };

  const save = () => {
    setError("");
    startSave(async () => {
      const r = await saveHomeworkProblemsAction(hwId, ids);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error);
    });
  };

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <p className="text-ink-soft">아직 아무도 풀지 않아서 문제를 바꾸거나 순서를 바꿀 수 있어요.</p>
        <button
          type="button"
          className="btn-soft ml-auto py-1.5"
          onClick={() => {
            setList(initial);
            setError("");
            setNote(null);
            setOpen(true);
          }}
        >
          문제 고치기
        </button>
      </div>
    );

  return (
    <div className="card space-y-5 p-4 sm:p-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">숙제 문제 {list.length}개</h3>
        {!list.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-soft">아래에서 문제를 찾아 더해 주세요.</p>
        ) : (
          <ol className="space-y-2">
            {list.map((p, i) => (
              <li key={p.id} className="flex gap-3 rounded-xl border border-line p-3">
                <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-soft">
                    <DifficultyBadge level={p.difficulty} />
                    {p.tag}
                  </p>
                  <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                  {note?.id === p.id && <p className="mt-1.5 text-xs text-warn">{note.text}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" aria-label="위로" className="btn-soft h-7 w-7 p-0" disabled={i === 0} onClick={() => move(i, -1)}>
                    <IconUp className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label="아래로" className="btn-soft h-7 w-7 p-0" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    <IconDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="같은 유형·난이도의 다른 문제로 바꾸기"
                    title="같은 유형·난이도의 다른 문제로 바꾸기"
                    className="btn-soft h-7 w-7 p-0"
                    disabled={swapping !== null}
                    onClick={() => swap(p.id)}
                  >
                    <IconRefresh className={`h-4 w-4 ${swapping === p.id ? "animate-spin" : ""}`} />
                  </button>
                  <button type="button" aria-label="이 문제 빼기" className="btn-soft h-7 w-7 p-0" onClick={() => remove(p.id)}>
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <BankSearch outline={outline} picked={ids} onToggle={toggle} />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
        {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-ink-soft">{changed ? "바꾼 것이 있어요. 저장해야 숙제에 들어가요." : "바꾼 것이 없어요."}</p>}
        <button type="button" className="btn-soft ml-auto py-2" disabled={saving} onClick={() => setOpen(false)}>
          그만두기
        </button>
        <button type="button" className="btn-main py-2" disabled={saving || !changed || !list.length} onClick={save}>
          {saving ? "저장하는 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
