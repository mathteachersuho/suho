"use client";

import { useActionState } from "react";
import { changeMyPassword } from "./actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changeMyPassword, undefined);
  if (state?.ok) return <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-medium">{state.ok}</p>;
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-soft">지금 비밀번호</span>
        <input name="current" type="password" className="field" autoComplete="current-password" required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-soft">새 비밀번호 (4~30자)</span>
        <input name="next" type="password" className="field" autoComplete="new-password" minLength={4} maxLength={30} required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-soft">새 비밀번호 한 번 더</span>
        <input name="again" type="password" className="field" autoComplete="new-password" minLength={4} maxLength={30} required />
      </label>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      <button className="btn-main w-full py-3" disabled={pending}>
        {pending ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );
}
