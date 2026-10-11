"use client";

import { type KeyboardEvent, type ReactNode } from "react";
import { cleanSlot, countSlots, type SlotKind, type TNode } from "@/lib/answerTemplate";

/**
 * 답 틀. 정답 모양(루트·분수·거듭제곱·기호)은 그려 두고 숫자와 문자 자리만 빈칸으로 보여 준다.
 * 숫자 빈칸은 숫자와 소수점, 문자 빈칸은 영문자만 들어가고, 엔터를 누르면 다음 빈칸으로 넘어간다.
 * O/X 답은 둘 중 하나를 누르는 버튼이다.
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

  const set = (i: number, v: string, kind?: SlotKind) => {
    const next = Array.from({ length: total }, (_, j) => values[j] ?? "");
    next[i] = cleanSlot(v, kind);
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
        if (x.k === "ox")
          return (
            <span key={j} className="inline-flex gap-2" role="radiogroup" aria-label={label}>
              {["O", "X"].map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={v === o}
                  onClick={() => set(i, v === o ? "" : o, "ox")}
                  className={`h-12 w-16 rounded-xl border-2 text-2xl font-bold transition-colors ${v === o ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-soft hover:border-accent hover:text-accent"}`}
                >
                  {o}
                </button>
              ))}
            </span>
          );
        const letter = x.k === "a";
        return (
          <input
            key={j}
            value={v}
            onChange={(e) => set(i, e.target.value, x.k)}
            onKeyDown={onKey}
            inputMode={letter ? "text" : "decimal"}
            enterKeyHint={i === total - 1 ? "done" : "next"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`${total > 1 ? `${label} ${i + 1}번째` : label} ${letter ? "문자" : "숫자"} 빈칸`}
            style={{ width: `${Math.max(small ? 1.6 : 2, v.length + 1)}ch` }}
            className={`mx-0.5 rounded-md border text-center tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 ${letter ? "border-dashed border-accent/60 font-serif italic" : "border-ink-faint"} ${small ? "h-6 text-xs" : "h-9 text-lg"} ${v ? "bg-surface" : "bg-accent-soft/40"}`}
          />
        );
      }
      if (x.t === "sqrt")
        return (
          <span key={j} className="mx-0.5 inline-flex items-stretch">
            {/* 루트 기호를 안쪽 높이에 맞춰 늘려 그리고, 꼭대기가 위쪽 선과 바로 이어지게 한다 */}
            <svg viewBox="0 0 12 30" preserveAspectRatio="none" className="w-3 shrink-0 self-stretch text-ink" aria-hidden>
              <path d="M0.5 18 L3 16 L6.5 28.5 L12 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="inline-flex items-center border-t-2 border-ink pt-1 pr-1 pb-0.5 pl-0.5" role="group" aria-label="루트 안">
              {render(x.c, small)}
            </span>
          </span>
        );
      if (x.t === "sup")
        return (
          <span key={j} className="-ml-0.5 inline-flex -translate-y-3 items-center" role="group" aria-label="지수">
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
