import type { Metadata } from "next";
import Link from "next/link";
import { IconClipboard, IconPlus, IconSparkle } from "@/components/Icons";
import { listHomeworkByClass, type ClassHomework } from "@/lib/homework";
import { dayLabel, dueLabel, todaySeoul } from "@/lib/hwFormat";

export const metadata: Metadata = { title: "숙제 · 수학클래스룸" };

const NO_CLASS = "반 없음";
const className = (c: string) => c || NO_CLASS;
const byKo = (a: string, b: string) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ko", { numeric: true }));

/** 같은 키끼리 순서를 지키며 묶는다 */
function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

export default async function HomeworkList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rows = await listHomeworkByClass();
  const byClass = groupBy(rows, (h) => h.classId);
  const classes = [...byClass.keys()].sort(byKo);
  const want = typeof sp.class === "string" ? sp.class : undefined;
  const pick = want !== undefined && byClass.has(want) ? want : null; // null = 모든 반
  const shown = pick === null ? classes : [pick];
  const today = todaySeoul();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">숙제</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">낸 숙제</h1>
          <p className="mt-1 text-sm text-ink-soft">반별로, 반 안에서는 낸 날짜별로 보여요. 숙제를 누르면 학생별 O/X를 보고 고칠 수 있어요.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/teacher/homework/weak" className="btn-soft">
            <IconSparkle />
            약한 유형 숙제
          </Link>
          <Link href="/teacher/homework/new" className="btn-main">
            <IconPlus />
            숙제 내기
          </Link>
        </div>
      </div>

      {!rows.length ? (
        <div className="card text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <IconClipboard className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 낸 숙제가 없어요</p>
          <p className="mt-1 text-sm text-ink-soft">문제 은행에서 문제를 담은 뒤 아래쪽 막대의 &lsquo;숙제로 내기&rsquo;를 누르세요.</p>
          <Link href="/teacher/bank" className="btn-soft mt-4">
            문제 은행으로
          </Link>
        </div>
      ) : (
        <>
          {classes.length > 1 && (
            <nav className="flex flex-wrap gap-2" aria-label="반 고르기">
              <ClassChip href="/teacher/homework" on={pick === null} label="모든 반" />
              {classes.map((c) => (
                <ClassChip key={c} href={`/teacher/homework?class=${encodeURIComponent(c)}`} on={pick === c} label={className(c)} count={byClass.get(c)!.length} />
              ))}
            </nav>
          )}
          {shown.map((c) => (
            <section key={c} className="space-y-3" aria-label={className(c)}>
              <h2 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
                {className(c)}
                <span className="text-sm font-normal text-ink-faint">숙제 {byClass.get(c)!.length}개</span>
              </h2>
              {[...groupBy(byClass.get(c)!, (h) => h.day)].map(([day, list]) => (
                <div key={day}>
                  <h3 className="mb-1.5 px-1 text-sm font-semibold text-ink-soft">
                    {dayLabel(day)}
                    {day === today && <span className="ml-1.5 text-accent">오늘</span>}
                  </h3>
                  <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                    {list.map((h) => (
                      <HomeworkRow key={h.hwId} h={h} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function ClassChip({ href, on, label, count }: { href: string; on: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-soft hover:text-ink"}`}
    >
      {label}
      {count !== undefined && <span className={`ml-1.5 tabular-nums ${on ? "opacity-70" : "text-ink-faint"}`}>{count}</span>}
    </Link>
  );
}

function HomeworkRow({ h }: { h: ClassHomework }) {
  const graded = h.submittedCount * h.problemCount;
  const rate = graded ? Math.round((h.correctCount / graded) * 100) : null;
  return (
    <li>
      <Link href={`/teacher/homework/${h.hwId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{h.title}</p>
          <p className="text-sm text-ink-soft">{[`${h.problemCount}문제`, dueLabel(h.dueDate)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-4 text-sm tabular-nums">
          <span className={h.studentCount && h.submittedCount === h.studentCount ? "text-good" : "text-ink-soft"}>
            낸 학생 {h.submittedCount}/{h.studentCount}
          </span>
          <span className="w-16 text-right text-ink-soft">{rate === null ? "－" : `정답 ${rate}%`}</span>
        </div>
      </Link>
    </li>
  );
}
