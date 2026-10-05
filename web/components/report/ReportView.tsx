import { dayLabel } from "@/lib/hwFormat";
import type { Exam, ReportData } from "@/lib/report";
import ScoreChart from "./ScoreChart";

/**
 * 학부모 리포트 한 장 (A4 한 쪽). 선생님 화면과 학부모 공유 링크(/r/...)가 함께 쓴다.
 * children 에는 문제 분석 · 종합 의견이 들어간다 (선생님은 고쳐 쓰는 칸, 학부모는 글).
 */
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const examPct = (e: Exam) => (e.score !== null && e.maxScore ? pct(e.score, e.maxScore) : null);
const fmt = (n: number | null) => (n === null ? "-" : String(n));
const md = (day: string) => day.slice(5).replace("-", "/");

export default function ReportView({ name, classId, r, children }: { name: string; classId: string; r: ReportData; children: React.ReactNode }) {
  const { from, to } = r;
  const done = r.hw.filter((h) => h.submitted).length;
  const rate = pct(r.right, r.solved);
  // 한 장에 들어가게 숙제는 최근 것만
  const recentHw = r.hw.slice(-8);
  const analyzed = r.exams.filter((e) => e.analysis);
  return (
    <article className="report-page card space-y-6 print:space-y-2.5 print:border-0 print:p-0">
      <header className="border-b-2 border-ink pb-3 print:pb-1.5">
        <p className="text-xs text-ink-faint">수학 학습 리포트</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight print:mt-0 print:text-lg">{name} 학생</h2>
        <p className="mt-0.5 text-sm text-ink-soft">{[classId, `${dayLabel(from)} ~ ${dayLabel(to)}`].filter(Boolean).join(" · ")}</p>
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
            rows={r.weak.map((t) => [`${t.unit} › ${t.type}${t.hard ? ` (어려워함 ${t.hard})` : ""}`, `${t.right}/${t.total}`, `${pct(t.right, t.total)}%`])}
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

      {children}
    </article>
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

/** 다 쓴 의견 (학부모 화면). 비어 있으면 그리지 않는다. */
export function ReportText({ title, value }: { title: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <section className="space-y-2 print:space-y-1">
      <h3 className="report-h">{title}</h3>
      <div className="report-note whitespace-pre-wrap rounded-xl border border-line p-4 leading-relaxed">{value}</div>
    </section>
  );
}
