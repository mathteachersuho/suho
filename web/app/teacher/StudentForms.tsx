"use client";

import { useActionState } from "react";
import { addStudent, resetPassword, type ActionState } from "./actions";

/** 새로 만든 비밀번호를 크게 보여 준다. 다시 볼 수 없으니 학생에게 바로 알려 주도록 안내. */
function PasswordNotice({ state }: { state: ActionState }) {
  if (!state?.tempPassword) return null;
  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-sunny bg-[#fffbea] p-4">
      <p className="text-sm font-bold text-ink-soft">
        <b className="text-ink">{state.studentId}</b> 의 비밀번호
      </p>
      <p className="my-1 font-display text-4xl tracking-[0.3em] text-grape">{state.tempPassword}</p>
      <p className="text-xs text-ink-soft">학생에게 지금 알려 주세요. 이 화면을 벗어나면 다시 볼 수 없어요.</p>
    </div>
  );
}

export function AddStudentForm({ classes }: { classes: string[] }) {
  const [state, action, pending] = useActionState(addStudent, undefined);
  return (
    <div className="card">
      <h2 className="font-display text-xl">✨ 학생 추가</h2>
      <p className="mb-4 text-sm text-ink-soft">비밀번호는 숫자 6자리로 자동으로 만들어져요.</p>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input name="studentId" defaultValue={state?.values?.studentId} className="field" placeholder="아이디 (예: kim01)" required />
        <input name="name" defaultValue={state?.values?.name} className="field" placeholder="이름 또는 별명" />
        <input name="classId" defaultValue={state?.values?.classId} className="field" placeholder="반 (예: 중2A)" list="class-list" />
        <datalist id="class-list">
          {classes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="btn-main" disabled={pending}>
          {pending ? "추가 중…" : "추가"}
        </button>
      </form>
      {state?.error && <p className="mt-3 text-sm font-bold text-rose-500">{state.error}</p>}
      {state?.ok && <p className="mt-3 text-sm font-bold text-mint">{state.ok}</p>}
      <PasswordNotice state={state} />
    </div>
  );
}

export function ResetPasswordButton({ studentId }: { studentId: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <div>
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm(`${studentId} 학생의 비밀번호를 새로 만들까요? 예전 비밀번호는 더 이상 쓸 수 없어요.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="studentId" value={studentId} />
        <button className="btn-soft px-3 py-2 text-sm" disabled={pending}>
          🔑 비밀번호 새로
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm font-bold text-rose-500">{state.error}</p>}
      <PasswordNotice state={state} />
    </div>
  );
}

export function DeleteStudentButton({ studentId, action }: { studentId: string; action: (f: FormData) => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`${studentId} 학생을 지울까요?\n이 학생에게 준 문제와 숙제 기록도 함께 지워지고 되돌릴 수 없어요.`))
          e.preventDefault();
      }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <button className="btn-danger px-3 py-2 text-sm">삭제</button>
    </form>
  );
}
