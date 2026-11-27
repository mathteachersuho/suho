"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IconCheck, IconRefresh, IconX } from "@/components/Icons";
import { approveAction, rejectAction, undoAction } from "./actions";

type Part = { label: string; key: "question" | "answer" | "solution"; beforeHtml: string; afterHtml: string };
export type ItemView = {
  itemId: string;
  problemId: string;
  mode: "auto" | "queue";
  status: "applied" | "undone" | "pending" | "approved" | "rejected";
  kinds: string[]; // 화면 이름 (그림, 정답 …)
  what: string;
  where: string;
  when: string;
  changedSince: boolean;
  /** 바뀐 부분만 (문제·정답·풀이) */
  parts: Part[];
  /** 고쳐서 승인할 때 처음 글 (고친 안, 없으면 지금 글) */
  raw: { question: string; answer: string; solution: string };
  hasAfter: boolean;
};

const Html = ({ html, empty = "(없음)" }: { html: string; empty?: string }) =>
  html ? <div className="problem-body min-w-0 text-sm" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="text-sm text-ink-faint">{empty}</span>;

function Compare({ parts }: { parts: Part[] }) {
  return (
    <div className="space-y-3">
      {parts.map((p) => (
        <div key={p.key} className="space-y-1">
          <p className="text-xs font-semibold text-ink-soft">{p.label}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-xl border border-line p-3">
              <p className="mb-1 text-xs text-ink-faint">원래</p>
              <Html html={p.beforeHtml} />
            </div>
            <div className="min-w-0 rounded-xl border border-accent/40 bg-accent/5 p-3">
              <p className="mb-1 text-xs text-accent">고친 안</p>
              <Html html={p.afterHtml} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 확인함 항목: 승인 / 고쳐서 승인 / 반려(건너뛰기). 자동 수정 항목: 비교 보기 / 되돌리기 */
export default function ItemCard({ it }: { it: ItemView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.raw);
  const [, start] = useTransition();

  const act = (f: (force: boolean) => Promise<{ ok: boolean; error?: string; changed?: boolean }>, ok: string) => {
    setBusy(true);
    setError("");
    start(async () => {
      try {
        let r = await f(false);
        if (!r.ok && r.changed && window.confirm(r.error ?? "")) r = await f(true);
        if (r.ok) setDone(ok);
        else if (!r.changed) setError(r.error ?? "하지 못했어요.");
      } catch {
        setError("하지 못했어요. 잠시 뒤 다시 해 주세요.");
      } finally {
        setBusy(false);
      }
    });
  };
  const approve = (edited: boolean) => act((force) => approveAction(it.itemId, edited ? draft : null, force), it.hasAfter || edited ? "고쳤어요" : "확인했어요");
  const reject = (skip: boolean) => act(() => rejectAction(it.itemId, skip), skip ? "반려했고, 이 문제는 다음부터 건너뛰어요" : "반려했어요 (문제는 그대로)");
  const undo = () => act((force) => undoAction(it.itemId, force), "원래대로 되돌렸어요");

  const head = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {it.kinds.map((k) => (
        <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
          {k}
        </span>
      ))}
      <Link href={`/teacher/bank/${encodeURIComponent(it.problemId)}`} className="text-ink-soft underline-offset-2 hover:underline">
        {it.where || it.problemId}
      </Link>
      <span className="ml-auto text-xs text-ink-faint">{it.when}</span>
    </div>
  );

  if (done)
    return (
      <div className="card flex flex-wrap items-center gap-3 py-3 text-sm">
        {head}
        <span className="text-good">{done}</span>
      </div>
    );

  if (it.mode === "auto")
    return (
      <details className="rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer list-none space-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
          {head}
          <p className="text-sm">{it.what}</p>
          {it.status === "undone" && <p className="text-xs text-ink-faint">되돌렸어요</p>}
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-3">
          <Compare parts={it.parts} />
          {it.status === "applied" && (
            <div className="flex flex-wrap items-center gap-2">
              {it.changedSince && <span className="text-xs text-warn">고친 뒤에 문제가 또 바뀌었어요</span>}
              <button type="button" className="btn-soft ml-auto py-1.5" disabled={busy} onClick={undo}>
                <IconRefresh />
                되돌리기
              </button>
            </div>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </details>
    );

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      {head}
      <p className="text-sm">{it.what}</p>
      {it.changedSince && <p className="text-xs text-warn">점검한 뒤에 문제가 이미 바뀌었어요. 승인하면 고친 안으로 덮어써요.</p>}
      {editing ? (
        <div className="space-y-2">
          {(["question", "answer", "solution"] as const).map((k) => (
            <label key={k} className="block space-y-1">
              <span className="text-xs font-semibold text-ink-soft">{{ question: "문제", answer: "정답", solution: "풀이" }[k]}</span>
              <textarea
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                rows={k === "answer" ? 2 : 6}
                className="field font-mono text-sm"
              />
            </label>
          ))}
        </div>
      ) : it.parts.length ? (
        <Compare parts={it.parts} />
      ) : (
        <p className="text-sm text-ink-faint">고친 안이 없어요. 문제를 열어 직접 고치거나, 확인만 눌러 주세요.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="button" className="btn-main py-1.5" disabled={busy} onClick={() => approve(true)}>
              <IconCheck />
              이대로 고치기
            </button>
            <button type="button" className="btn-soft py-1.5" disabled={busy} onClick={() => setEditing(false)}>
              취소
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-main py-1.5" disabled={busy} onClick={() => approve(false)}>
              <IconCheck />
              {it.hasAfter ? "승인" : "확인함"}
            </button>
            <button type="button" className="btn-soft py-1.5" disabled={busy} onClick={() => setEditing(true)}>
              고쳐서 승인
            </button>
            <button type="button" className="btn-soft py-1.5" disabled={busy} onClick={() => reject(false)}>
              <IconX />
              반려
            </button>
            <button type="button" className="btn-soft py-1.5 text-ink-soft" disabled={busy} onClick={() => reject(true)} title="이 문제는 다음 자동 점검부터 보지 않아요">
              반려 + 다음부터 건너뛰기
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
