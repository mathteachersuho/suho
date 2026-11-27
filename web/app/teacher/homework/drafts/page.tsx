import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow } from "@/components/Icons";
import { listDrafts, type Draft } from "@/lib/hwDraft";
import { addDays, todaySeoul } from "@/lib/hwFormat";
import { renderProblemHtml } from "@/lib/mathText";
import { problemIssues } from "@/lib/problemCheck";
import { dueStudents } from "@/lib/review";
import { listStudents } from "@/lib/students";
import { missingSchema } from "@/lib/schemaCheck";
import DraftCard, { type DraftView } from "./DraftCard";
import DraftMaker from "./DraftMaker";
import DecidedList from "./DecidedList";

export const metadata: Metadata = { title: "숙제 초안 · 수학클래스룸" };
// AI로 채우기가 문제 4개를 동시에 만드는 동안 기다린다 (문제 만들기 화면과 같은 한도)
export const maxDuration = 120;

function toView(d: Draft): DraftView {
  return {
    draftId: d.draftId,
    studentId: d.studentId,
    name: d.name || d.studentId,
    classId: d.classId,
    title: d.title,
    dueDate: d.dueDate,
    memo: d.memo,
    short: d.short.reduce((a, s) => a + s.need, 0),
    shortTypes: d.short.map((s) => `${s.type} ${s.need}`),
    createdAt: d.createdAt.toISOString(),
    items: d.items.map((q) => ({
      id: q.id,
      tag: [q.type, q.frame, q.verified && "검수"].filter(Boolean).join(" · "),
      difficulty: q.difficulty,
      html: renderProblemHtml(q.question),
      answerHtml: q.answer ? renderProblemHtml(q.answer) : "",
      solutionHtml: q.solution ? renderProblemHtml(q.solution) : "",
      madeByAi: q.madeByAi,
      verified: q.verified,
      // AI가 만든 문제: 저장 전 점검에서 고치지 못한 실수가 남아 있으면 알려 준다
      warnings: q.madeByAi && !q.verified ? problemIssues(q).map((w) => w.split(".")[0]) : [],
    })),
  };
}

/** 숙제 초안: 학생마다 약한 유형으로 만든 숙제 초안을 검토해서 승인한 것만 숙제로 낸다 */
export default async function DraftsPage() {
  const missing = await missingSchema().catch(() => [] as string[]);
  if (missing.includes("숙제 초안") || missing.includes("숙제 초안 문제"))
    return (
      <div className="space-y-4">
        <Back />
        <h1 className="text-2xl font-bold tracking-tight">숙제 초안</h1>
        <p className="card text-sm text-ink-soft">숙제 초안을 쓰려면 Supabase에서 db/schema.sql 을 한 번 다시 실행해 주세요.</p>
      </div>
    );
  const today = todaySeoul();
  const [pending, decided, students, due] = await Promise.all([listDrafts(true), listDrafts(false, 30), listStudents(), dueStudents()]);
  const md = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`;
  return (
    <div className="space-y-6 pb-10">
      <div>
        <Back />
        <h1 className="mt-2 text-2xl font-bold tracking-tight">숙제 초안</h1>
        <p className="mt-1 text-sm text-ink-soft">
          학생마다 틀렸거나 어려워한 유형으로 숙제 초안을 한꺼번에 만들어요. 초안은 학생에게 보이지 않고, 선생님이 승인한 초안만 숙제로 나가요.
        </p>
      </div>

      <DraftMaker
        students={students.map((s) => ({ studentId: s.studentId, name: s.name, classId: s.classId }))}
        dueIds={[...due.keys()]}
        pendingIds={pending.map((d) => d.studentId)}
        defaultTitle={`${md} 약한 유형 숙제`}
        defaultDue={addDays(today, 2)}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">검토할 초안</h2>
          <span className="text-sm text-ink-soft">{pending.length}명</span>
        </div>
        {!pending.length ? (
          <p className="card text-sm text-ink-soft">검토할 초안이 없어요. 위에서 학생을 골라 초안을 만들어 주세요.</p>
        ) : (
          <div className="space-y-3">
            {pending.map((d) => (
              <DraftCard key={d.draftId} d={toView(d)} />
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <DecidedList
          items={decided.map((d) => ({
            draftId: d.draftId,
            name: d.name || d.studentId,
            title: d.title,
            status: d.status,
            hwId: d.hwId,
            decidedAt: d.decidedAt ? d.decidedAt.toISOString() : "",
          }))}
        />
      )}
    </div>
  );
}

function Back() {
  return (
    <Link href="/teacher/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconArrow className="h-4 w-4 rotate-180" />
      숙제 목록
    </Link>
  );
}
