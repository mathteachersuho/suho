"use client";

import { useState } from "react";
import { outOfLevel, rewriteInstruction } from "@/lib/levelCheck";

/** 풀이에 그 학년에서 아직 배우지 않은 표현이 있으면 알려 주고, AI로 그 학년 방식으로 다시 쓰게 한다 */
export default function LevelWarning({
  grade,
  solution,
  onFix,
}: {
  grade: string;
  solution: string;
  onFix: (instruction: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const found = outOfLevel(grade, solution);
  if (!found.length) return null;
  const fix = async () => {
    setBusy(true);
    setError("");
    const e = await onFix(rewriteInstruction(grade, found));
    setBusy(false);
    if (e) setError(e);
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs">
      <span className="font-semibold text-warn">
        {grade}에서 아직 배우지 않은 표현: {found.join(", ")}
      </span>
      <button type="button" className="btn-soft px-2.5 py-1" onClick={fix} disabled={busy}>
        {busy ? "고치는 중…" : `${grade} 방식으로 풀이 다시 쓰기`}
      </button>
      {error && <span className="text-bad">{error}</span>}
    </div>
  );
}
