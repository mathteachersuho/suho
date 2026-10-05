import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PrintButton from "@/components/report/PrintButton";
import ReportView, { ReportText } from "@/components/report/ReportView";
import { buildReport } from "@/lib/report";
import { getSharedReport } from "@/lib/savedReports";
import { getStudent } from "@/lib/students";

/**
 * 학부모님이 보는 리포트 (로그인 없음). 주소의 무작위 토큰이 맞는 리포트 하나만 보여 준다.
 * 선생님이 링크를 끄거나 새로 만들면 예전 주소는 404.
 */
export const metadata: Metadata = {
  title: "수학 학습 리포트",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedReport({ params }: PageProps<"/r/[token]">) {
  const saved = await getSharedReport((await params).token);
  if (!saved) notFound();
  const s = await getStudent(saved.studentId);
  if (!s) notFound();
  const r = await buildReport(saved.studentId, saved.from, saved.to);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-ink-soft">선생님이 보내 드린 학습 리포트예요.</p>
        <PrintButton />
      </div>
      <ReportView name={s.name || s.studentId} classId={s.classId} r={r}>
        <ReportText title="문제 분석" value={saved.analysis} />
        <ReportText title="선생님 종합 의견" value={saved.comment} />
      </ReportView>
    </main>
  );
}
