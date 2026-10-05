/** 마감일 'YYYY-MM-DD' → '10/7까지' */
export function dueLabel(due: string) {
  if (!due) return "";
  const [, m, d] = due.split("-").map(Number);
  return `${m}/${d}까지`;
}

/** 오늘(서울) 'YYYY-MM-DD' */
export function todaySeoul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export const MARK_LABEL: Record<string, string> = { Y: "O", N: "X", "?": "?", "": "" };

/** 'YYYY-MM-DD' → '10월 5일 (일)' */
export function dayLabel(day: string) {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
}

/** 선생님이 숙제 문제에 붙이는 표시의 모양: 중요 ★, 어려워함 ! */
export const TAG_STYLE: Record<string, { icon: string; cls: string }> = {
  중요: { icon: "★", cls: "bg-warn-soft text-warn" },
  어려워함: { icon: "!", cls: "bg-accent-soft text-accent" },
};
