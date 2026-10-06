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

/**
 * 선생님이 숙제 문제에 붙이는 표시의 모양: 중요 ★, 어려움 !
 * 저장되는 값은 Streamlit 과 같은 '어려워함'이고 화면에는 '어려움'으로 보인다.
 */
export const TAG_STYLE: Record<string, { icon: string; cls: string; label: string }> = {
  중요: { icon: "★", cls: "bg-warn-soft text-warn", label: "중요" },
  어려워함: { icon: "!", cls: "bg-accent-soft text-accent", label: "어려움" },
};

/** 'YYYY-MM-DD' + n일 */
export function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
