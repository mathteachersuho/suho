/** 오답노트 묶기 (학생·선생님 화면 공용). 순서는 들어온 순서를 지킨다. */

type Item = { id: string; grade: string; semester: string; unit: string; type: string; day: string; hwId: string; hwTitle: string };

export type WrongView = "date" | "type";
export type WrongQuery = { view: WrongView; term: string; unit: string };

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
export const parseWrongQuery = (sp: Record<string, string | string[] | undefined>): WrongQuery => ({
  view: sp.view === "type" ? "type" : "date",
  term: str(sp.term),
  unit: str(sp.unit),
});

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return [...m.entries()];
}

/** 학년-학기 이름: 중2 + 1학기 → "중2-1". 학기를 모르거나 공통이면 학년만. */
export function termOf(x: { grade: string; semester: string }) {
  const g = x.grade || "학년 없음";
  const s = x.semester.match(/^([12])학기$/)?.[1];
  return s ? `${g}-${s}` : g;
}

/** 중 → 고 → 그 밖, 학년 숫자, 학기 순 */
function termRank(t: string) {
  const school = t.startsWith("중") ? 0 : t.startsWith("고") ? 1 : 2;
  const [, n = "9", s = "0"] = t.match(/(\d)(?:-(\d))?$/) ?? [];
  return school * 100 + Number(n) * 10 + Number(s);
}

/** 날짜별: 날짜 → 숙제 (최근 먼저) */
export function groupByDate<T extends Item>(items: T[]) {
  return groupBy(items, (x) => x.day).map(([day, list]) => ({
    key: day,
    list,
    subs: groupBy(list, (x) => x.hwId).map(([hwId, l]) => ({ key: hwId, title: l[0].hwTitle, list: l })),
  }));
}

const byCount = <U extends { list: unknown[] }>(a: U, b: U) => b.list.length - a.list.length;

/**
 * 유형별: 학년-학기 → 단원 → 유형. 고른 학년-학기·단원이 없거나 하나뿐이면 알아서 고른다.
 * types 는 고른 단원의 유형들 (많이 틀린 것 먼저).
 */
export function drillByType<T extends Item>(items: T[], q: WrongQuery) {
  const terms = groupBy(items, termOf)
    .map(([key, list]) => ({ key, list }))
    .sort((a, b) => termRank(a.key) - termRank(b.key) || a.key.localeCompare(b.key, "ko"));
  const term = terms.find((t) => t.key === q.term) ?? (terms.length === 1 ? terms[0] : undefined);
  const units = term ? groupBy(term.list, (x) => x.unit || "단원 없음").map(([key, list]) => ({ key, list })).sort(byCount) : [];
  const unit = units.find((u) => u.key === q.unit) ?? (units.length === 1 ? units[0] : undefined);
  const types = unit ? groupBy(unit.list, (x) => x.type || "유형 없음").map(([key, list]) => ({ key, list })).sort(byCount) : [];
  return { terms, term: term?.key ?? "", units, unit: unit?.key ?? "", types };
}
