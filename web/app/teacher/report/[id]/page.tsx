import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrow } from "@/components/Icons";
import { dayLabel, todaySeoul } from "@/lib/hwFormat";
import { buildReport, listExams, type Exam } from "@/lib/report";
import { getStudent } from "@/lib/students";
import ExamAnalyze from "./ExamAnalyze";
import { DeleteExam, ExamForm } from "./ExamForm";
import ReportNotes from "./ReportNotes";
import ScoreChart from "./ScoreChart";

export const metadata: Metadata = { title: "학부모 리포트 · 수학클래스룸" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const shift = (day: string, days: number) => new Date(Date.parse(day + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const examPct = (e: Exam) => (e.score !== null && e.maxScore ? pct(e.score, e.maxScore) : null);
const fmt = (n: number | null) => (n === null ? "-" : String(n));
const md = (day: string) => day.slice(5).replace("-", "/");

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
  const [r, allExams] = await Promise.all([buildReport(id, from, to), listExams(id)]);
  const base = `/teacher/report/${encodeURIComponent(id)}`;
  const done = r.hw.filter((h) => h.submitted).length;
  const rate = pct(r.right, r.solved);
  // 한 장에 들어가게 숙제는 최근 것만
  const recentHw = r.hw.slice(-8);
  const analyzed = r.exams.filter((e) => e.analysis);

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

      <article className="report-page card space-y-6 print:space-y-2.5 print:border-0 print:p-0">
        <header className="border-b-2 border-ink pb-3 print:pb-1.5">
          <p className="text-xs text-ink-faint">수학 학습 리포트</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight print:mt-0 print:text-lg">{name} 학생</h2>
          <p className="mt-0.5 text-sm text-ink-soft">{[s.classId, `${dayLabel(from)} ~ ${dayLabel(to)}`].filter(Boolean).join(" · ")}</p>
        </header>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
          <Kpi label="낸 숙제" value={`${done}/${r.hw.length}`} />
          <Kpi label="푼 문제" value={String(r.solved)} />
          <Kpi label="숙제 정답률" value={rate === null ? "-" : `${rate}%`} />
          <Kpi label="시험" value={`${r.exams.length}번`} />
        </dl>

        <div className="print:mx-auto print:w-[78%]">
          <ScoreChart
            from={from}
            to={to}
            hw={r.hw.filter((h) => h.submitted && h.right + h.wrong > 0).map((h) => ({ day: h.day, pct: pct(h.right, h.right + h.wrong)!, label: h.title }))}
            exams={r.exams.flatMap((e) => (examPct(e) === null ? [] : [{ day: e.takenOn, pct: examPct(e)!, label: e.name }]))}
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-x-5 print:gap-y-2.5">
          <section className="space-y-2 print:space-y-1">
            <h3 className="report-h">시험 성적</h3>
            <Table
              head={["날짜", "시험", "점수"]}
              rows={r.exams.map((e) => [md(e.takenOn), `${e.kind} ${e.name}`, `${fmt(e.score)} / ${fmt(e.maxScore)}`])}
              empty="기간 안의 시험 기록이 없습니다."
            />
          </section>
          <section className="space-y-2 print:space-y-1">
            <h3 className="report-h">날짜별 숙제</h3>
            <Table
              className="hw-table"
              head={["날짜", "숙제", "맞힌 문제"]}
              rows={recentHw.map((h) => [md(h.day), h.title, h.submitted ? `${h.right} / ${h.total}` : "안 냄"])}
              empty="기간 안의 숙제가 없습니다."
            />
            {r.hw.length > 6 && (
              <p className="text-xs text-ink-faint">
                <span className="print:hidden">최근 {recentHw.length}개만 보여요</span>
                <span className="hidden print:inline">최근 6개만 실었어요</span> (전체 {r.hw.length}개)
              </p>
            )}
          </section>
          <section className="space-y-2 print:space-y-1">
            <h3 className="report-h">단원별 정답률</h3>
            <Table
              head={["단원", "맞힌/푼", "정답률"]}
              rows={r.units.map((u) => [u.unit, `${u.right}/${u.total}`, `${pct(u.right, u.total)}%`])}
              empty="채점된 문제가 없습니다."
            />
          </section>
          <section className="space-y-2 print:space-y-1">
            <h3 className="report-h">보완이 필요한 유형</h3>
            <Table
              head={["유형", "맞힌/푼", "정답률"]}
              rows={r.weak.map((t) => [`${t.unit} › ${t.type}`, `${t.right}/${t.total}`, `${pct(t.right, t.total)}%`])}
              empty="뚜렷하게 약한 유형이 없습니다."
            />
          </section>
        </div>

        {analyzed.length > 0 && (
          <section className="space-y-2 print:space-y-1">
            <h3 className="report-h">시험지 분석</h3>
            <ul className="space-y-2 text-sm print:space-y-1">
              {analyzed.map((e) => {
                const a = e.analysis!;
                const bad = a.problems.filter((p) => p.result === "틀림");
                return (
                  <li key={e.id} className="space-y-0.5">
                    <p>
                      <span className="font-semibold">
                        {e.kind} {e.name}
                      </span>
                      <span className="text-ink-soft">
                        {" "}
                        · {fmt(e.score)}/{fmt(e.maxScore)} · {a.problems.length}문항 중 {a.problems.length - bad.length}개 맞음
                      </span>
                    </p>
                    {bad.length > 0 && (
                      <p>
                        <span className="text-bad">틀린 문항 </span>
                        {bad.map((p) => `${p.no}번(${p.type || p.unit})`).join(", ")}
                      </p>
                    )}
                    {a.summary && <p className="line-clamp-3 text-ink-soft">{a.summary}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <ReportNotes studentId={id} from={from} to={to} />
      </article>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Table({ head, rows, empty, className = "" }: { head: string[]; rows: string[][]; empty: string; className?: string }) {
  if (!rows.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-faint">
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="py-2 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {row.map((c, j) => (
                <td key={j} className={`py-2 pr-3 ${j === 0 ? "whitespace-nowrap tabular-nums text-ink-soft" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
