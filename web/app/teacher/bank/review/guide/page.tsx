import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow } from "@/components/Icons";
import { currentGuide, guideHistory } from "@/lib/bankReview";
import { DEFAULT_GUIDE, KINDS, NEVER_AUTO } from "@/lib/bankReviewCore";
import GuideEditor from "./GuideEditor";

export const metadata: Metadata = { title: "점검 기준 · 수학클래스룸" };

const when = (d: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

/** 자동 점검 기준: 선생님이 글로 쓰고, 저장할 때마다 버전이 남는다 */
export default async function GuidePage() {
  const [guide, history] = await Promise.all([currentGuide(), guideHistory()]);
  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/teacher/bank/review" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          자동 점검
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">점검 기준</h1>
        <p className="mt-1 text-sm text-ink-soft">
          AI가 문제를 점검할 때 이 글을 그대로 읽고 따라요. 고치지 않아도 되는 것, 손대지 말 것, 그림 모양, 틀린 것으로 볼 것을 편하게 적어 주세요. 저장하면 새
          버전이 되고, 그 뒤 점검부터 적용돼요. 기준을 바꾸면 이미 본 문제도 차례로 새 기준으로 다시 봐요.
        </p>
      </div>
      <GuideEditor
        version={guide.version}
        body={guide.body}
        autoKinds={guide.autoKinds}
        kinds={Object.entries(KINDS).map(([k, label]) => ({ k, label, never: (NEVER_AUTO as string[]).includes(k) }))}
        defaultBody={DEFAULT_GUIDE}
        history={history.map((g) => ({ version: g.version, body: g.body, note: g.note, when: g.createdAt ? when(g.createdAt) : "", autoKinds: g.autoKinds.map((k) => KINDS[k]) }))}
      />
    </div>
  );
}
