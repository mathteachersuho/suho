import "server-only";
import type postgres from "postgres";
import { db } from "./db";
import { taxonomyId } from "./taxonomy";

export type FrameRow = { frame: string; description: string; n: number };
export type TypeGroup = { type: string; n: number; frames: FrameRow[] };
export type UnitRow = { grade: string; unit: string; n: number };

/** 유형 정리 화면의 학년 › 단원 목록 (유형표에만 있고 문제가 없는 단원도 함께) */
export async function taxonomyUnits(): Promise<UnitRow[]> {
  const rows = await db()`
    select grade, unit, coalesce(sum(n), 0)::int as n from (
      select grade, unit, 0 as n from taxonomy
      union all
      select grade, unit, count(*)::int from problems where grade <> '' and unit <> '' group by grade, unit
    ) s group by grade, unit order by grade, unit`;
  return rows.map((r) => ({ grade: r.grade, unit: r.unit, n: r.n }));
}

/** 한 단원의 유형 › 세부 유형(문제틀)마다 설명과 문제 수. 유형표에만 있는 것(0문제)과 문제에만 있는 것을 모두 보여 준다. */
export async function unitTaxonomy(grade: string, unit: string): Promise<TypeGroup[]> {
  const rows = await db()`
    select type, frame, max(description) as description, sum(n)::int as n from (
      select type, frame, description, 0 as n from taxonomy where grade = ${grade} and unit = ${unit}
      union all
      select type, frame, '' as description, count(*)::int from problems
      where grade = ${grade} and unit = ${unit} group by type, frame
    ) s group by type, frame order by type = '', type, frame = '', frame`;
  const groups: TypeGroup[] = [];
  for (const r of rows) {
    let g = groups.at(-1);
    if (!g || g.type !== r.type) groups.push((g = { type: r.type, n: 0, frames: [] }));
    g.n += r.n;
    g.frames.push({ frame: r.frame, description: r.description ?? "", n: r.n });
  }
  return groups;
}

type Where = { grade: string; unit: string; type: string; frame: string };

/** 트랜잭션 안에서: 한 세부 유형의 문제를 모두 다른 (유형, 세부 유형)으로 옮기고, 빈 옛 분류는 유형표에서 지운다. */
async function moveIn(sql: postgres.TransactionSql, from: Where, to: { type: string; frame: string }, description?: string) {
  const [old] = await sql`
    select id, description from taxonomy
    where grade = ${from.grade} and unit = ${from.unit} and type = ${from.type} and frame = ${from.frame}`;
  const [existing] = await sql`
    select id from taxonomy where grade = ${from.grade} and unit = ${from.unit} and type = ${to.type} and frame = ${to.frame}`;
  const target = await taxonomyId(sql, {
    grade: from.grade,
    unit: from.unit,
    type: to.type,
    frame: to.frame,
    description: description ?? (old?.description as string | undefined) ?? "",
  });
  // 이미 있던 세부 유형으로 합칠 때는 그쪽 설명을 그대로 두고, 이름만 바꿀 때는 고친 설명을 넣는다
  if (description !== undefined && (!existing || sameName(from, to))) {
    await sql`update taxonomy set description = ${description} where id = ${target}`;
  }
  const moved = await sql`
    update problems set type = ${to.type}, frame = ${to.frame}, taxonomy_id = ${target}
    where grade = ${from.grade} and unit = ${from.unit} and type = ${from.type} and frame = ${from.frame}
    returning id`;
  if (old && Number(old.id) !== target) await sql`delete from taxonomy where id = ${old.id}`;
  return { moved: moved.length, merged: !!existing && !sameName(from, to) };
}

const sameName = (a: { type: string; frame: string }, b: { type: string; frame: string }) => a.type === b.type && a.frame === b.frame;

/** 세부 유형 고치기: 이름·설명을 바꾸거나 다른 유형으로 옮긴다. 같은 이름이 이미 있으면 그쪽으로 합쳐진다. */
export async function moveFrame(from: Where, to: { type: string; frame: string }, description?: string) {
  return db().begin((sql) => moveIn(sql, from, to, description));
}

/** 유형 이름 바꾸기: 그 유형의 세부 유형을 모두 새 이름 아래로 옮긴다. 새 이름이 이미 있으면 두 유형이 합쳐진다. */
export async function renameType(grade: string, unit: string, from: string, to: string) {
  return db().begin(async (sql) => {
    const frames = await sql`
      select frame from taxonomy where grade = ${grade} and unit = ${unit} and type = ${from}
      union select frame from problems where grade = ${grade} and unit = ${unit} and type = ${from}`;
    let moved = 0;
    for (const f of frames) {
      const frame = f.frame as string;
      if (frame === "") {
        // 세부 유형이 없는 문제는 유형표에 줄이 없으니 유형 이름만 바꾼다
        const r = await sql`
          update problems set type = ${to} where grade = ${grade} and unit = ${unit} and type = ${from} and frame = '' returning id`;
        moved += r.length;
      } else {
        moved += (await moveIn(sql, { grade, unit, type: from, frame }, { type: to, frame })).moved;
      }
    }
    return { moved };
  });
}

/** 문제가 하나도 없는 세부 유형을 유형표에서 지운다. 문제가 있으면 지우지 않는다. */
export async function deleteEmptyFrame(w: Where) {
  return db().begin(async (sql) => {
    const [c] = await sql`
      select count(*)::int as n from problems
      where grade = ${w.grade} and unit = ${w.unit} and type = ${w.type} and frame = ${w.frame}`;
    if (c.n > 0) return false;
    await sql`delete from taxonomy where grade = ${w.grade} and unit = ${w.unit} and type = ${w.type} and frame = ${w.frame}`;
    return true;
  });
}
