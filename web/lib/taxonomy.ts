import "server-only";
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
