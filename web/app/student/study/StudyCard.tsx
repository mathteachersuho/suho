import { TAG_STYLE } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import type { StudyProblem } from "@/lib/study";
import Retry from "./Retry";
import StarButton from "./StarButton";

const tag = (p: StudyProblem) => [p.type, p.difficulty && `난이도 ${p.difficulty}`].filter(Boolean).join(" · ");

/** 오답노트·중요 문제의 문제 한 장: 문제, (내 답), 다시 풀기, 정답·풀이, 비슷한 문제 */
export default function StudyCard({
  p,
  no,
  starred,
  myAnswer,
  from,
  similar = [],
  tags = [],
  right = false,
}: {
  p: StudyProblem;
  no: number;
  starred: boolean;
  myAnswer?: string;
  from?: string;
  similar?: StudyProblem[];
  tags?: string[]; // 선생님 표시
  right?: boolean; // 맞았지만 어려워한 문제
}) {
  return (
    <li className="card space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{no}</p>
          <p className="text-xs text-ink-faint">{[tag(p), from].filter(Boolean).join(" · ")}</p>
          {tags.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_STYLE[t]?.cls ?? ""}`}>
                  {TAG_STYLE[t]?.icon} 선생님: {t}
                </span>
              ))}
            </p>
          )}
        </div>
        <StarButton id={p.id} starred={starred} />
      </div>
      <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.question) }} />
      {myAnswer !== undefined && (
        <p className="text-sm">
          <span className="text-ink-soft">그때 쓴 답 </span>
          <span className={`font-medium ${right ? "text-good" : "text-bad"}`}>{myAnswer || "(빈칸)"}</span>
          {right && <span className="text-ink-soft"> · 맞았지만 어려워했던 문제예요</span>}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <Retry id={p.id} />
      </div>
      <details className="border-t border-line pt-3 text-sm">
        <summary className="cursor-pointer text-ink-soft">정답·풀이 보기</summary>
        <div className="mt-2 flex gap-2">
          <span className="shrink-0 font-semibold">정답</span>
          <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.answer) }} />
        </div>
        {p.solution && <div className="problem-body mt-1 text-ink-soft" dangerouslySetInnerHTML={{ __html: renderProblemHtml(p.solution) }} />}
      </details>
      {similar.length > 0 && (
        <details className="rounded-xl bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-medium">비슷한 문제 {similar.length}개 풀어 보기</summary>
          <ol className="mt-3 space-y-3">
            {similar.map((s, i) => (
              <li key={s.id} className="space-y-2 rounded-xl border border-line bg-surface p-3">
                <p className="text-xs text-ink-faint">
                  비슷한 문제 {i + 1}
                  {s.difficulty && ` · 난이도 ${s.difficulty}`}
                </p>
                <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(s.question) }} />
                <Retry id={s.id} label="풀어 보기" />
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}
