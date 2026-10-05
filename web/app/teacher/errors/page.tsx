import type { Metadata } from "next";
import { listErrors, type ErrorRow } from "@/lib/errorLog";
import { listStudents } from "@/lib/students";
import { markSeenAction } from "./actions";

export const metadata: Metadata = { title: "오류 기록 · 수학클래스룸" };

const seoul = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** 휴대폰·컴퓨터·브라우저를 짧게 */
function device(ua: string) {
  if (!ua) return "";
  const os = /iPhone|iPad/.test(ua) ? "아이폰·아이패드" : /Android/.test(ua) ? "안드로이드" : /Windows/.test(ua) ? "윈도우" : /Mac OS/.test(ua) ? "맥" : "";
  const br = /KAKAOTALK/.test(ua) ? "카카오톡" : /NAVER/.test(ua) ? "네이버 앱" : /SamsungBrowser/.test(ua) ? "삼성 인터넷" : /Edg\//.test(ua) ? "엣지" : /Chrome\//.test(ua) ? "크롬" : /Safari\//.test(ua) ? "사파리" : "";
  return [os, br].filter(Boolean).join(" ");
}

/** 같은 곳에서 난 같은 오류는 한 줄로 묶는다 (최근 순) */
function group(rows: ErrorRow[]) {
  const m = new Map<string, ErrorRow[]>();
  for (const r of rows) {
    const k = `${r.source}|${r.place.split("?")[0]}|${r.message}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.values()];
}

export default async function ErrorsPage() {
  const [rows, students] = await Promise.all([listErrors(), listStudents()]);
  const names = new Map(students.map((s) => [s.studentId, s.name || s.studentId]));
  const who = (w: string) => (w === "teacher" ? "선생님" : w ? (names.get(w) ?? w) : "알 수 없음");
  const groups = group(rows);
  const unseen = rows.filter((r) => !r.seen).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Errors</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">오류 기록</h1>
          <p className="mt-1 text-sm text-ink-soft">학생·선생님 화면에서 난 오류가 자동으로 모여요. 60일이 지나면 저절로 지워져요.</p>
        </div>
        {unseen > 0 && (
          <form action={markSeenAction}>
            <button className="btn-soft">새 오류 {unseen}건 모두 확인함</button>
          </form>
        )}
      </div>

      {!groups.length ? (
        <p className="card text-sm text-ink-soft">아직 기록된 오류가 없어요.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => {
            const r = g[0];
            const isNew = g.some((x) => !x.seen);
            const people = [...new Set(g.map((x) => who(x.who)))];
            return (
              <li key={r.id} className={`card space-y-2 ${isNew ? "border-bad/40" : ""}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {isNew && <span className="rounded-md bg-bad-soft px-1.5 py-0.5 font-semibold text-bad">새 오류</span>}
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-soft">{r.source === "browser" ? "브라우저" : "서버"}</span>
                  <span className="text-ink-faint tabular-nums">
                    {seoul(r.at)}
                    {g.length > 1 && ` 외 ${g.length - 1}번 (처음 ${seoul(g[g.length - 1].at)})`}
                  </span>
                </div>
                <p className="break-words font-medium">{r.message || "(내용 없음)"}</p>
                <p className="break-words text-sm text-ink-soft">
                  {r.place}
                  {people.length > 0 && <> · {people.slice(0, 5).join(", ")}{people.length > 5 && ` 외 ${people.length - 5}명`}</>}
                  {device(r.userAgent) && <> · {device(r.userAgent)}</>}
                </p>
                {r.detail && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-faint">자세히 (개발용)</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-ink-soft">{r.detail}</pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
