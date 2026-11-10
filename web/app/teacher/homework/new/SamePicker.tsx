"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconDown, IconRefresh, IconUp, IconX } from "@/components/Icons";
import { cart } from "@/lib/cart";
import DifficultyBadge from "@/components/DifficultyBadge";
import { cartPreviewAction, priorCountsAction, swapProblemAction } from "../actions";
import BankSearch, { type BankItem } from "./BankSearch";
import RandomPicker from "./RandomPicker";
import type { OutlineRow } from "./WeakPlanner";

type Item = BankItem;

/**
 * 숙제 내기 › 모두 같은 문제: 무작위로 뽑거나 문제 은행에서 찾아 직접 고르고, 고른 문제의 순서를 정한다.
 * 고른 문제는 문제 은행의 '담기'와 같은 목록이라 은행에서 담아 온 문제도 그대로 들어온다.
 */
export default function SamePicker({
  ids,
  studentIds,
  nameOf,
  outline,
}: {
  ids: string[];
  studentIds: string[];
  nameOf: (id: string) => string;
  outline: OutlineRow[];
}) {
  const [known, setKnown] = useState<Record<string, Item>>({});
  const remember = (items: Item[]) => setKnown((k) => ({ ...k, ...Object.fromEntries(items.map((p) => [p.id, p])) }));

  // 은행에서 담아 온 문제처럼 아직 모르는 문제는 따로 불러온다
  const missing = ids.filter((id) => !known[id]).join(",");
  useEffect(() => {
    let alive = true;
    if (missing) cartPreviewAction(missing.split(",")).then((ps) => alive && remember(ps));
    return () => {
      alive = false;
    };
  }, [missing]);

  // 고른 학생이 전에 받은 적 있는 문제 (선생님에게만 보임)
  const [prior, setPrior] = useState<Record<string, { studentId: string; n: number }[]>>({});
  const key = ids.join(",");
  const stuKey = studentIds.join(",");
  useEffect(() => {
    let alive = true;
    if (!key || !stuKey) Promise.resolve().then(() => alive && setPrior({}));
    else priorCountsAction(stuKey.split(","), key.split(",")).then((p) => alive && setPrior(p));
    return () => {
      alive = false;
    };
  }, [key, stuKey]);

  // 고른 문제 바꾸기: 같은 유형·난이도의 다른 문제로. 바꿔 뺀 문제는 기억해 두고 되도록 다시 안 고른다.
  const [swapping, setSwapping] = useState<string | null>(null);
  const [swapNote, setSwapNote] = useState<{ id: string; text: string } | null>(null);
  const skipped = useRef<string[]>([]);
  const swap = async (id: string) => {
    setSwapping(id);
    setSwapNote(null);
    try {
      const r = await swapProblemAction(id, studentIds, ids, skipped.current);
      if ("error" in r) setSwapNote({ id, text: r.error });
      else {
        skipped.current = [...skipped.current.filter((x) => x !== r.item.id), id].slice(-200);
        remember([r.item]);
        cart.replace(id, r.item.id);
      }
    } catch {
      setSwapNote({ id, text: "문제를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setSwapping(null);
    }
  };


  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">고른 문제 {ids.length}개</h3>
          {ids.length > 0 && (
            <span className="flex gap-3 text-sm">
              <Link href={`/print?ids=${encodeURIComponent(key)}`} className="text-accent underline">
                학습지로 보기
              </Link>
              <button type="button" className="text-ink-soft underline" onClick={() => cart.clear()}>
                모두 빼기
              </button>
            </span>
          )}
        </div>
        {!ids.length ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-soft">아래에서 무작위로 뽑거나 직접 찾아 더해 주세요.</p>
        ) : (
          <ol className="space-y-2">
            {ids.map((id, i) => {
              const p = known[id];
              return (
                <li key={id} className="flex gap-3 rounded-xl border border-line p-3">
                  <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    {!p ? (
                      <p className="text-sm text-ink-faint">불러오는 중…</p>
                    ) : (
                      <>
                        <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-soft">
                          <DifficultyBadge level={p.difficulty} />
                          {p.tag}
                        </p>
                        <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                      </>
                    )}
                    {swapNote?.id === id && <p className="mt-1.5 text-xs text-warn">{swapNote.text}</p>}
                    {prior[id]?.length > 0 && (
                      <p className="mt-1.5 text-xs text-warn">다시 푸는 학생: {prior[id].map((x) => `${nameOf(x.studentId)} (이번이 ${x.n + 1}번째)`).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" aria-label="위로" className="btn-soft h-7 w-7 p-0" disabled={i === 0} onClick={() => cart.move(id, -1)}>
                      <IconUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="아래로" className="btn-soft h-7 w-7 p-0" disabled={i === ids.length - 1} onClick={() => cart.move(id, 1)}>
                      <IconDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="같은 유형·난이도의 다른 문제로 바꾸기"
                      title="같은 유형·난이도의 다른 문제로 바꾸기"
                      className="btn-soft h-7 w-7 p-0"
                      disabled={!p || swapping !== null}
                      onClick={() => swap(id)}
                    >
                      <IconRefresh className={`h-4 w-4 ${swapping === id ? "animate-spin" : ""}`} />
                    </button>
                    <button type="button" aria-label="이 문제 빼기" className="btn-soft h-7 w-7 p-0" onClick={() => cart.remove(id)}>
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <RandomPicker
          outline={outline}
          studentIds={studentIds}
          chosen={ids}
          onAdd={(items) => {
            remember(items);
            cart.addMany(items.map((p) => p.id));
          }}
        />
      </div>

      <BankSearch
        outline={outline}
        picked={ids}
        onToggle={(p) => {
          remember([p]);
          cart.toggle(p.id);
        }}
      />
    </div>
  );
}
