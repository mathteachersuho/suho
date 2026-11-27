"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { reopenDraftAction } from "./actions";

type Item = { draftId: string; name: string; title: string; status: string; hwId: string | null; decidedAt: string };

const when = (iso: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** 최근에 승인·반려한 초안. 반려한 초안은 다시 검토할 수 있다. */
export default function DecidedList({ items }: { items: Item[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const reopen = (id: string) =>
    start(async () => {
      setError("");
      const r = await reopenDraftAction(id);
      if (!r.ok) setError(r.error);
    });
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">최근에 승인·반려한 초안 {items.length}개</summary>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <ul className="mt-3 divide-y divide-line text-sm">
        {items.map((d) => (
          <li key={d.draftId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.status === "approved" ? "bg-good/15 text-good" : "bg-surface-2 text-ink-soft"}`}>
              {d.status === "approved" ? "승인" : "반려"}
            </span>
            <span className="font-semibold">{d.name}</span>
            <span className="min-w-0 truncate text-ink-soft">{d.title}</span>
            <span className="ml-auto text-xs text-ink-faint">{when(d.decidedAt)}</span>
            {d.status === "approved" && d.hwId && (
              <Link href={`/teacher/homework/${d.hwId}`} className="text-accent underline">
                숙제 보기
              </Link>
            )}
            {d.status === "rejected" && (
              <button type="button" className="text-accent underline" disabled={pending} onClick={() => reopen(d.draftId)}>
                다시 검토
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
