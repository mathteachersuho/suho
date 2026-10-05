"use server";

import { revalidatePath } from "next/cache";
import { AiError, mathpixText } from "@/lib/ai/clients";
import type { GenKind } from "@/lib/ai/prompts";
import { editOne, generateAll, generateOne, SEMESTERS, type CardResult } from "@/lib/create";
import { db } from "@/lib/db";
import { DIFFICULTIES } from "@/lib/difficulty";
import { renderProblemHtml } from "@/lib/mathText";
import { requireTeacher } from "@/lib/session";
import { listTaxonomy } from "@/lib/taxonomy";
import type { SavePayload, SaveResult, Source } from "./types";

const MAX_IMAGE = 6_000_000; // base64 글자 수
const MAX_TEXT = 20_000;
const B64 = /^[A-Za-z0-9+/=]+$/;

function cleanImage(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  if (v.length > MAX_IMAGE || !B64.test(v)) throw new AiError("사진이 너무 크거나 읽을 수 없는 형식이에요.");
  return v;
}
const cleanText = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.slice(0, max) : "");
const fail = (e: unknown) => {
  if (!(e instanceof AiError)) console.error(e);
  return e instanceof AiError ? e.message : "처리하지 못했어요. 다시 눌러 주세요.";
};

/** 1) 사진 → 글자 */
export async function ocrAction(imageB64: string): Promise<{ text: string } | { error: string }> {
  await requireTeacher();
  try {
    const img = cleanImage(imageB64);
    if (!img) return { error: "사진을 먼저 골라 주세요." };
    return { text: await mathpixText(img) };
  } catch (e) {
    return { error: fail(e) };
  }
}

/** 2) 원본 다시 쓰기 + 유사문제 2개 + 분류를 동시에 */
export async function generateAction(input: { text: string; imageB64?: string; detailed: boolean }) {
  await requireTeacher();
  try {
    const text = cleanText(input.text).trim();
    if (!text) return { error: "문제 글자가 비어 있어요." } as const;
    const taxonomy = await listTaxonomy();
    return { result: await generateAll(text, !!input.detailed, cleanImage(input.imageB64), taxonomy) } as const;
  } catch (e) {
    return { error: fail(e) } as const;
  }
}

/** 한 문제만 다시 만들기 */
export async function regenerateAction(input: { kind: GenKind; text: string; imageB64?: string; detailed: boolean }): Promise<CardResult> {
  await requireTeacher();
  try {
    const kind = ([0, 1, 2] as const).includes(input.kind) ? input.kind : 1;
    return { ok: true, data: await generateOne(kind, cleanText(input.text), !!input.detailed, cleanImage(input.imageB64)) };
  } catch (e) {
    return { ok: false, error: fail(e) };
  }
}

/** 선생님이 말로 적은 요청대로 AI가 한 문제를 고친다. 원본 카드는 사진도 함께 보낸다. */
export async function aiEditAction(input: {
  question: string;
  answer: string;
  solution: string;
  instruction: string;
  imageB64?: string;
}): Promise<CardResult> {
  await requireTeacher();
  try {
    const instruction = cleanText(input.instruction, 1000).trim();
    if (!instruction) return { ok: false, error: "어떻게 고칠지 적어 주세요." };
    const current = { question: cleanText(input.question), answer: cleanText(input.answer, 2000), solution: cleanText(input.solution) };
    if (!current.question.trim()) return { ok: false, error: "고칠 문제가 비어 있어요." };
    return { ok: true, data: await editOne(current, instruction, cleanImage(input.imageB64)) };
  } catch (e) {
    return { ok: false, error: fail(e) };
  }
}

/** 고치는 글자를 문제 은행과 똑같은 모양으로 미리 보기 */
export async function previewAction(texts: string[]): Promise<string[]> {
  await requireTeacher();
  return texts.slice(0, 12).map((t) => renderProblemHtml(cleanText(t)));
}

const POSITION: Record<Source, number> = { 원본: 0, "AI 기본": 1, "AI 실력": 2 };
const GROUP_ID = /^\d{13}x\d{6}$/;
const s = (v: unknown, max = 100) => cleanText(v, max).trim();

