import { requireStudent } from "@/lib/session";
import { getStudent } from "@/lib/students";

const TILES = [
  { emoji: "📝", title: "오늘의 숙제", desc: "선생님이 낸 숙제를 풀고 바로 채점해요", color: "from-grape to-[#a48bff]" },
  { emoji: "📒", title: "오답노트", desc: "틀린 문제와 비슷한 문제를 다시 풀어요", color: "from-bubble to-[#ffa8cf]" },
  { emoji: "⭐", title: "중요 문제함", desc: "내가 별표한 문제를 모아 봐요", color: "from-[#ffb800] to-sunny" },
  { emoji: "📈", title: "내 기록", desc: "맞힌 문제와 자라는 실력을 확인해요", color: "from-mint to-sky" },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Seoul" }).format(new Date()));
  if (h < 12) return "좋은 아침";
  if (h < 18) return "반가워";
  return "오늘도 수고했어";
}

export default async function StudentHome() {
  const s = await requireStudent();
  const me = await getStudent(s.studentId);
  const name = me?.name || s.studentId;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-grape via-[#9b6bff] to-bubble p-6 text-white shadow-[0_8px_0_var(--grape-dark)]">
        <p className="text-white/80">{me?.classId ? `${me.classId} · ` : ""}@{s.studentId}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl">
          {greeting()}, {name}! 👋
        </h1>
        <p className="mt-2 text-white/90">오늘도 한 문제씩 차근차근 해 보자.</p>
        <span aria-hidden="true" className="absolute -right-4 -bottom-6 font-display text-9xl text-white/15">
          π
        </span>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {TILES.map((t) => (
          <div key={t.title} className="card relative overflow-hidden">
            <div className={`mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl ${t.color}`}>
              {t.emoji}
            </div>
            <h2 className="font-display text-xl">{t.title}</h2>
            <p className="text-sm text-ink-soft">{t.desc}</p>
            <span className="absolute top-4 right-4 rounded-full bg-bg px-2.5 py-1 text-xs font-bold text-ink-soft">곧 열려요</span>
          </div>
        ))}
      </div>
    </div>
  );
}
