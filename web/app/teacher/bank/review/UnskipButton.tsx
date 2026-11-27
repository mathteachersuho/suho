"use client";

import { useState, useTransition } from "react";
import { unskipAction } from "./actions";

/** 건너뛰는 문제를 다시 자동 점검에 넣는다 */
export default function UnskipButton({ problemId }: { problemId: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <span className="ml-auto text-xs text-good">다시 넣었어요</span>;
  return (
    <button
      type="button"
      className="btn-soft ml-auto px-3 py-1 text-xs"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await unskipAction(problemId);
          if (r.ok) setDone(true);
        })
      }
    >
      다시 점검하기
    </button>
  );
}
