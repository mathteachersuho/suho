"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import DifficultyBadge from "@/components/DifficultyBadge";
import { IconCheck, IconRefresh, IconSparkle, IconX } from "@/components/Icons";
import { dueLabel } from "@/lib/hwFormat";
import { approveDraftAction, confirmDraftProblemAction, fillShortAction, rejectDraftAction, removeDraftProblemAction, swapDraftProblemAction } from "./actions";

export type DraftItemView = {
  id: string;
  tag: string;
  difficulty: string;
  html: string;
  answerHtml: string;
  solutionHtml: string;
  madeByAi: boolean;
  verified: boolean;
  warnings: string[];
};
export type DraftView = {
  draftId: string;
  studentId: string;
  name: string;
  classId: string;
  title: string;
  dueDate: string;
  memo: string;
  short: number; // 은행이 모자라 못 채운 문제 수
  shortTypes: string[];
  createdAt: string;
  items: DraftItemView[];
};

/**
 * 한 학생의 숙제 초안: 문제마다 빼기·바꾸기(같은 유형의 안 받은 다른 문제), AI가 만든 문제는 정답·그림을 보고 '확인함'.
 * 맨 아래에서 초안 전체를 승인(숙제로 냄)하거나 반려한다.
 */
export default function DraftCard({ d }: { d: DraftView }) {
  const [busy, setBusy] = useState<string | null>(null); // 지금 하는 일 ("swap/문제", "remove/문제", "fill", "approve" …)
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ hwId?: string; rejected?: boolean } | null>(null);
  const [, start] = useTransition();
  const skipped = useRef<string[]>([]);

  const unchecked = d.items.filter((q) => q.madeByAi && !q.verified).length;
  const act = (key: string, f: () => Promise<{ ok: boolean; error?: string; note?: string }>) => {
    setBusy(key);
    setError("");
    setNote("");
    start(async () => {
      try {
        const r = await f();
        if (!r.ok) setError(r.error ?? "하지 못했어요.");
        else if (r.note) setNote(r.note);
      } catch {
        setError("하지 못했어요. 잠시 뒤 다시 해 주세요.");
      } finally {
        setBusy(null);
      }
    });
  };

  const swap = (qid: string) =>
    act(`swap/${qid}`, async () => {
      const r = await swapDraftProblemAction(d.draftId, qid, skipped.current);
      if (r.ok) skipped.current = [...skipped.current, qid].slice(-200);
      return r;
    });
  const remove = (qid: string) => act(`remove/${qid}`, () => removeDraftProblemAction(d.draftId, qid));
  const confirm = (qid: string) => act(`confirm/${qid}`, () => confirmDraftProblemAction(d.draftId, qid));
  const fill = () =>
    act("fill", async () => {
      const r = await fillShortAction(d.draftId);
      if (!r.ok) return r;
      const parts = [
        r.made ? `AI로 ${r.made}문제를 만들어 끝에 붙였어요. 그림과 정답을 보고 '확인함'을 눌러 주세요.` : "새로 만든 문제가 없어요.",
        r.failed ? `${r.failed}문제는 만들지 못했거나 은행 문제와 같아서 버렸어요.` : "",
        r.left ? `아직 ${r.left}문제가 모자라요. 한 번 더 누르면 더 만들어요.` : "",
      ];
      return { ok: true, note: parts.filter(Boolean).join(" ") };
    });
  const approve = () =>
    act("approve", async () => {
      const r = await approveDraftAction(d.draftId);
      if (r.ok) setDone({ hwId: r.hwId });
      return r;
    });
  const reject = () => {
    if (!window.confirm(`${d.name} 초안을 반려할까요? 학생에게는 아무것도 나가지 않아요.`)) return;
    act("reject", async () => {
      const r = await rejectDraftAction(d.draftId);
      if (r.ok) setDone({ rejected: true });
      return r;
    });
  };

  if (done)
    return (
      <div className="card flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{d.name}</span>
        {done.hwId ? (
          <>
            <span className="text-good">승인해서 숙제로 냈어요</span>
            <Link href={`/teacher/homework/${done.hwId}`} className="ml-auto text-accent underline">
              숙제 보기
            </Link>
          </>
        ) : (
          <span className="text-ink-soft">반려했어요</span>
        )}
      </div>
    );

  const locked = busy !== null;
  return (
    <details open className="overflow-hidden rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 bg-surface-2/60 px-5 py-3 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{d.name}</span>
        {d.classId && <span className="text-ink-faint">{d.classId}</span>}
        <span className="text-ink-soft">{d.items.length}문제</span>
        {d.short > 0 && <span className="text-warn">· {d.short}문제 모자람</span>}
        {unchecked > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">AI 문제 확인 {unchecked}개 남음</span>}
        <span className="ml-auto text-xs text-ink-faint">
          {d.title} · {dueLabel(d.dueDate) || "마감일 없음"}
        </span>
      </summary>

      <div className="space-y-3 border-t border-line px-5 py-4">
        {d.short > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft px-3 py-2 text-sm">
            <p className="text-warn">
              은행에 학생이 안 받은 문제가 모자라요 ({d.shortTypes.join(", ")}). 학생이 틀린 문제를 바탕으로 AI가 새 유사문제를 만들 수 있어요.
            </p>
            <button type="button" className="btn-main ml-auto px-3 py-1.5 text-sm" disabled={locked} onClick={fill}>
              <IconSparkle />
              {busy === "fill" ? "만드는 중… (1분쯤)" : "AI로 채우기"}
            </button>
          </div>
        )}

        {!d.items.length ? (
          <p className="text-sm text-ink-soft">초안에 문제가 없어요.</p>
        ) : (
          <ol className="space-y-2">
            {d.items.map((q, i) => {
              const needCheck = q.madeByAi && !q.verified;
              return (
                <li key={q.id} className={`flex gap-3 rounded-xl border p-3 ${needCheck ? "border-warn/60 bg-warn-soft/30" : "border-line"}`}>
                  <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink-soft">
                      <DifficultyBadge level={q.difficulty} />
                      {q.tag}
                      {q.madeByAi && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${needCheck ? "bg-warn-soft text-warn" : "bg-good/15 text-good"}`}>
                          {needCheck ? "AI가 새로 만듦 · 확인 필요" : "AI가 만듦 · 확인함"}
                        </span>
                      )}
                    </p>
                    <div className={`problem-body text-sm ${needCheck ? "" : "line-clamp-4"}`} dangerouslySetInnerHTML={{ __html: q.html }} />
                    {needCheck ? (
                      <div className="space-y-1.5 rounded-lg bg-surface p-2 text-sm">
                        <div className="flex gap-2">
                          <span className="shrink-0 font-semibold text-ink-soft">정답</span>
                          {q.answerHtml ? <div className="problem-body min-w-0" dangerouslySetInnerHTML={{ __html: q.answerHtml }} /> : <span className="text-bad">정답이 비어 있어요</span>}
                        </div>
                        {q.solutionHtml && (
                          <details>
                            <summary className="cursor-pointer text-ink-soft">풀이 보기</summary>
                            <div className="problem-body mt-1" dangerouslySetInnerHTML={{ __html: q.solutionHtml }} />
                          </details>
                        )}
                        {q.warnings.length > 0 && (
                          <ul className="list-disc pl-5 text-xs text-warn">
                            {q.warnings.map((w) => (
                              <li key={w}>자동 점검: {w}</li>
                            ))}
                          </ul>
                        )}
                        <p className="text-xs text-ink-faint">그림과 정답이 맞는지 직접 풀어 보고 확인해 주세요. 틀렸으면 빼거나 문제 은행에서 고쳐 주세요.</p>
                      </div>
                    ) : (
                      q.answerHtml && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-ink-faint">정답 보기</summary>
                          <div className="problem-body mt-1" dangerouslySetInnerHTML={{ __html: q.answerHtml }} />
                        </details>
                      )
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {needCheck && (
                      <>
                        <button type="button" title="그림·정답 확인함" aria-label="그림·정답 확인함" className="btn-accent h-8 w-8 p-0" disabled={locked} onClick={() => confirm(q.id)}>
                          <IconCheck className="h-4 w-4" />
                        </button>
                        <Link href={`/teacher/bank/${q.id}`} target="_blank" className="btn-soft h-8 px-1.5 text-[11px]" title="문제 은행에서 고치기 (새 탭)">
                          고치기
                        </Link>
                      </>
                    )}
                    <button
                      type="button"
                      title="같은 유형의 안 받은 다른 문제로 바꾸기"
                      aria-label="같은 유형의 안 받은 다른 문제로 바꾸기"
                      className="btn-soft h-8 w-8 p-0"
                      disabled={locked}
                      onClick={() => swap(q.id)}
                    >
                      <IconRefresh className={`h-4 w-4 ${busy === `swap/${q.id}` ? "animate-spin" : ""}`} />
                    </button>
                    <button type="button" title="빼기" aria-label="이 문제 빼기" className="btn-soft h-8 w-8 p-0" disabled={locked} onClick={() => remove(q.id)}>
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {note && <p className="text-sm text-ink-soft">{note}</p>}
        {error && <p className="text-sm text-bad">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="text-xs text-ink-faint">
            {unchecked ? `AI가 만든 문제 ${unchecked}개를 확인하거나 빼야 승인할 수 있어요.` : "승인하면 이 학생에게 바로 숙제로 나가요."}
          </p>
          <button type="button" className="btn-soft ml-auto" disabled={locked} onClick={reject}>
            반려
          </button>
          <button type="button" className="btn-accent" disabled={locked || unchecked > 0 || !d.items.length} onClick={approve}>
            <IconCheck />
            {busy === "approve" ? "내는 중…" : `승인하고 숙제 내기 (${d.items.length}문제)`}
          </button>
        </div>
      </div>
    </details>
  );
}
