/** 중요 문제 묶기 (학생·선생님 화면 공용): 표시 종류로 고르고, 학년-학기 → 단원으로 나눈다. */
import { termOf, termRank } from "./wrongGroups";

type Item = { grade: string; semester: string; unit: string; mine: boolean; teacher: boolean; hard: boolean };

export const MARK_KINDS = [
  { key: "teacher", label: "선생님 중요", icon: "★" },
  { key: "mine", label: "내가 중요", icon: "☆" },
  { key: "hard", label: "어려움", icon: "!" },
] as const;
export type MarkKind = (typeof MARK_KINDS)[number]["key"];

/** ?f=teacher,hard → ["teacher", "hard"]. 아무것도 안 고르면 전부. */
export function parseMarkFilter(sp: Record<string, string | string[] | undefined>): MarkKind[] {
  const raw = typeof sp.f === "string" ? sp.f.split(",") : [];
  return MARK_KINDS.map((k) => k.key).filter((k) => raw.includes(k));
}

/** ?u=중2-1|일차함수 → 펼친 단원 줄 */
export const parseMarkOpen = (sp: Record<string, string | string[] | undefined>) => (typeof sp.u === "string" ? sp.u.slice(0, 120) : "");
export const unitKey = (term: string, unit: string) => `${term}|${unit}`;

/** 고른 표시 중 하나라도 있는 문제 (아무것도 안 골랐으면 전부) */
export const matchMarks = <T extends Item>(items: T[], f: MarkKind[]) => (f.length ? items.filter((x) => f.some((k) => x[k])) : items);

/** 학년-학기 → 단원 (학년-학기는 중 → 고 순, 단원은 문제 많은 순) */
export function groupByUnit<T extends Item>(items: T[]) {
  const terms = new Map<string, Map<string, T[]>>();
  for (const x of items) {
    const t = termOf(x);
    const u = x.unit || "단원 없음";
    if (!terms.has(t)) terms.set(t, new Map());
    const m = terms.get(t)!;
    if (!m.has(u)) m.set(u, []);
    m.get(u)!.push(x);
  }
  return [...terms.entries()]
    .sort(([a], [b]) => termRank(a) - termRank(b) || a.localeCompare(b, "ko"))
    .map(([term, m]) => ({
      term,
      units: [...m.entries()].map(([unit, list]) => ({ unit, list })).sort((a, b) => b.list.length - a.list.length),
    }));
}
