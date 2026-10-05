import type { Metadata } from "next";
import Link from "next/link";
import { IconNote } from "@/components/Icons";
import { dayLabel } from "@/lib/hwFormat";
import { requireStudent } from "@/lib/session";
import { wrongNotes, type WrongItem } from "@/lib/study";
import StudyCard from "../study/StudyCard";

export const metadata: Metadata = { title: "오답노트 · 수학클래스룸" };

export default async function WrongNotes({ searchParams }: PageProps<"/student/wrong">) {
  const me = await requireStudent();
  const sp = await searchParams;
  const items = await wrongNotes(me.studentId);

  // 유형별로 묶고, 많이 틀린 유형부터
  const groups = new Map<string, WrongItem[]>();
  for (const it of items) {
    const k = it.type || "유형 없음";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const types = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const pick = typeof sp.type === "string" && groups.has(sp.type) ? sp.type : null;
  const shown = pick ? types.filter(([k]) => k === pick) : types;
  let no = 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Wrong notes</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">오답노트</h1>
        <p className="mt-1 text-sm text-ink-soft">숙제에서 틀린 문제를 유형별로 모았어요. 다시 풀어 보고, 비슷한 문제로 한 번 더 연습해요.</p>
      </div>

      {!items.length ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <IconNote className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 틀린 문제가 없어요</p>
          <p className="text-sm text-ink-soft">숙제에서 틀린 문제가 생기면 여기에 모여요.</p>
        </div>
      ) : (
        <>
          {types.length > 1 && (
            <nav className="flex flex-wrap gap-2" aria-label="유형 고르기">
              <Chip href="/student/wrong" on={!pick} label="전체" count={items.length} />
              {types.map(([k, list]) => (
                <Chip key={k} href={`/student/wrong?type=${encodeURIComponent(k)}`} on={pick === k} label={k} count={list.length} />
              ))}
            </nav>
          )}
          {shown.map(([k, list]) => (
            <section key={k} className="space-y-3">
              <h2 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
                {k}
                <span className="text-sm font-normal text-ink-faint">{list.length}문제</span>
              </h2>
              <ol className="space-y-3">
                {list.map((it) => (
                  <StudyCard
                    key={it.id}
                    p={it}
                    no={++no}
                    starred={it.starred}
                    myAnswer={it.myAnswer}
                    from={`${dayLabel(it.day)} ${it.hwTitle}`}
                    similar={it.similar}
                  />
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Chip({ href, on, label, count }: { href: string; on: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-soft hover:text-ink"}`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${on ? "opacity-70" : "text-ink-faint"}`}>{count}</span>
    </Link>
  );
}
