import type { Metadata } from "next";
import { IconNote } from "@/components/Icons";
import WrongSections from "@/components/WrongSections";
import { dayLabel } from "@/lib/hwFormat";
import { requireStudent } from "@/lib/session";
import { wrongNotes } from "@/lib/study";
import { parseView } from "@/lib/wrongGroups";
import StudyCard from "../study/StudyCard";

export const metadata: Metadata = { title: "오답노트 · 수학클래스룸" };

export default async function WrongNotes({ searchParams }: PageProps<"/student/wrong">) {
  const me = await requireStudent();
  const view = parseView((await searchParams).view);
  const items = await wrongNotes(me.studentId);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Wrong notes</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">오답노트</h1>
        <p className="mt-1 text-sm text-ink-soft">숙제에서 틀린 문제를 모았어요. 다시 풀어 보고, 비슷한 문제로 한 번 더 연습해요.</p>
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
        <WrongSections
          items={items}
          view={view}
          baseHref="/student/wrong"
          card={(it, no) => (
            <StudyCard
              key={it.id}
              p={it}
              no={no}
              starred={it.starred}
              myAnswer={it.myAnswer}
              from={view === "date" ? it.unit : `${dayLabel(it.day)} ${it.hwTitle}`}
              similar={it.similar}
            />
          )}
        />
      )}
    </div>
  );
}
