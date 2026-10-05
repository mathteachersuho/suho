import Link from "next/link";
import { IconCheck } from "@/components/Icons";
import { Row } from "@/components/WrongSections";
import { groupByUnit, MARK_KINDS, matchMarks, type MarkKind } from "@/lib/markedGroups";

type Item = { id: string; grade: string; semester: string; unit: string; mine: boolean; teacher: boolean; hard: boolean };

const ANCHOR = "marked-list";

/**
 * 중요 문제 목록. 위에서 표시 종류(선생님 중요 · 내가 중요 · 어려움)를 체크하면 그 문제만 남고,
 * 아래에 학년-학기 · 단원별 줄이 나와 누르면 문제가 펼쳐진다. keep 은 주소에 함께 남길 다른 값(예: 오답 보기).
 */
export default function MarkedSections<T extends Item>({
  items,
  f,
  baseHref,
  keep = {},
  mineLabel = "내가 중요",
  card,
}: {
  items: T[];
  f: MarkKind[];
  baseHref: string;
  keep?: Record<string, string>;
  mineLabel?: string;
  card: (item: T, no: number) => React.ReactNode;
}) {
  const href = (next: MarkKind[]) => {
    const p = new URLSearchParams(keep);
    if (next.length) p.set("f", next.join(","));
    const q = p.toString();
    return `${baseHref}${q ? `?${q}` : ""}#${ANCHOR}`;
  };
  const shown = matchMarks(items, f);
  const groups = groupByUnit(shown);
  return (
    <div id={ANCHOR} className="scroll-mt-24 space-y-5">
      <div className="space-y-2">
        <p className="px-1 text-sm text-ink-soft">보고 싶은 표시를 체크하세요. 아무것도 체크하지 않으면 모두 보여요.</p>
        <div className="flex flex-wrap gap-2">
          {MARK_KINDS.map((k) => {
            const on = f.includes(k.key);
            const n = items.filter((x) => x[k.key]).length;
            return (
              <Link
                key={k.key}
                href={href(on ? f.filter((x) => x !== k.key) : [...f, k.key])}
                role="checkbox"
                aria-checked={on}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium ${on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:bg-surface-2"}`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-bg bg-bg text-ink" : "border-line"}`}>
                  {on && <IconCheck className="h-3 w-3" />}
                </span>
                {k.icon} {k.key === "mine" ? mineLabel : k.label}
                <span className={`tabular-nums ${on ? "opacity-70" : "text-ink-faint"}`}>{n}</span>
              </Link>
            );
          })}
        </div>
      </div>
      {!groups.length ? (
        <p className="card text-sm text-ink-soft">체크한 표시가 붙은 문제가 없어요.</p>
      ) : (
        groups.map((g) => (
          <section key={g.term} className="space-y-2">
            <h3 className="flex items-baseline gap-2 px-1 text-sm font-semibold text-ink-soft">
              <span className="text-ink">{g.term}</span>
              <span className="font-normal text-ink-faint">{g.units.reduce((a, u) => a + u.list.length, 0)}문제</span>
            </h3>
            {g.units.map((u) => (
              <Row key={u.unit} title={u.unit} count={u.list.length} tone="neutral">
                <ol className="space-y-3">{u.list.map((it, i) => card(it, i + 1))}</ol>
              </Row>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
