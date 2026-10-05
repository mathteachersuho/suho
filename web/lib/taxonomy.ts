import "server-only";
import type postgres from "postgres";
import { db } from "./db";

export type TaxRow = { grade: string; unit: string; type: string; frame: string; description: string };

export async function listTaxonomy(): Promise<TaxRow[]> {
  const rows = await db()`select grade, unit, type, frame, description from taxonomy order by id`;
  return rows.map((r) => ({ grade: r.grade, unit: r.unit, type: r.type, frame: r.frame, description: r.description }));
}

export async function unitSemesters(): Promise<Record<string, string>> {
  const rows = await db()`select grade, unit, semester from units`;
  return Object.fromEntries(rows.map((r) => [`${r.grade}\u0000${r.unit}`, r.semester as string]));
}

/** 유형표에서 (학년, 단원, 유형, 문제틀)의 번호를 찾고, 없으면 설명과 함께 새로 넣는다. 트랜잭션 안에서 부른다. */
export async function taxonomyId(sql: postgres.TransactionSql, r: TaxRow): Promise<number> {
  const [t] = await sql`
    with ins as (
      insert into taxonomy (grade, unit, type, frame, description)
      values (${r.grade}, ${r.unit}, ${r.type}, ${r.frame}, ${r.description})
      on conflict (grade, unit, type, frame) do nothing returning id)
    select id from ins union all
    select id from taxonomy where grade = ${r.grade} and unit = ${r.unit} and type = ${r.type} and frame = ${r.frame}
    limit 1`;
  return Number(t.id);
}
