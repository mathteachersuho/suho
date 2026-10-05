import "server-only";
import postgres from "postgres";

// Supabase 연결 주소는 서버 환경변수(DATABASE_URL)에만 둔다. 화면(브라우저)에는 절대 보내지 않는다.
// 트랜잭션 풀러(포트 6543)는 prepared statement를 지원하지 않으므로 prepare: false.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  return postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
}

export function db() {
  if (!globalForDb.sql) globalForDb.sql = connect();
  return globalForDb.sql;
}
