"use client";

import { useRef } from "react";

// 휴대폰 자판에 없는 기호를 버튼으로 넣는다. 채점기가 √ π ² ≤ ≥ 를 알아듣는다.
const KEYS: { label: string; insert: string; title: string }[] = [
  { label: "√", insert: "√", title: "루트 (√3, √(x+1))" },
  { label: "π", insert: "π", title: "파이" },
  { label: "a/b", insert: "/", title: "분수 (3/4)" },
  { label: "x²", insert: "²", title: "제곱" },
  { label: "xⁿ", insert: "^", title: "거듭제곱 (2^5)" },
  { label: "(", insert: "(", title: "여는 괄호" },
  { label: ")", insert: ")", title: "닫는 괄호" },
  { label: "≤", insert: "≤", title: "작거나 같다" },
  { label: "≥", insert: "≥", title: "크거나 같다" },
  { label: ",", insert: ", ", title: "답이 여러 개일 때" },
];

/** 답 칸 + 기호 버튼. 버튼을 눌러도 입력 칸에서 커서가 빠지지 않는다. */
export default function AnswerInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);

  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next.slice(0, 200));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div>
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-ink-soft">답</span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="field py-2 text-lg"
          aria-label={label}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-8" role="group" aria-label="기호 넣기">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            title={k.title}
            aria-label={k.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(k.insert)}
            className="min-w-10 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-base font-medium hover:border-accent hover:text-accent active:scale-95"
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
