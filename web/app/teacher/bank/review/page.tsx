import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow, IconNote } from "@/components/Icons";
import { currentGuide, listItems, listRuns, listSkipped, RUN_SIZES, type Item, type Run } from "@/lib/bankReview";
import { KINDS, type Content } from "@/lib/bankReviewCore";
import { renderProblemHtml } from "@/lib/mathText";
import { missingSchema } from "@/lib/schemaCheck";
import ItemCard, { type ItemView } from "./ItemCard";
import RunPanel, { type RunView } from "./RunPanel";
import UnskipButton from "./UnskipButton";

export const metadata: Metadata = { title: "자동 점검 · 수학클래스룸" };
// '지금 점검'을 누르면 이 화면의 서버 동작이 뒤에서 첫 묶음들을 본다 (이어 가기 주소와 같은 한도)
export const maxDuration = 300;

const when = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

const LABEL = { question: "문제", answer: "정답", solution: "풀이" } as const;

function toView(it: Item): ItemView {
  const after: Content | null = it.after;
  const parts = after
    ? (["question", "answer", "solution"] as const)
        .filter((k) => it.before[k] !== after[k])
        .map((k) => ({ key: k, label: LABEL[k], beforeHtml: it.before[k] ? renderProblemHtml(it.before[k]) : "", afterHtml: after[k] ? renderProblemHtml(after[k]) : "" }))
    : [];
  return {
    itemId: it.itemId,
    problemId: it.problemId,
    mode: it.mode,
    status: it.status,
    kinds: it.kinds.map((k) => KINDS[k]),
    what: it.what,
    where: [it.grade, it.unit, it.type].filter(Boolean).join(" › "),
    when: when(it.createdAt),
    changedSince: it.changedSince,
    parts,
    raw: after ?? it.before,
    hasAfter: !!after,
  };
}

const runView = (r: Run): RunView => ({
  runId: r.runId,
  trigger: r.trigger,
  status: r.status,
  total: r.total,
  pos: r.pos,
  checked: r.checked,
  autoFixed: r.autoFixed,
  queued: r.queued,
  failed: r.failed,
  note: r.note,
  startedAt: when(r.startedAt),
  stale: r.stale,
  guidelineVersion: r.guidelineVersion,
});

/** 문제 은행 자동 점검: 점검 현황, 확인할 것(애매한 수정), 자동으로 고친 것(되돌리기), 지난 점검 */
export default async function BankReviewPage() {
  const missing = await missingSchema().catch(() => [] as string[]);
  if (missing.some((m) => m.includes("점검")))
    return (
      <div className="space-y-4">
        <Back />
        <h1 className="text-2xl font-bold tracking-tight">자동 점검</h1>
        <p className="card text-sm text-ink-soft">자동 점검을 쓰려면 Supabase에서 db/schema.sql 을 한 번 다시 실행해 주세요.</p>
      </div>
    );
  const [guide, runs, pending, auto, skipped] = await Promise.all([currentGuide(), listRuns(8), listItems("pending", 60), listItems("auto", 40), listSkipped()]);
  const latest = runs[0] ?? null;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Back />
          <h1 className="mt-2 text-2xl font-bold tracking-tight">자동 점검</h1>
          <p className="mt-1 text-sm text-ink-soft">
            AI가 선생님의 점검 기준대로 문제 은행을 몇 문제씩 봐요. 확실한 것(
            {guide.autoKinds.map((k) => KINDS[k]).join(", ") || "없음"})은 바로 고치고, 애매한 것은 아래 확인함에 넣어요.
          </p>
        </div>
        <Link href="/teacher/bank/review/guide" className="btn-soft py-2">
          <IconNote />
          점검 기준 {guide.version ? `(${guide.version}번)` : "(처음 기준)"}
        </Link>
      </div>

      <RunPanel run={latest ? runView(latest) : null} sizes={RUN_SIZES} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">확인할 것</h2>
          <span className="text-sm text-ink-soft">{pending.length}개</span>
        </div>
        {!pending.length ? (
          <p className="card text-sm text-ink-soft">확인할 것이 없어요.</p>
        ) : (
          <div className="space-y-3">
            {pending.map((it) => (
              <ItemCard key={it.itemId} it={toView(it)} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">자동으로 고친 것</h2>
          <span className="text-sm text-ink-soft">최근 {auto.length}개 · 눌러서 원래와 비교하고 되돌릴 수 있어요</span>
        </div>
        {!auto.length ? (
          <p className="card text-sm text-ink-soft">아직 자동으로 고친 것이 없어요.</p>
        ) : (
          <div className="space-y-2">
            {auto.map((it) => (
              <ItemCard key={it.itemId} it={toView(it)} />
            ))}
          </div>
        )}
      </section>

      {runs.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">지난 점검</h2>
          <ul className="card divide-y divide-line p-0 text-sm sm:p-0">
            {runs.slice(1).map((r) => (
              <li key={r.runId} className="flex flex-wrap gap-x-3 gap-y-1 px-5 py-2.5">
                <span className="text-ink-faint">{when(r.startedAt)}</span>
                <span>{r.trigger === "cron" ? "매주 자동" : "직접"}</span>
                <span className="text-ink-soft">
                  {r.checked}/{r.total}문제 · 자동 수정 {r.autoFixed} · 확인 {r.queued}
                  {r.failed ? ` · 못 봄 ${r.failed}` : ""}
                </span>
                <span className="ml-auto text-ink-faint">{{ running: r.stale ? "멈춤" : "점검 중", done: "끝", stopped: "멈춤", failed: "실패" }[r.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {skipped.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">건너뛰는 문제</h2>
          <p className="text-sm text-ink-soft">반려하면서 &apos;다음부터 건너뛰기&apos;를 고른 문제예요. 자동 점검에서 보지 않아요.</p>
          <ul className="card divide-y divide-line p-0 text-sm sm:p-0">
            {skipped.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2">
                <Link href={`/teacher/bank/${encodeURIComponent(p.id)}`} className="min-w-0 truncate underline-offset-2 hover:underline">
                  {[p.grade, p.unit, p.type].filter(Boolean).join(" › ") || p.id}
                </Link>
                <UnskipButton problemId={p.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Back() {
  return (
    <Link href="/teacher/bank" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconArrow className="h-4 w-4 rotate-180" />
      문제 은행
    </Link>
  );
}
