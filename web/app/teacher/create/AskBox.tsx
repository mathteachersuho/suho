"use client";

import { useState } from "react";
import { IconSparkle } from "@/components/Icons";

/**
 * "AI로 고치기" 한 줄 입력. 말로 적은 요청을 onAsk 로 보내고, 실패하면 요청 글은 남겨 둔 채 오류만 보여 준다.
 * onAsk 는 성공하면 null, 실패하면 오류 문구를 돌려준다.
 */
export default function AskBox({
  id,
  label,
  placeholder,
  onAsk,
}: {
  id: string;
  label: string;
  placeholder: string;
  onAsk: (instruction: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const err = await onAsk(text.trim());
    setBusy(false);
    if (err) setError(err);
    else setText("");
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
        <IconSparkle className="h-3.5 w-3.5 text-accent" />
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="field py-2"
          maxLength={1000}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" className="btn-main shrink-0 px-3 py-2" disabled={busy || !text.trim()}>
          {busy ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
          {busy ? "고치는 중" : "AI로 고치기"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm text-bad">{error}</p>}
    </form>
  );
}
