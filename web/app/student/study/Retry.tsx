"use client";

import { useState, useTransition } from "react";
import AnswerInput from "@/components/AnswerInput";
import { checkAction } from "./actions";

type Result = { mark: "Y" | "N" | "?"; answerHtml: string; solutionHtml: string };

const MARK = {
  Y: { text: "맞았어요", cls: "bg-good/15 text-good" },
  N: { text: "아직 틀렸어요", cls: "bg-bad-soft text-bad" },
  "?": { text: "모양이 달라서 바로 채점하지 못했어요. 정답과 비교해 보세요", cls: "bg-surface-2 text-ink-soft" },
} as const;

/** 다시 풀기: 답을 적고 확인하면 바로 채점하고 정답·풀이를 보여 준다. 기록은 남기지 않는다. */
export default function Retry({ id, label = "다시 풀기" }: { id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!open)
    return (
      <button type="button" className="btn-soft px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
        {label}
      </button>
    );

  const check = () =>
    start(async () => {
      setError("");
      const r = await checkAction(id, value);
      if ("error" in r) setError(r.error ?? "");
      else setRes(r);
    });

  return (
    <div className="w-full space-y-2 rounded-xl border border-line p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !pending) check();
        }}
        className="space-y-2"
      >
        <AnswerInput value={value} onChange={(v) => (setValue(v), setRes(null))} label="다시 푼 답" />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-main px-3 py-1.5 text-sm" disabled={!value.trim() || pending}>
            {pending ? "확인하는 중…" : "확인"}
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </form>
      {res && (
        <div className="space-y-2 border-t border-line pt-2 text-sm">
          <p className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${MARK[res.mark].cls}`}>{MARK[res.mark].text}</p>
          {res.mark !== "Y" || res.solutionHtml ? (
            <>
              <div className="flex gap-2">
                <span className="shrink-0 font-semibold">정답</span>
                <div className="problem-body" dangerouslySetInnerHTML={{ __html: res.answerHtml }} />
              </div>
              {res.solutionHtml && <div className="problem-body text-ink-soft" dangerouslySetInnerHTML={{ __html: res.solutionHtml }} />}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
