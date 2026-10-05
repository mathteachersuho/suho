import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrow } from "@/components/Icons";
import ReportView from "@/components/report/ReportView";
import { dayLabel, todaySeoul } from "@/lib/hwFormat";
import { buildReport, listExams } from "@/lib/report";
import { getSavedReport, listSavedReports } from "@/lib/savedReports";
import { getStudent } from "@/lib/students";
import ExamAnalyze from "./ExamAnalyze";
import { DeleteExam, ExamForm } from "./ExamForm";
import ReportNotes from "./ReportNotes";

export const metadata: Metadata = { title: "학부모 리포트 · 수학클래스룸" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (day: string, days: number) => new Date(Date.parse(day + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number | null) => (n === null ? "-" : String(n));

export default async function ParentReport({ params, searchParams }: PageProps<"/teacher/report/[id]">) {
  const id = decodeURIComponent((await params).id).slice(0, 40);
  const sp = await searchParams;
  const today = todaySeoul();
  const pick = (v: unknown) => (typeof v === "string" && DAY.test(v) && !isNaN(Date.parse(v)) ? v : "");
  let to = pick(sp.to) || today;
  let from = pick(sp.from) || shift(to, -30);
  if (from > to) [from, to] = [to, from];

  const s = await getStudent(id);
  if (!s) notFound();
  const name = s.name || s.studentId;
  const [r, allExams, saved, savedList] = await Promise.all([buildReport(id, from, to), listExams(id), getSavedReport(id, from, to), listSavedReports(id)]);
  const base = `/teacher/report/${encodeURIComponent(id)}`;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href="/teacher/report" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          리포트
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{name} 학부모 리포트</h1>
        <p className="text-sm text-ink-faint">{[s.classId, `@${s.studentId}`].filter(Boolean).join(" · ")}</p>
      </div>

      <section className="card space-y-4 print:hidden">
        <div>
          <h2 className="text-base font-semibold">시험 점수</h2>
          <p className="mt-0.5 text-sm text-ink-soft">학교·학원 시험 점수를 넣으면 리포트의 시험 성적과 그래프에 들어가요. 채점된 시험지 사진을 올리면 문항마다 맞음·틀림과 유형을 분석해요.</p>
        </div>
        <ExamForm studentId={id} today={today} />
        {allExams.length > 0 && (
          <ul className="divide-y divide-line border-t border-line text-sm">
            {allExams.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="w-24 shrink-0 tabular-nums text-ink-soft">{e.takenOn}</span>
                <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-soft">{e.kind}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  {e.memo && <span className="text-ink-faint"> · {e.memo}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {fmt(e.score)}
                  <span className="font-normal text-ink-faint">/{fmt(e.maxScore)}</span>
                </span>
                <DeleteExam studentId={id} id={e.id} name={e.name} />
                <ExamAnalyze studentId={id} examId={e.id} initial={e.analysis} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="card flex flex-wrap items-end gap-3 print:hidden" action={base}>
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">시작</span>
          <input type="date" name="from" defaultValue={from} className="field py-2" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-ink-soft">끝</span>
          <input type="date" name="to" defaultValue={to} className="field py-2" />
        </label>
        <button className="btn-main">기간 바꾸기</button>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["최근 1달", 30],
            ["3달", 91],
            ["6달", 182],
          ].map(([label, days]) => (
            <Link key={label} href={`${base}?from=${shift(today, -Number(days))}&to=${today}`} className="btn-soft px-3 py-2">
              {label}
            </Link>
          ))}
        </div>
      </form>

      {savedList.length > 0 && (
        <section className="card space-y-2 print:hidden">
          <h2 className="text-base font-semibold">저장한 리포트</h2>
          <ul className="divide-y divide-line text-sm">
            {savedList.map((x) => {
              const on = x.from === from && x.to === to;
              return (
                <li key={x.id}>
                  <Link
                    href={`${base}?from=${x.from}&to=${x.to}`}
                    aria-current={on ? "true" : undefined}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-surface-2 ${on ? "bg-surface-2 font-semibold" : ""}`}
                  >
                    <span className="min-w-0 flex-1">
                      {dayLabel(x.from)} ~ {dayLabel(x.to)}
                    </span>
                    {x.shareToken && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">링크 공유 중</span>}
                    <span className="text-xs font-normal tabular-nums text-ink-faint">{x.updatedAt} 저장</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ReportView name={name} classId={s.classId} r={r}>
        <ReportNotes key={`${from}~${to}`} studentId={id} from={from} to={to} saved={saved} />
      </ReportView>
    </div>
  );
}
