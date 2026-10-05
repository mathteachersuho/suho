import { IconArrow, IconChart, IconClipboard, IconNote, IconStar } from "@/components/Icons";
import { requireStudent } from "@/lib/session";
import { getStudent } from "@/lib/students";

const TILES = [
  { icon: IconClipboard, title: "오늘의 숙제", desc: "선생님이 낸 숙제를 풀고 바로 채점해요", wide: true },
  { icon: IconNote, title: "오답노트", desc: "틀린 문제와 같은 유형을 다시 풀어요", wide: false },
  { icon: IconStar, title: "중요 문제", desc: "별표한 문제만 모아 봐요", wide: false },
  { icon: IconChart, title: "내 기록", desc: "유형별 정답률과 성장 흐름을 확인해요", wide: true },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Seoul" }).format(new Date()));
  if (h < 12) return "좋은 아침이에요";
  if (h < 18) return "안녕하세요";
  return "오늘도 수고했어요";
}

export default async function StudentHome() {
  const s = await requireStudent();
  const me = await getStudent(s.studentId);
  const name = me?.name || s.studentId;

  return (
    <div className="space-y-8">
      <section>
        <p className="eyebrow normal-case tracking-normal">
          {me?.classId ? `${me.classId} · ` : ""}@{s.studentId}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {greeting()}, <span className="text-accent">{name}</span>
        </h1>
        <p className="mt-2 text-ink-soft">오늘 할 일부터 하나씩 끝내 봐요.</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {TILES.map((t) => (
          <div
            key={t.title}
            className={`group relative flex min-h-32 flex-col justify-between rounded-2xl border border-line bg-surface p-5 ${t.wide ? "sm:col-span-2" : ""}`}
          >
            <div className="flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink">
                <t.icon className="h-5 w-5" />
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-faint">곧 열려요</span>
            </div>
            <div className="mt-4 sm:mt-6">
              <h2 className="flex items-center gap-1 font-semibold">
                {t.title}
                <IconArrow className="h-4 w-4 text-ink-faint" />
              </h2>
              <p className="mt-0.5 text-sm text-ink-soft">{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
