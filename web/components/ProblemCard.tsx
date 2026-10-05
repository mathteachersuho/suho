import { renderProblemHtml } from "@/lib/mathText";
import type { Problem } from "@/lib/problems";

const DIFF_STYLE: Record<string, string> = {
  하: "text-good border-good/30",
  중: "text-accent border-accent/30",
  상: "text-bad border-bad/30",
};

/** 문제 한 개: 분류, 문제, (펼치면) 정답과 풀이. 오른쪽 위 action 칸에 버튼을 넣을 수 있다. */
export default function ProblemCard({ p, no, action }: { p: Problem; no?: number; action?: React.ReactNode }) {
  const path = [p.grade, p.unit, p.type].filter(Boolean).join(" › ");
  return (
    <article className="rounded-2xl border border-line bg-surface p-5">
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
            {no !== undefined && <span className="font-semibold text-ink-soft tabular-nums">{no}</span>}
            <span className="truncate">{path || "분류 없음"}</span>
            {p.frame && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-soft">{p.frame}</span>}
            {p.difficulty && (
              <span className={`rounded border px-1.5 py-0.5 font-semibold ${DIFF_STYLE[p.difficulty] ?? ""}`}>{p.difficulty}</span>
            )}
            {p.verified && <span className="text-good">검토함</span>}
          </p>
        </div>
        {action}
      </header>
      <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.question) }} />
      {(p.answer || p.solution) && (
        <details className="group mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-ink-soft select-none hover:text-ink">
            <span className="group-open:hidden">정답과 풀이 보기</span>
            <span className="hidden group-open:inline">정답과 풀이 접기</span>
          </summary>
          <div className="mt-3 space-y-2 text-sm">
            {p.answer && (
              <div className="flex gap-2">
                <span className="shrink-0 font-semibold">정답</span>
                <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.answer) }} />
              </div>
            )}
            {p.solution && <div className="problem-body text-ink-soft" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.solution) }} />}
          </div>
        </details>
      )}
    </article>
  );
}
