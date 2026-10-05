import { redirect } from "next/navigation";
import { Logo } from "@/components/Brand";
import { getSession } from "@/lib/session";
import LoginForm from "./LoginForm";

const POINTS = [
  ["오답 → 유형", "틀린 문제의 유형을 찾아 비슷한 문제로 다시 연습해요."],
  ["숙제 → 바로 채점", "답을 적으면 그 자리에서 결과를 확인해요."],
  ["기록 → 성장", "내가 약한 유형과 나아진 점이 한눈에 보여요."],
];

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.role === "teacher" ? "/teacher" : "/student");
  return (
    <main className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
      {/* 왼쪽 소개 (넓은 화면에서만) */}
      <section className="relative hidden overflow-hidden bg-[#0b0d14] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px 400px at 15% 10%, rgba(124,116,255,.35), transparent 60%), radial-gradient(500px 400px at 90% 90%, rgba(56,189,248,.18), transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-lg font-bold text-[#0b0d14]">Σ</span>
            <span className="text-lg font-bold">수학클래스룸</span>
          </span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">
            틀린 문제가
            <br />
            <span className="bg-gradient-to-r from-[#a5a0ff] to-[#7dd3fc] bg-clip-text text-transparent">실력이 되는 곳</span>
          </h2>
          <ul className="mt-10 space-y-5">
            {POINTS.map(([t, d]) => (
              <li key={t} className="border-l border-white/20 pl-4">
                <p className="font-semibold">{t}</p>
                <p className="text-sm text-white/60">{d}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© 수학클래스룸</p>
      </section>

      {/* 오른쪽 로그인 */}
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">로그인</h1>
          <p className="mt-1 mb-6 text-sm text-ink-soft">선생님께 받은 아이디로 들어오세요.</p>
          <LoginForm />
          <p className="mt-6 text-xs text-ink-faint">아이디나 비밀번호를 잊었다면 선생님께 새 비밀번호를 받으세요.</p>
        </div>
      </section>
    </main>
  );
}
