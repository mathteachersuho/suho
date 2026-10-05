import type { Metadata } from "next";
import Link from "next/link";
import { IconClipboard, IconPlus } from "@/components/Icons";
import { listHomework } from "@/lib/homework";
import { dueLabel } from "@/lib/hwFormat";

export const metadata: Metadata = { title: "숙제 · 수학클래스룸" };

export default async function HomeworkList() {
  const list = await listHomework();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">숙제</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">낸 숙제</h1>
          <p className="mt-1 text-sm text-ink-soft">학생이 낸 답은 바로 채점돼요. 숙제를 누르면 학생별 O/X를 보고 고칠 수 있어요.</p>
        </div>
        <Link href="/teacher/homework/new" className="btn-main ml-auto">
          <IconPlus />
          숙제 내기
        </Link>
      </div>

      {!list.length ? (
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
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {list.map((h) => {
            const graded = h.submittedCount * h.problemCount;
            const rate = graded ? Math.round((h.correctCount / graded) * 100) : null;
            return (
              <li key={h.hwId}>
                <Link href={`/teacher/homework/${h.hwId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{h.title}</p>
                    <p className="text-sm text-ink-soft">
                      {[h.classId, `${h.problemCount}문제`, dueLabel(h.dueDate)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm tabular-nums">
                    <span className={h.submittedCount === h.studentCount ? "text-good" : "text-ink-soft"}>
                      낸 학생 {h.submittedCount}/{h.studentCount}
                    </span>
                    <span className="w-16 text-right text-ink-soft">{rate === null ? "－" : `정답 ${rate}%`}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
