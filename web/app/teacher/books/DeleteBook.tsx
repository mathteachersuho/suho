"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconTrash } from "@/components/Icons";
import { deleteBookAction } from "./actions";

export default function DeleteBook({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () => {
    if (!confirm(`'${title}' 교재를 지울까요?\nPDF 파일이 지워져요. 이 교재로 만든 문제는 문제 은행에 그대로 남아요.`)) return;
    start(async () => {
      const r = await deleteBookAction(id);
      if (!r.ok) alert(r.error);
      router.refresh();
    });
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-label={`${title} 지우기`}
      title="교재 지우기"
      className="btn shrink-0 border border-line bg-surface px-2.5 py-1.5 text-ink-soft hover:border-bad/40 hover:bg-bad-soft hover:text-bad"
    >
      <IconTrash />
    </button>
  );
}
