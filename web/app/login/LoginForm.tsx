"use client";

import { useActionState, useState } from "react";
import { studentLogin, teacherLogin } from "@/app/actions/auth";
import { IconArrow } from "@/components/Icons";

export default function LoginForm() {
  const [who, setWho] = useState<"student" | "teacher">("student");
  // 틀렸을 때 아이디를 다시 적지 않아도 되게 직접 기억한다(제출 후 폼이 비워지기 때문).
  const [studentId, setStudentId] = useState("");
  const [sState, sAction, sPending] = useActionState(studentLogin, undefined);
  const [tState, tAction, tPending] = useActionState(teacherLogin, undefined);

  const error = (msg?: string) =>
    msg && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-medium text-bad">{msg}</p>;

  return (
    <div>
      <div role="tablist" className="mb-5 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-sm">
        {(
          [
            ["student", "학생"],
            ["teacher", "선생님"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={who === key}
            type="button"
            onClick={() => setWho(key)}
            className={`rounded-lg py-2 font-semibold transition ${
              who === key ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {who === "student" ? (
        <form action={sAction} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-soft">아이디</span>
            <input
              name="studentId"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="field"
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-soft">비밀번호</span>
            <input name="password" type="password" inputMode="numeric" className="field" autoComplete="current-password" required />
          </label>
          {error(sState?.error)}
          <button className="btn-main w-full py-3" disabled={sPending}>
            {sPending ? "확인 중…" : <>로그인 <IconArrow /></>}
          </button>
        </form>
      ) : (
        <form action={tAction} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-soft">선생님 비밀번호</span>
            <input name="password" type="password" className="field" autoComplete="current-password" required />
          </label>
          {error(tState?.error)}
          <button className="btn-main w-full py-3" disabled={tPending}>
            {tPending ? "확인 중…" : <>선생님으로 로그인 <IconArrow /></>}
          </button>
        </form>
      )}
    </div>
  );
}
