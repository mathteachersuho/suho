import Link from "next/link";
import ProblemCard from "@/components/ProblemCard";
import { IconBook, IconSparkle } from "@/components/Icons";
import { bankOutline, PAGE_SIZE, searchProblems, type BankFilter } from "@/lib/problems";
import { DIFFICULTIES } from "@/lib/difficulty";
import BankFilters from "./BankFilters";
import { AddAllButton, CartBar, CartToggle } from "./CartControls";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined, max = 60) => (Array.isArray(v) ? v[0] : v || "").trim().slice(0, max);

export default async function BankPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const diff = one(sp.difficulty);
  const f: Required<BankFilter> = {
    grade: one(sp.grade),
    unit: one(sp.unit),
    type: one(sp.type),
    difficulty: (DIFFICULTIES as readonly string[]).includes(diff) ? diff : "",
    q: one(sp.q, 100),
    verified: one(sp.verified) === "1",
  };
  const page = Math.max(1, Math.min(10000, Number.parseInt(one(sp.page), 10) || 1));
  const [{ items, total }, outline] = await Promise.all([searchProblems(f, page), bankOutline()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.values(f).some(Boolean);

  const pageHref = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v === true ? "1" : String(v));
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    return "/teacher/bank" + (s ? "?" + s : "");
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Problem bank</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">문제 은행</h1>
          <p className="mt-1 text-sm text-ink-soft">문제를 골라 담은 뒤 아래 막대에서 학습지를 만들어 인쇄하세요.</p>
        </div>
        <Link href="/teacher/create" className="btn-soft py-2">
          <IconSparkle />
          문제 만들기
        </Link>
      </div>

      <BankFilters key={pageHref(1)} outline={outline} current={f} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {filtered ? "찾은 문제" : "전체 문제"} <b className="font-semibold text-ink tabular-nums">{total.toLocaleString()}</b>개
          {pages > 1 && (
            <span className="text-ink-faint">
              {" "}
              · {page}/{pages}쪽
            </span>
          )}
        </p>
        {items.length > 0 && <AddAllButton ids={items.map((p) => p.id)} />}
      </div>

      {items.length === 0 && total > 0 ? (
        <div className="card py-10 text-center">
          <p className="font-semibold">이 쪽에는 문제가 없어요</p>
          <Link href={pageHref(1)} className="btn-soft mt-3">
            첫 쪽으로
          </Link>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-soft">
            <IconBook className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">{filtered ? "조건에 맞는 문제가 없어요" : "아직 저장된 문제가 없어요"}</p>
          <p className="text-sm text-ink-soft">
            {filtered ? "고른 조건을 줄여 보세요." : "문제 만들기에서 사진으로 문제를 만들어 저장하면 여기에 나타나요."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p, i) => (
            <ProblemCard key={p.id} p={p} no={(page - 1) * PAGE_SIZE + i + 1} action={<CartToggle id={p.id} />} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="쪽 넘기기">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-soft py-2">
              이전
            </Link>
          ) : (
            <span className="btn-soft pointer-events-none py-2 opacity-40">이전</span>
          )}
          <span className="px-2 text-sm text-ink-soft tabular-nums">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="btn-soft py-2">
              다음
            </Link>
          ) : (
            <span className="btn-soft pointer-events-none py-2 opacity-40">다음</span>
          )}
        </nav>
      )}

      <CartBar />
    </div>
  );
}
