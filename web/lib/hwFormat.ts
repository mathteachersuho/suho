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
