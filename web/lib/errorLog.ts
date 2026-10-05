import "server-only";
import { db } from "./db";

// 오류를 error_logs 표에 남긴다. 기록이 실패해도 원래 일은 그대로 진행되게 절대 오류를 던지지 않는다.
// 같은 오류가 한꺼번에 쏟아져도 표가 넘치지 않게 1시간에 300건까지만 남기고, 60일 지난 기록은 지운다.

export type ErrorEntry = { source: "server" | "browser"; place: string; message: string; detail?: string; who?: string; userAgent?: string };

const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

export async function logError(e: ErrorEntry) {
  try {
    const sql = db();
    const [r] = await sql`select count(*)::int as n from error_logs where at > now() - interval '1 hour'`;
    if ((r?.n as number) >= 300) return;
    await sql`
      insert into error_logs (source, place, message, detail, who, user_agent)
      values (${e.source}, ${cut(e.place, 300)}, ${cut(e.message, 1000)}, ${cut(e.detail, 4000)}, ${cut(e.who, 60)}, ${cut(e.userAgent, 300)})`;
    if (Math.random() < 0.05) await sql`delete from error_logs where at < now() - interval '60 days'`;
  } catch (err) {
    if (!missingTable(err)) console.error("오류 기록 실패", err);
  }
}

/** 오류 객체를 글로 */
export function describe(err: unknown) {
  // 줄인(minify) 코드에서는 오류 이름이 'i' 같은 글자 하나가 되므로 그럴 땐 이름을 빼고 내용만
  if (err instanceof Error) return { message: err.name.length > 2 && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message, detail: err.stack ?? "" };
  return { message: String(err), detail: "" };
}

export type ErrorRow = { id: number; at: string; source: string; place: string; message: string; detail: string; who: string; userAgent: string; seen: boolean };

/** 선생님 화면: 최근 오류 (없는 표면 빈 목록) */
export async function listErrors(limit = 200): Promise<ErrorRow[]> {
  try {
    const rows = await db()`
      select id, at, source, place, message, detail, who, user_agent, seen from error_logs order by at desc limit ${limit}`;
    return rows.map((r) => ({
      id: Number(r.id),
      at: (r.at as Date).toISOString(),
      source: r.source,
      place: r.place,
      message: r.message,
      detail: r.detail,
      who: r.who,
      userAgent: r.user_agent,
      seen: r.seen,
    }));
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

/** 아직 확인하지 않은 오류 수 (없는 표면 0) */
export async function unseenErrors(): Promise<number> {
  try {
    const [r] = await db()`select count(*)::int as n from error_logs where not seen`;
    return (r?.n as number) ?? 0;
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

export async function markErrorsSeen() {
  await db()`update error_logs set seen = true where not seen`;
}