/** 3) 문제 은행에 저장. 같은 묶음 번호로 다시 눌러도 두 번 저장되지 않는다. (Streamlit bank_save 와 같은 표 구조) */
export async function saveAction(p: SavePayload): Promise<SaveResult> {
  await requireTeacher();
  if (!GROUP_ID.test(p?.groupId || "")) return { ok: false, error: "저장 번호가 잘못됐어요. 새로고침 후 다시 해 주세요." };
  const items = (p.items || []).filter((it) => it && it.source in POSITION).slice(0, 3);
  if (!items.length) return { ok: false, error: "저장할 문제를 하나 이상 체크해 주세요." };
  const rows = items.map((it) => ({
    source: it.source,
    question: cleanText(it.question),
    answer: cleanText(it.answer, 2000),
    solution: cleanText(it.solution),
    difficulty: (DIFFICULTIES as readonly string[]).includes(it.difficulty) ? it.difficulty : "",
    verified: !!it.verified,
    grade: s(it.cls?.grade),
    unit: s(it.cls?.unit),
    type: s(it.cls?.type),
    frame: s(it.cls?.frame),
    description: s(it.cls?.description, 300),
  }));
  if (rows.some((r) => !r.question.trim())) return { ok: false, error: "문제 내용이 빈 문제가 있어요." };
  if (rows.some((r) => !(r.grade && r.unit && r.type && r.frame))) return { ok: false, error: "학년·단원·유형·문제틀을 모두 정해 주세요." };
  const semester = (SEMESTERS as readonly string[]).includes(p.semester) ? p.semester : "";
  const ids = rows.map((_, i) => `${p.groupId}_${i + 1}`);

  try {
    const result = await db().begin(async (sql) => {
      const [dup] = await sql`select 1 from problems where id = ${ids[0]}`;
      if (dup) return { ok: true as const, ids, duplicate: true };
      // 유형표 번호 (없으면 추가)
      const taxIds = new Map<string, number>();
      for (const r of rows) {
        const key = [r.grade, r.unit, r.type, r.frame].join("\u0000");
        if (taxIds.has(key)) continue;
        const [t] = await sql`
          with ins as (
            insert into taxonomy (grade, unit, type, frame, description)
            values (${r.grade}, ${r.unit}, ${r.type}, ${r.frame}, ${r.description})
            on conflict (grade, unit, type, frame) do nothing returning id)
          select id from ins union all
          select id from taxonomy where grade = ${r.grade} and unit = ${r.unit} and type = ${r.type} and frame = ${r.frame}
          limit 1`;
        taxIds.set(key, Number(t.id));
      }
      const first = rows[0];
      await sql`
        insert into problem_sets (id, made_on, grade, unit, subtype, image_ref)
        values (${p.groupId}, (now() at time zone 'Asia/Seoul')::date, ${first.grade}, ${first.unit}, ${first.frame}, '')`;
      const originIdx = rows.findIndex((r) => r.source === "원본");
      const originId = originIdx >= 0 ? ids[originIdx] : null;
      for (const [i, r] of rows.entries()) {
        await sql`
          insert into problems (id, set_id, position, taxonomy_id, grade, unit, type, frame, difficulty, source, origin_id,
                                question, answer, solution, image_ref, verified, memo, model)
          values (${ids[i]}, ${p.groupId}, ${POSITION[r.source]}, ${taxIds.get([r.grade, r.unit, r.type, r.frame].join("\u0000"))!},
                  ${r.grade}, ${r.unit}, ${r.type}, ${r.frame}, ${r.difficulty}, ${r.source},
                  ${r.source === "원본" ? null : originId}, ${r.question}, ${r.answer}, ${r.solution}, '', ${r.verified}, '',
                  ${r.source === "원본" ? "" : process.env.GEMINI_MODEL || "gemini-flash-latest"})`;
      }
      if (semester && first.unit) {
        await sql`
          insert into units (grade, unit, semester) values (${first.grade}, ${first.unit}, ${semester})
          on conflict (grade, unit) do update set semester = excluded.semester, updated_at = now()`;
      }
      return { ok: true as const, ids };
    });
    revalidatePath("/teacher/bank");
    return result;
  } catch (e) {
    // 같은 저장이 동시에 두 번 들어온 경우: 먼저 들어온 쪽이 저장했다
    if ((e as { code?: string }).code === "23505") return { ok: true, ids, duplicate: true };
    console.error(e);
    return { ok: false, error: "저장하지 못했어요. 아무것도 저장되지 않았으니 다시 눌러 주세요." };
  }
}
