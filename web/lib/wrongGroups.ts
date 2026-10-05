/** 오답노트 묶기 (학생·선생님 화면 공용). 순서는 들어온 순서를 지킨다. */

type Item = { id: string; unit: string; type: string; day: string; hwId: string; hwTitle: string };

export type WrongView = "date" | "type";
export const parseView = (v: unknown): WrongView => (v === "type" ? "type" : "date");

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return [...m.entries()];
}

/** 큰 묶음 → 작은 묶음 → 문제. 날짜별: 날짜 → 숙제 / 유형별: 단원 → 유형 (틀린 문제 많은 단원·유형 먼저) */
export function groupWrong<T extends Item>(items: T[], view: WrongView) {
  if (view === "date") {
    return groupBy(items, (x) => x.day).map(([day, list]) => ({
      key: day,
      list,
      subs: groupBy(list, (x) => x.hwId).map(([hwId, l]) => ({ key: hwId, title: l[0].hwTitle, list: l })),
    }));
  }
  const byCount = <U extends { list: unknown[] }>(a: U, b: U) => b.list.length - a.list.length;
  return groupBy(items, (x) => x.unit || "단원 없음")
    .map(([unit, list]) => ({
      key: unit,
      list,
      subs: groupBy(list, (x) => x.type || "유형 없음")
        .map(([type, l]) => ({ key: type, title: type, list: l }))
        .sort(byCount),
    }))
    .sort(byCount);
}
