"use client";

import { useActionState, useState } from "react";
import { studentLogin, teacherLogin } from "@/app/actions/auth";

export default function LoginForm() {
  const [who, setWho] = useState<"student" | "teacher">("student");
  // 틀렸을 때 아이디를 다시 적지 않아도 되게 직접 기억한다(제출 후 폼이 비워지기 때문).
  const [studentId, setStudentId] = useState("");
  const [sState, sAction, sPending] = useActionState(studentLogin, undefined);
  const [tState, tAction, tPending] = useActionState(teacherLogin, undefined);

  return (
    <div>
      <div role="tablist" className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-bg p-1">
        {(
          [
            ["student", "🎒 학생"],
            ["teacher", "🧑‍🏫 선생님"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={who === key}
            type="button"
            onClick={() => setWho(key)}
            className={`rounded-xl py-2.5 font-bold transition ${
              who === key ? "bg-white text-grape shadow" : "text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {who === "student" ? (
        <form action={sAction} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink-soft">아이디</span>
            <input name="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)} className="field" autoComplete="username" placeholder="선생님이 알려준 아이디" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink-soft">비밀번호</span>
            <input
              name="password"
              type="password"
              inputMode="numeric"
              className="field"
              autoComplete="current-password"
              placeholder="숫자 6자리"
              required
            />
          </label>
          {sState?.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-500">{sState.error}</p>}
          <button className="btn-main w-full text-lg" disabled={sPending}>
            {sPending ? "들어가는 중…" : "들어가기 🚀"}
          </button>
        </form>
      ) : (
        <form action={tAction} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink-soft">선생님 비밀번호</span>
            <input name="password" type="password" className="field" autoComplete="current-password" required />
          </label>
          {tState?.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-500">{tState.error}</p>}
          <button className="btn-main w-full text-lg" disabled={tPending}>
            {tPending ? "들어가는 중…" : "선생님으로 들어가기"}
          </button>
        </form>
      )}
    </div>
  );
}
