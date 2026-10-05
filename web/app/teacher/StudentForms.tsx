"use client";

import { useActionState } from "react";
import { IconKey, IconPlus, IconTrash } from "@/components/Icons";
import { addStudent, resetPassword, type ActionState } from "./actions";

/** 새로 만든 비밀번호를 크게 보여 준다. 다시 볼 수 없으니 학생에게 바로 알려 주도록 안내. */
function PasswordNotice({ state }: { state: ActionState }) {
  if (!state?.tempPassword) return null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-warn-soft p-4">
      <p className="text-sm text-ink-soft">
        <b className="font-semibold text-ink">{state.studentId}</b> 의 새 비밀번호
      </p>
      <p className="my-1 font-mono text-3xl font-semibold tracking-[0.25em] tabular-nums">{state.tempPassword}</p>
      <p className="text-xs text-ink-soft">학생에게 지금 알려 주세요. 이 화면을 벗어나면 다시 볼 수 없어요.</p>
    </div>
  );
}

export function AddStudentForm({ classes }: { classes: string[] }) {
  const [state, action, pending] = useActionState(addStudent, undefined);
  return (
    <div className="card">
      <h2 className="text-base font-semibold">학생 추가</h2>
      <p className="mb-4 text-sm text-ink-soft">비밀번호는 숫자 6자리로 자동으로 만들어져요.</p>
      <form action={action} className="grid gap-2.5 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input name="studentId" defaultValue={state?.values?.studentId} className="field" placeholder="아이디 (예: kim01)" required />
        <input name="name" defaultValue={state?.values?.name} className="field" placeholder="이름" />
        <input name="classId" defaultValue={state?.values?.classId} className="field" placeholder="반 (예: 고1A)" list="class-list" />
        <datalist id="class-list">
          {classes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="btn-main" disabled={pending}>
          <IconPlus />
          {pending ? "추가 중…" : "추가"}
        </button>
      </form>
      {state?.error && <p className="mt-3 text-sm font-medium text-bad">{state.error}</p>}
      {state?.ok && <p className="mt-3 text-sm font-medium text-good">{state.ok}</p>}
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
        <button className="btn-soft px-3 py-2" disabled={pending}>
          <IconKey />
          비밀번호 재발급
        </button>
      </form>
      {state?.error && <p className="mt-2 text-sm font-medium text-bad">{state.error}</p>}
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
      <button className="btn-danger px-3 py-2" aria-label={`${studentId} 삭제`}>
        <IconTrash />
        삭제
      </button>
    </form>
  );
}
