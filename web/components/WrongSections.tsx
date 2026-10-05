import Link from "next/link";
import { dayLabel } from "@/lib/hwFormat";
import { groupWrong, type WrongView } from "@/lib/wrongGroups";

type Item = { id: string; unit: string; type: string; day: string; hwId: string; hwTitle: string };

/**
 * 오답 목록을 날짜별(날짜 → 숙제) 또는 유형별(단원 → 유형)로 나눠 보여 준다.
 * 위쪽 버튼으로 보기를 바꾸고, 큰 묶음 버튼을 누르면 그 묶음으로 내려간다. 문제 한 장은 card 로 그린다.
 */
export default function WrongSections<T extends Item>({
  items,
  view,
  baseHref,
  card,
}: {
  items: T[];
  view: WrongView;
  baseHref: string;
  card: (item: T, no: number) => React.ReactNode;
}) {
  const groups = groupWrong(items, view);
  const sep = baseHref.includes("?") ? "&" : "?";
  const title = (key: string) => (view === "date" ? dayLabel(key) : key);
  let no = 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="오답 보기 방법">
          {(
            [
              ["date", "날짜별"],
              ["type", "유형별"],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v}
              href={`${baseHref}${sep}view=${v}`}
              role="tab"
              aria-selected={view === v}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${view === v ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <p className="text-sm text-ink-soft">
          {view === "date" ? "숙제를 낸 날짜 → 숙제별로 나눴어요." : "단원 → 유형별로 나누고, 많이 틀린 것부터 보여 줘요."}
        </p>
      </div>

      {groups.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label={view === "date" ? "날짜로 가기" : "단원으로 가기"}>
          {groups.map((g, i) => (
            <a key={g.key} href={`#g${i}`} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-soft hover:text-ink">
              {title(g.key)}
              <span className="ml-1.5 tabular-nums text-ink-faint">{g.list.length}</span>
            </a>
          ))}
        </nav>
      )}

      {groups.map((g, i) => (
        <section key={g.key} id={`g${i}`} className="scroll-mt-24 space-y-4">
          <h2 className="flex items-baseline gap-2 border-b border-line pb-2 text-lg font-bold tracking-tight">
            {title(g.key)}
            <span className="text-sm font-normal text-ink-faint">{g.list.length}문제</span>
          </h2>
          {g.subs.map((s) => (
            <div key={s.key} className="space-y-2">
              <h3 className="flex items-baseline gap-2 px-1 text-sm font-semibold text-ink-soft">
                {view === "date" ? "숙제 · " : "유형 · "}
                <span className="text-ink">{s.title}</span>
                <span className="font-normal text-ink-faint">{s.list.length}문제</span>
              </h3>
              <ol className="space-y-3">{s.list.map((it) => card(it, ++no))}</ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
