"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconTrash } from "@/components/Icons";
import { cart } from "@/lib/cart";
import { deleteProblemAction, problemUsageAction } from "./actions";

/** 문제 은행에서 문제 하나 지우기. 숙제에 쓰였으면 무엇이 함께 지워지는지 먼저 알려 준다. */
export default function DeleteProblem({ id, no }: { id: string; no?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const label = no !== undefined ? `${no}번 문제` : "이 문제";

  const run = () =>
    start(async () => {
      const u = await problemUsageAction(id);
      if (!u) {
        alert("이미 지워진 문제예요.");
        router.refresh();
        return;
      }
      const lines = [`${label}를 문제 은행에서 지울까요? 되돌릴 수 없어요.`];
      if (u.homework) lines.push(`\n· 숙제 ${u.homework}개에 들어 있어요. 그 숙제에서도 빠져요.`);
      if (u.answers) lines.push(`· 학생이 이 문제에 낸 답과 채점 ${u.answers}개도 함께 지워져요.`);
      if (!confirm(lines.join("\n"))) return;
      const r = await deleteProblemAction(id);
      cart.remove(id);
      if (r.error) alert(r.error);
      router.refresh();
    });

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-label={`${label} 지우기`}
      title="문제 지우기"
      className="btn shrink-0 border border-line bg-surface px-2.5 py-1.5 text-ink-soft hover:border-bad/40 hover:bg-bad-soft hover:text-bad"
    >
      <IconTrash />
      <span className="sr-only sm:not-sr-only">{pending ? "지우는 중…" : "지우기"}</span>
    </button>
  );
}
