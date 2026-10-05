import type { Metadata } from "next";
import { IconKey } from "@/components/Icons";
import { requireStudent } from "@/lib/session";
import PasswordForm from "./PasswordForm";

export const metadata: Metadata = { title: "비밀번호 바꾸기 · 수학클래스룸" };

export default async function ChangePassword() {
  await requireStudent();
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
          <IconKey className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">비밀번호 바꾸기</h1>
        <p className="mt-1 text-sm text-ink-soft">선생님이 준 비밀번호를 나만 아는 비밀번호로 바꿔요. 잊어버리면 선생님께 새로 받으면 돼요.</p>
      </div>
      <div className="card">
        <PasswordForm />
      </div>
    </div>
  );
}
