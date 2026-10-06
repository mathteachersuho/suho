import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrow, IconPrinter } from "@/components/Icons";
import { getHomework, homeworkRepeats } from "@/lib/homework";
import { dueLabel } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import DeleteHomework from "./DeleteHomework";
import MarkGrid from "./MarkGrid";

export const metadata: Metadata = { title: "숙제 현황 · 수학클래스룸" };

export default async function HomeworkDetail({ params, searchParams }: PageProps<"/teacher/homework/[hwId]">) {
  const { hwId } = await params;
  const isNew = (await searchParams).new === "1";
  const [data, repeats] = await Promise.all([getHomework(hwId), homeworkRepeats(hwId)]);
  if (!data) notFound();
  const { hw, problems, students, results } = data;
  const submitted = new Set(results.map((r) => r.studentId)).size;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/teacher/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          숙제 목록
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{hw.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {[hw.classId, `${problems.length}문제`, dueLabel(hw.dueDate), `낸 학생 ${submitted}/${students.length}`].filter(Boolean).join(" · ")}
            </p>
            {hw.memo && <p className="mt-1 text-sm">메모: {hw.memo}</p>}
          </div>
          <div className="ml-auto flex gap-2">
            <Link href={`/print?ids=${encodeURIComponent(problems.map((p) => p.id).join(","))}&title=${encodeURIComponent(hw.title)}`} className="btn-soft py-2">
              <IconPrinter />
              학습지 인쇄
            </Link>
            <DeleteHomework hwId={hw.hwId} title={hw.title} />
          </div>
        </div>
        {isNew && (
          <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">
            숙제를 냈어요. 학생이 로그인하면 &lsquo;숙제&rsquo;에서 바로 풀 수 있어요.
          </p>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">학생별 채점 · 표시</h2>
        <p className="text-sm text-ink-soft">
          종이로 걷은 숙제도 여기서 O/X만 넣으면 돼요. 학생이 어려워했거나 꼭 다시 봐야 할 문제는 ★ 중요 · ! 어려움으로 표시해 두세요. 바꾼 뒤 &lsquo;저장&rsquo;을 누르세요.
        </p>
        <MarkGrid
          hwId={hw.hwId}
          problems={problems.map((p) => ({ id: p.id, answer: p.answer }))}
          students={students}
          results={results}
          repeats={repeats}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">문제와 정답</h2>
        <ol className="space-y-3">
          {problems.map((p, i) => (
            <li key={p.id} className="card p-4 sm:p-5">
              <p className="mb-2 text-sm font-semibold">
                {i + 1}번 <span className="font-normal text-ink-faint">{[p.type, p.frame, p.difficulty].filter(Boolean).join(" · ")}</span>
                {(() => {
                  const again = students.flatMap((s) => {
                    const r = repeats[`${s.studentId}\u0000${p.id}`];
                    return r ? [`${s.name || s.studentId} ${r.n}번째`] : [];
                  });
                  return again.length > 0 && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">다시 푸는 학생: {again.join(", ")}</span>;
                })()}
              </p>
              <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.question) }} />
              <details className="mt-3 border-t border-line pt-3 text-sm">
                <summary className="cursor-pointer text-ink-soft">정답·풀이 보기</summary>
                <div className="mt-2 flex gap-2">
                  <span className="shrink-0 font-semibold">정답</span>
                  <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.answer) }} />
                </div>
                {p.solution && <div className="problem-body mt-1 text-ink-soft" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.solution) }} />}
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
