import "server-only";
import { db } from "./db";
import { describe, logError } from "./errorLog";

/**
 * 전체 백업: 모든 표를 JSON 하나로 (gzip 압축해서 내려받는다).
 * 한 트랜잭션(같은 시점의 모습)에서 500줄씩 읽어 바로 흘려보내므로 데이터가 많아도 메모리·응답 크기 한도에 걸리지 않는다.
 * 표 순서는 되살릴 때 넣는 순서(참조하는 표가 뒤).
 */
export const TABLES = [
  ["students", "학생"],
  ["taxonomy", "유형표"],
  ["units", "단원 학기"],
  ["problem_sets", "문제 묶음"],
  ["problems", "문제"],
  ["assignments", "배정한 문제 (예전 앱)"],
  ["stars", "중요 문제"],
  ["homework", "숙제"],
  ["homework_students", "숙제 받은 학생"],
  ["homework_problems", "숙제 문제"],
  ["hw_results", "숙제 결과"],
  ["exams", "시험 점수"],
  ["reports", "저장한 리포트"],
  ["app_settings", "앱 설정"],
] as const;

const LAST = "last_backup_at";

/** 표마다 줄 수. 없는 표(예: 아직 SQL을 안 돌린 표)는 null. */
export async function backupCounts() {
  const sql = db();
  const exist = new Set(
    (
      await sql`select table_name from information_schema.tables where table_schema = 'public'`
    ).map((r) => r.table_name as string),
  );
  const out: { table: string; label: string; count: number | null }[] = [];
  for (const [table, label] of TABLES) {
    const n = exist.has(table)
      ? Number(
          (await sql.unsafe(`select count(*)::int as n from ${table}`))[0].n,
        )
      : null;
    out.push({ table, label, count: n });
  }
  return out;
}

export async function lastBackupAt(): Promise<string | null> {
  const [r] = await db()`select value from app_settings where key = ${LAST}`;
  return r?.value || null;
}

/** 마지막 백업 시각과 며칠 지났는지 (안 받았으면 null) */
export async function backupAge() {
  const at = await lastBackupAt();
  return { at, days: at ? Math.floor((Date.now() - Date.parse(at)) / 86_400_000) : null };
}

/** 위쪽 메뉴의 '백업'에 점을 찍을지: 학생이 있는데 일주일 넘게(또는 한 번도) 백업을 안 받았으면 */
export async function backupDue() {
  const [{ days }, [row]] = await Promise.all([backupAge(), db()`select exists (select 1 from students) as any`]);
  return !!row?.any && (days === null || days >= 7);
}

async function markBackup(at: string) {
  await db()`
    insert into app_settings (key, value) values (${LAST}, ${at})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

/** 백업 JSON 을 조금씩 흘려보내는 스트림 (압축 전). 중간에 실패하면 스트림이 오류로 끝나 받은 파일이 깨진 채 남지 않는다. */
export function backupStream(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const at = new Date().toISOString();
  return new ReadableStream({
    async start(ctl) {
      const put = (s: string) => ctl.enqueue(enc.encode(s));
      try {
        const counts: Record<string, number> = {};
        put(
          `{"app":"suho","version":1,"exported_at":${JSON.stringify(at)},"tables":{`,
        );
        await db().begin(
          "isolation level repeatable read read only",
          async (sql) => {
            const exist = new Set(
              (
                await sql`select table_name from information_schema.tables where table_schema = 'public'`
              ).map((r) => r.table_name as string),
            );
            let firstTable = true;
            for (const [table] of TABLES) {
              if (!exist.has(table)) continue;
              put(`${firstTable ? "" : ","}${JSON.stringify(table)}:[`);
              firstTable = false;
              let n = 0;
              await sql.unsafe(`select * from ${table}`).cursor(500, (rows) => {
                for (const r of rows)
                  put(`${n++ ? "," : ""}\n${JSON.stringify(r)}`);
              });
              counts[table] = n;
              put("]");
            }
          },
        );
        put(`},"counts":${JSON.stringify(counts)},"complete":true}\n`);
        await markBackup(at);
        ctl.close();
      } catch (e) {
        console.error("백업 오류", e);
        await logError({ source: "server", place: "전체 백업", ...describe(e), who: "teacher" });
        ctl.error(e);
      }
    },
  });
}
