"use client";

import { type KeyboardEvent, type ReactNode } from "react";
import { cleanSlot, countSlots, type TNode } from "@/lib/answerTemplate";

/**
 * 숫자만 넣는 답 틀. 정답 모양(루트·분수·거듭제곱·기호)은 그려 두고 숫자 자리만 빈칸으로 보여 준다.
 * 빈칸에는 숫자와 소수점만 들어가고, 엔터를 누르면 다음 빈칸으로 넘어간다.
 */
export default function TemplateInput({
  nodes,
  values,
  onChange,
  label,
}: {
  nodes: TNode[];
  values: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const total = countSlots(nodes);
  let k = 0;

  const set = (i: number, v: string) => {
    const next = Array.from({ length: total }, (_, j) => values[j] ?? "");
    next[i] = cleanSlot(v);
    onChange(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // 엔터로 숙제가 바로 제출되지 않게
    const box = e.currentTarget.closest("[data-tpl]");
    const all = [...(box?.querySelectorAll("input") ?? [])];
    const i = all.indexOf(e.currentTarget);
    if (i >= 0 && i < all.length - 1) all[i + 1].focus();
    else e.currentTarget.blur();
  };

  const render = (ns: TNode[], small = false): ReactNode =>
    ns.map((x, j) => {
      if (x.t === "text")
        return (
          <span key={j} className="whitespace-pre">
            {x.v}
          </span>
        );
      if (x.t === "slot") {
        const i = k++;
        const v = values[i] ?? "";
        return (
          <input
            key={j}
            value={v}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={onKey}
            inputMode="decimal"
            enterKeyHint={i === total - 1 ? "done" : "next"}
            autoComplete="off"
            aria-label={total > 1 ? `${label} ${i + 1}번째 빈칸` : label}
            style={{ width: `${Math.max(2, v.length + 1)}ch` }}
            className={`mx-0.5 rounded-md border border-ink-faint text-center tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 ${small ? "h-7 text-sm" : "h-9 text-lg"} ${v ? "bg-surface" : "bg-accent-soft/40"}`}
          />
        );
      }
      if (x.t === "sqrt")
        return (
          <span key={j} className="mx-0.5 inline-flex items-stretch">
            <span className={`self-end leading-none ${small ? "text-lg" : "text-2xl"}`} aria-hidden>
              √
            </span>
            <span className="inline-flex items-center border-t-2 border-ink pt-1 pr-0.5" role="group" aria-label="루트 안">
              {render(x.c, small)}
            </span>
          </span>
        );
      if (x.t === "sup")
        return (
          <span key={j} className="inline-flex -translate-y-2 items-center" role="group" aria-label="지수">
            {render(x.c, true)}
          </span>
        );
      return (
        <span key={j} className="mx-1 inline-flex flex-col items-center align-middle" role="group" aria-label="분수">
          <span className="inline-flex items-center pb-1">{render(x.n, small)}</span>
          <span className="h-0.5 w-full min-w-6 bg-ink" aria-hidden />
          <span className="inline-flex items-center pt-1">{render(x.d, small)}</span>
        </span>
      );
    });

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-sm font-medium text-ink-soft">답</span>
      <div data-tpl className="flex min-w-0 flex-wrap items-center overflow-x-auto py-1 text-lg">
        {render(nodes)}
      </div>
    </div>
  );
}
