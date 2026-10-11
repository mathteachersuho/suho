import "server-only";
import { db } from "./db";

/*
 * 앱이 쓰는 표·칸이 DB(Supabase)에 다 있는지 확인한다.
 * 코드는 merge 하면 바로 배포되지만 DB 구조는 선생님이 db/schema.sql 을 다시 실행해야 바뀐다.
 * 빠진 것이 있으면 선생님 화면 위에 'DB를 업데이트해 주세요' 알림을 띄운다.
 * db/schema.sql 에 표나 칸을 더하면 여기에도 더한다.
 */
const NEED: { table: string; column?: string; label: string }[] = [
  { table: "students", label: "학생" },
  { table: "taxonomy", label: "단원·유형 분류" },
  { table: "units", label: "단원" },
  { table: "problem_sets", label: "문제 묶음" },
  { table: "problems", label: "문제 은행" },
  { table: "assignments", label: "유사문제 배정" },
  { table: "stars", label: "중요 문제" },
  { table: "homework", label: "숙제" },
  { table: "homework_students", label: "숙제 받는 학생" },
  { table: "homework_problems", label: "숙제 문제" },
  { table: "hw_results", label: "숙제 결과" },
  { table: "exams", label: "시험 점수" },
  { table: "app_settings", label: "앱 설정" },
  { table: "reports", label: "학부모 리포트 저장" },
  { table: "login_attempts", label: "로그인 잠금" },
  { table: "error_logs", label: "오류 기록" },
  { table: "students", column: "name", label: "학생 이름" },
  { table: "hw_results", column: "reason", label: "틀린 이유" },
];

// 다 있으면 계속 기억하고, 빠졌으면 1분 동안만 기억했다가 다시 본다 (schema.sql 을 실행하면 곧 알림이 사라지게)
let cache: { until: number; missing: string[] } = { until: 0, missing: [] };

/** 빠진 기능 이름들. 다 있으면 빈 배열. */
export async function missingSchema(): Promise<string[]> {
  if (Date.now() < cache.until) return cache.missing;
  const rows = await db()`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name = any(${[...new Set(NEED.map((n) => n.table))]})`;
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const tables = new Set(rows.map((r) => r.table_name as string));
  const missing = NEED.filter((n) => (n.column ? !have.has(`${n.table}.${n.column}`) : !tables.has(n.table)))
    // 표가 통째로 없으면 그 표의 칸은 따로 적지 않는다
    .filter((n) => !n.column || tables.has(n.table))
    .map((n) => n.label);
  cache = { until: missing.length ? Date.now() + 60_000 : Infinity, missing };
  return missing;
}
