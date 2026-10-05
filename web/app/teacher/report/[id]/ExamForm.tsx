"use client";

import { useActionState, useState, useTransition } from "react";
import { IconPlus, IconTrash } from "@/components/Icons";
import { addExamAction, deleteExamAction } from "../actions";

/** 시험 점수 넣기: 날짜·학원/학교·이름·점수/만점·메모 */
export function ExamForm({ studentId, today }: { studentId: string; today: string }) {
  const [state, action, pending] = useActionState(addExamAction, undefined);
  const v = state?.values;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-2 sm:grid-cols-[9.5rem_7rem_1fr]">
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">본 날</span>
          <input type="date" name="takenOn" defaultValue={v?.takenOn ?? today} max="2100-12-31" className="field py-2" required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">구분</span>
          <select name="kind" className="field py-2" defaultValue={v?.kind ?? "학교"}>
            <option>학교</option>
            <option>학원</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">시험 이름</span>
          <input name="name" maxLength={60} defaultValue={v?.name} placeholder="예: 2학기 중간고사" className="field py-2" required />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_7rem_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">점수</span>
          <input name="score" inputMode="decimal" defaultValue={v?.score} placeholder="85" className="field py-2" required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">만점</span>
          <input name="maxScore" inputMode="decimal" defaultValue={v?.maxScore ?? "100"} className="field py-2" required />
        </label>
        <label className="col-span-2 space-y-1 text-sm sm:col-span-1">
          <span className="text-ink-soft">메모 (선택)</span>
          <input name="memo" maxLength={200} defaultValue={v?.memo} placeholder="예: 서술형 2문제 감점" className="field py-2" />
        </label>
        <button disabled={pending} className="btn-main col-span-2 sm:col-span-1">
          <IconPlus />
          {pending ? "저장하는 중…" : "점수 저장"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
    </form>
  );
}

export function DeleteExam({ studentId, id, name }: { studentId: string; id: string; name: string }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      title="이 시험 기록 지우기"
      aria-label={`${name} 지우기`}
      onClick={() => {
        if (!confirm(`'${name}' 점수를 지울까요?`)) return;
        start(async () => setFailed(!(await deleteExamAction(studentId, id))));
      }}
      className="rounded-lg p-1.5 text-ink-faint hover:bg-bad-soft hover:text-bad disabled:opacity-40"
    >
      <IconTrash />
      {failed && <span className="sr-only">지우지 못했어요</span>}
    </button>
  );
}
