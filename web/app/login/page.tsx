import { redirect } from "next/navigation";
import { FloatingSymbols, Logo, Mascot } from "@/components/Brand";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.role === "teacher" ? "/teacher" : "/student");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <FloatingSymbols />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="floaty">
            <Mascot size={88} />
          </div>
          <h1 className="mt-3">
            <Logo />
          </h1>
          <p className="mt-1 text-ink-soft">오늘도 한 문제씩, 같이 풀어 볼까? ✏️</p>
        </div>
        <div className="card">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-ink-soft">아이디나 비밀번호를 잊었으면 선생님께 물어보세요.</p>
      </div>
    </main>
  );
}
