"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { reportError } from "@/lib/reportError";
import { requireTeacher } from "@/lib/session";
import { MAX_PDF_BYTES, objectSize, removeObject, signedUploadUrl, StorageError } from "@/lib/storage";
import { getBook } from "@/lib/textbooks";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const BOOK_ID = /^[a-f0-9]{16}$/;
const fail = (place: string, e: unknown) => {
  if (!(e instanceof StorageError)) after(() => reportError(place, e));
  return { ok: false as const, error: e instanceof StorageError ? e.message : "처리하지 못했어요. 다시 해 주세요." };
};
const cleanTitle = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 100) : "");

/** 1) 올릴 준비: 교재 번호와 '브라우저가 Supabase 로 바로 올릴 주소'를 만든다 */
export async function startUploadAction(input: { size: number }): Promise<Res<{ id: string; uploadUrl: string }>> {
  await requireTeacher();
  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "파일을 다시 골라 주세요." };
  if (size > MAX_PDF_BYTES) return { ok: false, error: `PDF가 너무 커요 (최대 ${MAX_PDF_BYTES / 1024 / 1024}MB). 쪽을 나눠서 올려 주세요.` };
  try {
    const id = randomBytes(8).toString("hex");
    return { ok: true, id, uploadUrl: await signedUploadUrl(`${id}.pdf`) };
  } catch (e) {
    return fail("교재 올리기 준비", e);
  }
}

/** 2) 다 올라갔으면 목록에 넣는다 (파일이 정말 올라갔는지 확인) */
export async function finishUploadAction(input: { id: string; title: string; pages: number }): Promise<Res<{ id: string }>> {
  await requireTeacher();
  const id = String(input?.id || "");
  if (!BOOK_ID.test(id)) return { ok: false, error: "교재 번호가 잘못됐어요. 다시 올려 주세요." };
  const pages = Math.max(0, Math.min(Math.floor(Number(input?.pages) || 0), 100_000));
  const title = cleanTitle(input?.title) || "이름 없는 교재";
  try {
    const path = `${id}.pdf`;
    const size = await objectSize(path);
    if (size === null) return { ok: false, error: "파일이 올라가지 않았어요. 다시 올려 주세요." };
    await db()`
      insert into textbooks (id, title, storage_path, size_bytes, pages)
      values (${id}, ${title}, ${path}, ${size}, ${pages})
      on conflict (id) do nothing`;
    revalidatePath("/teacher/books");
    return { ok: true, id };
  } catch (e) {
    return fail("교재 올리기", e);
  }
}

/** 이름 바꾸기 · 책 쪽 번호 맞추기 (책 쪽 + page_offset = PDF 쪽) */
export async function updateBookAction(input: { id: string; title?: string; pageOffset?: number }): Promise<Res> {
  await requireTeacher();
  const id = String(input?.id || "");
  if (!BOOK_ID.test(id)) return { ok: false, error: "교재를 찾지 못했어요." };
  const title = input.title === undefined ? null : cleanTitle(input.title);
  if (title === "") return { ok: false, error: "교재 이름을 적어 주세요." };
  const offset = input.pageOffset === undefined ? null : Math.max(-10_000, Math.min(10_000, Math.round(Number(input.pageOffset) || 0)));
  try {
    await db()`
      update textbooks set
        title = coalesce(${title}, title),
        page_offset = coalesce(${offset}, page_offset)
      where id = ${id}`;
    revalidatePath("/teacher/books");
    revalidatePath(`/teacher/books/${id}`);
    return { ok: true };
  } catch (e) {
    return fail("교재 고치기", e);
  }
}

/** 교재 지우기. 이 교재로 만든 문제는 문제 은행에 그대로 남는다. */
export async function deleteBookAction(id: string): Promise<Res> {
  await requireTeacher();
  if (!BOOK_ID.test(String(id || ""))) return { ok: false, error: "교재를 찾지 못했어요." };
  try {
    const book = await getBook(id);
    if (!book) return { ok: true };
    await removeObject(book.storagePath);
    await db()`delete from textbooks where id = ${id}`;
    revalidatePath("/teacher/books");
    return { ok: true };
  } catch (e) {
    return fail("교재 지우기", e);
  }
}
