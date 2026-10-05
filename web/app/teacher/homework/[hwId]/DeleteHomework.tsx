"use client";

import { useTransition } from "react";
import { IconTrash } from "@/components/Icons";
import { deleteHomeworkAction } from "../actions";

export default function DeleteHomework({ hwId, title }: { hwId: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-danger py-2"
      disabled={pending}
      onClick={() => {
        if (confirm(`'${title}' 숙제를 지울까요? 학생들이 낸 답과 채점도 함께 지워져요.`)) start(() => deleteHomeworkAction(hwId));
      }}
    >
      <IconTrash />
      {pending ? "지우는 중…" : "지우기"}
    </button>
  );
}
