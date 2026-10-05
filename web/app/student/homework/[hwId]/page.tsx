import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrow } from "@/components/Icons";
import { getStudentHomework } from "@/lib/homework";
import { dueLabel } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import { requireStudent } from "@/lib/session";
import { starredIds } from "@/lib/study";
import StarButton from "../../study/StarButton";
import SolveForm from "./SolveForm";

export const metadata: Metadata = { title: "숙제 풀기 · 수학클래스룸" };

const MARK = {
  Y: { text: "맞음", cls: "bg-good/15 text-good" },
  N: { text: "틀림", cls: "bg-bad-soft text-bad" },
  "?": { text: "선생님 확인 중", cls: "bg-surface-2 text-ink-soft" },
  "": { text: "채점 전", cls: "bg-surface-2 text-ink-soft" },
} as const;

export default async function SolveHomework({ params }: PageProps<"/student/homework/[hwId]">) {
  const me = await requireStudent();
  const { hwId } = await params;
  const data = await getStudentHomework(me.studentId, hwId);
  if (!data) notFound();
  const { hw, problems, results } = data;
  const byP = new Map(results.map((r) => [r.problemId, r]));
  const submitted = results.length > 0;
  const ok = results.filter((r) => r.correct === "Y").length;
  const stars = submitted ? await starredIds(me.studentId) : new Set<string>();

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/student/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          숙제 목록
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{hw.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{[`${problems.length}문제`, dueLabel(hw.dueDate)].filter(Boolean).join(" · ")}</p>
        {hw.memo && <p className="mt-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">선생님 메모: {hw.memo}</p>}
      </div>

      {!submitted ? (
        <SolveForm
          hwId={hw.hwId}
          problems={problems.map((p) => ({ id: p.id, html: renderProblemHtml(p.question) }))}
        />
      ) : (
        <>
          <div className="card flex items-center gap-4">
            <div>
              <p className="text-sm text-ink-soft">채점 결과</p>
              <p className="text-3xl font-bold tabular-nums">
                {ok}
                <span className="text-lg font-medium text-ink-soft"> / {problems.length}</span>
              </p>
            </div>
            <p className="ml-auto text-right text-sm text-ink-soft">
              틀린 문제는 <Link href="/student/wrong" className="underline">오답노트</Link>에 모여요.
              <br className="hidden sm:inline" /> 다시 보고 싶은 문제는 중요 표시를 눌러 두세요.
            </p>
          </div>
          <ol className="space-y-3">
            {problems.map((p, i) => {
              const r = byP.get(p.id);
              const m = MARK[(r?.correct ?? "") as keyof typeof MARK];
              return (
                <li key={p.id} className="card p-4 sm:p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-semibold">{i + 1}번</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.text}</span>
                    <span className="ml-auto">
                      <StarButton id={p.id} starred={stars.has(p.id)} />
                    </span>
                  </div>
                  <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.question) }} />
                  <p className="mt-3 text-sm">
                    <span className="text-ink-soft">내 답 </span>
                    <span className="font-medium">{r?.answer || "(빈칸)"}</span>
                  </p>
                  <details className="mt-3 border-t border-line pt-3 text-sm" open={r?.correct === "N"}>
                    <summary className="cursor-pointer text-ink-soft">정답·풀이 보기</summary>
                    <div className="mt-2 flex gap-2">
                      <span className="shrink-0 font-semibold">정답</span>
                      <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.answer) }} />
                    </div>
                    {p.solution && <div className="problem-body mt-1 text-ink-soft" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.solution) }} />}
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
