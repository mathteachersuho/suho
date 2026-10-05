import Link from "next/link";
import { IconDown } from "@/components/Icons";
import { dayLabel } from "@/lib/hwFormat";
import { drillByType, groupByDate, type WrongQuery } from "@/lib/wrongGroups";

type Item = { id: string; grade: string; semester: string; unit: string; type: string; day: string; hwId: string; hwTitle: string };

const ANCHOR = "wrong-list";

/**
 * 오답 목록. 날짜별: 날짜 줄을 누르면 그날 숙제별 문제가 펼쳐진다.
 * 유형별: 학년-학기 → 단원을 고르면 틀린 유형이 한 줄씩 나오고, 줄을 누르면 문제가 펼쳐진다.
 * 문제 한 장은 card 로 그린다.
 */
export default function WrongSections<T extends Item>({
  items,
  q,
  baseHref,
  keep = {},
  card,
}: {
  items: T[];
  q: WrongQuery;
  baseHref: string;
  keep?: Record<string, string>; // 주소에 함께 남길 다른 값 (예: 중요 문제 표시 고르기)
  card: (item: T, no: number) => React.ReactNode;
}) {
  const href = (p: Record<string, string>) => `${baseHref}?${new URLSearchParams({ ...keep, ...p })}#${ANCHOR}`;
  return (
    <div id={ANCHOR} className="scroll-mt-24 space-y-5">
      <div className="flex rounded-xl bg-surface-2 p-1 sm:w-fit" role="tablist" aria-label="오답 보기 방법">
        {(
          [
            ["date", "날짜별"],
            ["type", "유형별"],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={href({ view: v })}
            role="tab"
            aria-selected={q.view === v}
            className={`flex-1 rounded-lg px-4 py-1.5 text-center text-sm font-medium sm:flex-none ${q.view === v ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {q.view === "date" ? <ByDate items={items} q={q} href={href} card={card} /> : <ByType items={items} q={q} href={href} card={card} />}
    </div>
  );
}

/**
 * 누르면 펼쳐지는 줄. href 를 주면 주소로 열고 닫는다 (열린 줄의 문제만 그려서 오답이 많아도 화면이 가볍다).
 * href 가 없으면 브라우저 안에서만 펼친다.
 */
export function Row({
  title,
  count,
  sub,
  tone = "bad",
  href,
  open = false,
  children,
}: {
  title: string;
  count: number;
  sub?: string;
  tone?: "bad" | "neutral";
  href?: string; // 누르면 갈 주소 (열려 있으면 닫는 주소)
  open?: boolean;
  children: React.ReactNode;
}) {
  const head = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {sub && <span className="block truncate text-xs text-ink-faint">{sub}</span>}
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${tone === "bad" ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-soft"}`}>{count}</span>
      <IconDown className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : "group-open:rotate-180"}`} />
    </>
  );
  const headCls = "flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3.5 hover:bg-surface-2";
  if (href)
    return (
      <div className={open ? "" : "rounded-2xl border border-line bg-surface"}>
        <Link href={href} scroll={false} aria-expanded={open} className={`${headCls} ${open ? "border border-line bg-surface" : ""}`}>
          {head}
        </Link>
        {open && <div className="space-y-4 pt-3">{children}</div>}
      </div>
    );
  return (
    <details className="group rounded-2xl border border-line bg-surface open:bg-transparent open:border-transparent">
      <summary className={`${headCls} group-open:border group-open:border-line group-open:bg-surface [&::-webkit-details-marker]:hidden`}>{head}</summary>
      <div className="space-y-4 pt-3">{children}</div>
    </details>
  );
}

function ByDate<T extends Item>({
  items,
  q,
  href,
  card,
}: {
  items: T[];
  q: WrongQuery;
  href: (p: Record<string, string>) => string;
  card: (item: T, no: number) => React.ReactNode;
}) {
  const days = groupByDate(items);
  return (
    <div className="space-y-2">
      <p className="px-1 text-sm text-ink-soft">날짜를 누르면 그날 숙제에서 틀린 문제가 나와요.</p>
      {days.map((d) => {
        let no = 0;
        return (
          <Row
            key={d.key}
            title={dayLabel(d.key)}
            count={d.list.length}
            sub={d.subs.map((s) => s.title).join(" · ")}
            open={q.day === d.key}
            href={href(q.day === d.key ? { view: "date" } : { view: "date", day: d.key })}
          >
            {q.day === d.key &&
              d.subs.map((s) => (
              <div key={s.key} className="space-y-2">
                {d.subs.length > 1 && (
                  <h3 className="flex items-baseline gap-2 px-1 text-sm font-semibold text-ink-soft">
                    숙제 · <span className="text-ink">{s.title}</span>
                    <span className="font-normal text-ink-faint">{s.list.length}문제</span>
                  </h3>
                )}
                <ol className="space-y-3">{s.list.map((it) => card(it, ++no))}</ol>
              </div>
            ))}
          </Row>
        );
      })}
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-soft">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-bg">{n}</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function Chips({ list, on, link }: { list: { key: string; list: unknown[] }[]; on: string; link: (key: string) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((x) => (
        <Link
          key={x.key}
          href={link(x.key)}
          aria-current={on === x.key ? "true" : undefined}
          className={`rounded-xl border px-3.5 py-2 text-sm font-medium ${
            on === x.key ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:bg-surface-2"
          }`}
        >
          {x.key}
          <span className={`ml-1.5 tabular-nums ${on === x.key ? "opacity-70" : "text-ink-faint"}`}>{x.list.length}</span>
        </Link>
      ))}
    </div>
  );
}

function ByType<T extends Item>({
  items,
  q,
  href,
  card,
}: {
  items: T[];
  q: WrongQuery;
  href: (p: Record<string, string>) => string;
  card: (item: T, no: number) => React.ReactNode;
}) {
  const d = drillByType(items, q);
  return (
    <div className="space-y-5">
      <Step n={1} label="학년-학기">
        <Chips list={d.terms} on={d.term} link={(term) => href({ view: "type", term })} />
      </Step>
      {d.term && (
        <Step n={2} label="단원">
          <Chips list={d.units} on={d.unit} link={(unit) => href({ view: "type", term: d.term, unit })} />
        </Step>
      )}
      {d.unit && (
        <Step n={3} label="틀린 유형 · 누르면 문제가 나와요">
          <div className="space-y-2">
            {d.types.map((t) => (
              <Row key={t.key} title={t.key} count={t.list.length}>
                <ol className="space-y-3">{t.list.map((it, i) => card(it, i + 1))}</ol>
              </Row>
            ))}
          </div>
        </Step>
      )}
    </div>
  );
}
