"use client";

import { useState, useTransition } from "react";
import { IconStar } from "@/components/Icons";
import { starAction } from "./actions";

/** 중요 문제 별표. 누르면 바로 바뀌고, 저장이 안 되면 되돌린다. */
export default function StarButton({ id, starred }: { id: string; starred: boolean }) {
  const [on, setOn] = useState(starred);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={pending}
      title={on ? "중요 문제에서 빼기" : "중요 문제에 넣기"}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          const ok = await starAction(id, next).catch(() => false);
          if (!ok) setOn(!next);
        });
      }}
      className={`btn shrink-0 border px-2.5 py-1.5 text-sm ${on ? "border-warn/40 bg-warn-soft text-ink" : "border-line bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink"}`}
    >
      <IconStar className={`h-4 w-4 ${on ? "fill-current text-warn" : ""}`} />
      {on ? "중요" : "중요 표시"}
    </button>
  );
}
