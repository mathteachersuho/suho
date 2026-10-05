import type { Metadata } from "next";
import Link from "next/link";
import { IconStar } from "@/components/Icons";
import { requireStudent } from "@/lib/session";
import { starredProblems } from "@/lib/study";
import StudyCard from "../study/StudyCard";

export const metadata: Metadata = { title: "중요 문제 · 수학클래스룸" };

export default async function Stars() {
  const me = await requireStudent();
  const items = await starredProblems(me.studentId);
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Starred</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">중요 문제</h1>
        <p className="mt-1 text-sm text-ink-soft">숙제 결과나 오답노트에서 &lsquo;중요 표시&rsquo;를 누른 문제가 모여요. 시험 전에 다시 풀어 보세요.</p>
      </div>
      {!items.length ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <IconStar className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 중요 표시한 문제가 없어요</p>
          <p className="text-sm text-ink-soft">숙제를 낸 뒤 결과 화면에서 다시 보고 싶은 문제에 중요 표시를 눌러 보세요.</p>
          <Link href="/student/wrong" className="btn-soft mt-4">
            오답노트 보기
          </Link>
        </div>
      ) : (
        <ol className="space-y-3">
          {items.map((p, i) => (
            <StudyCard key={p.id} p={p} no={i + 1} starred />
          ))}
        </ol>
      )}
    </div>
  );
}
