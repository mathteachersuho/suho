import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrow, IconChart, IconSparkle } from "@/components/Icons";
import MarkedSections from "@/components/MarkedSections";
import WrongSections from "@/components/WrongSections";
import { dayLabel, TAG_STYLE } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import { getStudent } from "@/lib/students";
import { parseMarkFilter, parseMarkOpen } from "@/lib/markedGroups";
import { homeworkProgress, markedProblems, typeStats, wrongNotes, type MarkedItem, type WrongItem } from "@/lib/study";
import { parseWrongQuery } from "@/lib/wrongGroups";
import { isDue, reviewLabel, reviewStates } from "@/lib/review";

export const metadata: Metadata = { title: "학생 기록 · 수학클래스룸" };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export default async function StudentRecord({ params, searchParams }: PageProps<"/teacher/students/[id]">) {
  const id = decodeURIComponent((await params).id).slice(0, 40);
  const sp = await searchParams;
  const q = parseWrongQuery(sp);
  const f = parseMarkFilter(sp);
  // 두 목록이 서로의 고른 값을 지우지 않게 주소에 함께 남긴다
  const keepWrong: Record<string, string> = { view: q.view, ...(q.term && { term: q.term }), ...(q.unit && { unit: q.unit }), ...(q.day && { day: q.day }) };
  const openUnit = parseMarkOpen(sp);
  const keepMarks: Record<string, string> = { ...(f.length ? { f: f.join(",") } : {}), ...(openUnit && { u: openUnit }) };
  const s = await getStudent(id);
  if (!s) notFound();
  const [stats, wrong, hw, marked, reviews] = await Promise.all([
    typeStats(id),
    wrongNotes(id, false),
    homeworkProgress(id),
    markedProblems(id),
    reviewStates([id]).then((m) => m.get(id) ?? []),
  ]);
  const reviewOf = (unit: string, type: string) => reviews.find((r) => r.unit === unit && r.type === type);
  const dueCount = reviews.filter((r) => isDue(r)).length;
  const graded = stats.reduce((a, t) => a + t.right + t.wrong, 0);
  const right = stats.reduce((a, t) => a + t.right, 0);
  const weak = stats.filter((t) => t.wrong > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teacher" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          학생 관리
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{s.name || s.studentId}</h1>
            <p className="text-sm text-ink-faint">{[s.classId, `@${s.studentId}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/teacher/homework/weak?s=${encodeURIComponent(id)}`} className="btn-soft px-3 py-2">
              <IconSparkle />
              약한 유형 숙제
            </Link>
            <Link href={`/teacher/report/${encodeURIComponent(id)}`} className="btn-soft px-3 py-2">
              <IconChart />
              학부모 리포트
            </Link>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Stat label="낸 숙제" value={`${hw.done}/${hw.given}`} />
        <Stat label="정답률" value={pct(right, graded) === null ? "－" : `${pct(right, graded)}%`} />
        <Stat label="틀림·어려움" value={String(wrong.length)} />
      </dl>

      <section className="card">
        <h2 className="text-base font-semibold">유형별 결과</h2>
        <p className="mt-0.5 text-sm text-ink-soft">숙제에서 푼 문제를 단원·유형으로 묶었어요. 틀린 문제가 많은 유형이 위에 있어요.</p>
        {!stats.length ? (
          <p className="mt-4 text-sm text-ink-soft">아직 낸 숙제가 없어요.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">단원</th>
                  <th className="py-2 pr-3 font-medium">유형</th>
                  <th className="py-2 pr-3 text-right font-medium">푼 문제</th>
                  <th className="py-2 pr-3 text-right font-medium">틀림</th>
                  <th className="py-2 pr-3 text-right font-medium">어려움</th>
                  <th className="py-2 pr-3 font-medium">정답률</th>
                  <th className="py-2 font-medium">복습</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((t) => {
                  const r = pct(t.right, t.right + t.wrong);
                  const rv = reviewOf(t.unit, t.type);
                  return (
                    <tr key={t.unit + "/" + t.type} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 text-ink-soft">{t.unit || "-"}</td>
                      <td className="py-2 pr-3 font-medium">{t.type || "-"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.total}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${t.wrong ? "font-semibold text-bad" : "text-ink-faint"}`}>{t.wrong}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${t.hard ? "font-semibold text-accent" : "text-ink-faint"}`}>{t.hard}</td>
                      <td className="py-2 pr-3">
                        {r === null ? (
                          <span className="text-ink-faint">채점 전</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                              <span className={`block h-full ${r < 50 ? "bg-bad" : r < 80 ? "bg-warn" : "bg-good"}`} style={{ width: `${r}%` }} />
                            </span>
                            <span className="tabular-nums">{r}%</span>
                          </span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap py-2 text-xs ${rv && isDue(rv) ? "font-semibold text-bad" : rv?.done ? "text-good" : "text-ink-soft"}`}>
                        {rv ? reviewLabel(rv) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {dueCount > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-bad">오늘 복습할 유형 {dueCount}개</span>
            <Link href={`/teacher/homework/weak?s=${encodeURIComponent(id)}`} className="text-accent underline">
              약한 유형 숙제로 내기
            </Link>
          </p>
        )}
        {weak.length > 0 && (
          <p className="mt-3 text-sm">
            <span className="text-ink-soft">많이 틀린 유형 </span>
            {weak
              .slice(0, 3)
              .map((t) => t.type || t.unit)
              .join(", ")}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">틀린 문제 · 어려운 문제</h2>
        {!wrong.length ? (
          <p className="card text-sm text-ink-soft">숙제에서 틀린 문제가 없어요.</p>
        ) : (
          <WrongSections
            items={wrong}
            q={q}
            baseHref={`/teacher/students/${encodeURIComponent(id)}`}
            keep={keepMarks}
            card={(it, no) => <WrongCard key={it.id} it={it} no={no} meta={q.view === "date" ? it.type : `${dayLabel(it.day)} ${it.hwTitle}`} />}
          />
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">중요 문제</h2>
          <p className="mt-0.5 text-sm text-ink-soft">선생님이 숙제에서 중요·어려움으로 표시한 문제와 학생이 직접 중요 표시한 문제예요. 학생 화면의 중요 문제와 같아요.</p>
        </div>
        {!marked.length ? (
          <p className="card text-sm text-ink-soft">표시한 문제가 없어요.</p>
        ) : (
          <MarkedSections
            items={marked}
            f={f}
            open={openUnit}
            baseHref={`/teacher/students/${encodeURIComponent(id)}`}
            keep={keepWrong}
            mineLabel="학생이 중요"
            card={(it, no) => <MarkedCard key={it.id} it={it} no={no} />}
          />
        )}
      </section>
    </div>
  );
}

function MarkedCard({ it, no }: { it: MarkedItem; no: number }) {
  const tags = [it.teacher && "중요", it.hard && "어려워함"].filter((t): t is string => !!t);
  return (
    <li className="card space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{no}</p>
          <p className="text-xs text-ink-faint">{[it.type, it.frame, it.difficulty && `난이도 ${it.difficulty}`].filter(Boolean).join(" · ")}</p>
          <p className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_STYLE[t].cls}`}>
                {TAG_STYLE[t].icon} {TAG_STYLE[t].label}
              </span>
            ))}
            {it.mine && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-soft">☆ 학생이 중요</span>}
          </p>
        </div>
        <Link href={`/teacher/bank/${encodeURIComponent(it.id)}`} className="btn-soft shrink-0 px-2.5 py-1.5 text-sm">
          문제 고치기
        </Link>
      </div>
      <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(it.question) }} />
      <div className="flex gap-1.5 border-t border-line pt-3 text-sm">
        <span className="shrink-0 text-ink-soft">정답</span>
        <div className="problem-body font-medium" dangerouslySetInnerHTML={{ __html: renderProblemHtml(it.answer) }} />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function WrongCard({ it, no, meta }: { it: WrongItem; no: number; meta: string }) {
  return (
    <li className="card space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{no}</p>
          <p className="text-xs text-ink-faint">{[meta, it.frame, it.difficulty && `난이도 ${it.difficulty}`, it.starred && "학생이 중요 표시"].filter(Boolean).join(" · ")}</p>
          {it.tags.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {it.tags.map((t) => (
                <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_STYLE[t]?.cls ?? ""}`}>
                  {TAG_STYLE[t]?.icon} {TAG_STYLE[t]?.label ?? t}
                </span>
              ))}
            </p>
          )}
        </div>
        <Link href={`/teacher/bank/${encodeURIComponent(it.id)}`} className="btn-soft shrink-0 px-2.5 py-1.5 text-sm">
          문제 고치기
        </Link>
      </div>
      <div className="problem-body" dangerouslySetInnerHTML={{ __html: renderProblemHtml(it.question) }} />
      <div className="grid gap-1 border-t border-line pt-3 text-sm sm:grid-cols-2">
        <p>
          <span className="text-ink-soft">학생 답 </span>
          <span className={`font-medium ${it.wrong ? "text-bad" : "text-good"}`}>{it.myAnswer || "(빈칸)"}</span>
          {!it.wrong && <span className="text-ink-soft"> · 맞음</span>}
        </p>
        <div className="flex gap-1.5">
          <span className="shrink-0 text-ink-soft">정답</span>
          <div className="problem-body font-medium" dangerouslySetInnerHTML={{ __html: renderProblemHtml(it.answer) }} />
        </div>
      </div>
    </li>
  );
}
