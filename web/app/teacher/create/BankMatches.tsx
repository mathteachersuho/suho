"use client";

import { useEffect, useRef, useState } from "react";
import DifficultyBadge from "@/components/DifficultyBadge";
import { bankMatchesAction } from "./actions";
import type { Classification } from "./types";

type Result = Awaited<ReturnType<typeof bankMatchesAction>>;

/** 고른 분류와 비슷한 은행 문제 목록. 줄을 누르면 문제와 정답이 펼쳐진다. 분류를 바꾸면 다시 찾는다. */
export default function BankMatches({ cls }: { cls: Classification }) {
  const [r, setR] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const key = JSON.stringify([cls.grade, cls.unit, cls.type, cls.frame]);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const [grade, unit, type, frame] = JSON.parse(key) as string[];
    const t = setTimeout(async () => {
      try {
        const out = await bankMatchesAction({ grade, unit, type, frame });
        if (my === seq.current) setR(out);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [key]);

  if (!r || r.sameType === 0) return null;
  const others = r.sameType - r.sameFrame;
  const label = cls.frame
    ? [r.sameFrame > 0 && `같은 세부 유형 ${r.sameFrame}개`, others > 0 && `같은 유형의 다른 세부 유형 ${others}개`].filter(Boolean).join(" · ")
    : `같은 유형 ${r.sameType}개`;
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold"
      >
        <span>
          은행의 비슷한 문제{" "}
          <span className="text-accent tabular-nums">{label}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-ink-soft">{open ? "접기 ▲" : "펼쳐 보기 ▼"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {r.items.map((p, i) => {
            const newFrame = i === 0 || r.items[i - 1].frame !== p.frame;
            return (
              <li key={p.id}>
                {newFrame && (
                  <p className="bg-surface px-3 pt-2.5 pb-1 text-xs font-semibold text-ink-soft">
                    {p.frame === cls.frame && cls.frame ? "같은 세부 유형" : "다른 세부 유형"} · {p.frame || "(세부 유형 없음)"}
                  </p>
                )}
                <details className="group bg-surface">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
                    <DifficultyBadge level={p.difficulty} className="scale-90" />
                    <span className="min-w-0 flex-1 line-clamp-2 text-ink">{p.snippet || "(글자 없음)"}</span>
                    <span className="shrink-0 text-xs text-ink-soft group-open:hidden">열기</span>
                    <span className="hidden shrink-0 text-xs text-ink-soft group-open:inline">닫기</span>
                  </summary>
                  <div className="space-y-3 border-t border-line px-3 py-3">
                    <div className="problem-body" dangerouslySetInnerHTML={{ __html: p.html }} />
                    {p.answerHtml && (
                      <div className="flex gap-2 text-sm">
                        <span className="shrink-0 font-semibold">정답</span>
                        <div className="problem-body" dangerouslySetInnerHTML={{ __html: p.answerHtml }} />
                      </div>
                    )}
                    <a
                      href={`/teacher/bank/${encodeURIComponent(p.id)}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-block text-sm font-medium text-accent hover:underline"
                    >
                      문제 은행에서 열기 (새 탭) ↗
                    </a>
                  </div>
                </details>
              </li>
            );
          })}
          {r.sameType > r.items.length && (
            <li className="bg-surface px-3 py-2 text-xs text-ink-soft">
              {r.items.length}개만 보여요.{" "}
              <a
                href={`/teacher/bank?${new URLSearchParams({ grade: cls.grade, unit: cls.unit, type: cls.type })}`}
                target="_blank"
                rel="noopener"
                className="font-medium text-accent hover:underline"
              >
                문제 은행에서 모두 보기 ↗
              </a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
