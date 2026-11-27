import "server-only";
import { db } from "./db";

export type Book = { id: string; title: string; storagePath: string; sizeBytes: number; pages: number; pageOffset: number; createdAt: string };
export type BookCrop = {
  id: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ocrText: string;
  setId: string | null;
  /** 그 묶음의 첫 문제(원본) 번호. 문제를 다 지웠으면 null */
  problemId: string | null;
  /** 그 묶음에 남은 문제 수 */
  count: number;
  createdAt: string;
};

const toBook = (r: Record<string, unknown>): Book => ({
  id: r.id as string,
  title: r.title as string,
  storagePath: r.storage_path as string,
  sizeBytes: Number(r.size_bytes),
  pages: Number(r.pages),
  pageOffset: Number(r.page_offset),
  createdAt: new Date(r.created_at as string).toISOString(),
});

/** 교재 목록 (+ 교재마다 만든 문제 자리 수) */
export async function listBooks() {
  const rows = await db()`
    select b.*, (select count(*)::int from textbook_crops c where c.book_id = b.id) as crops
    from textbooks b order by b.created_at desc`;
  return rows.map((r) => ({ ...toBook(r), crops: Number(r.crops) }));
}

export async function getBook(id: string): Promise<Book | null> {
  const [r] = await db()`select * from textbooks where id = ${id}`;
  return r ? toBook(r) : null;
}

/** 교재에서 만든 문제 자리 전부 (쪽 순서) */
export async function listCrops(bookId: string): Promise<BookCrop[]> {
  const rows = await db()`
    select c.*,
      (select p.id from problems p where p.set_id = c.set_id order by p.position, p.id limit 1) as problem_id,
      (select count(*)::int from problems p where p.set_id = c.set_id) as n
    from textbook_crops c where c.book_id = ${bookId}
    order by c.page, c.y, c.x`;
  return rows.map((r) => ({
    id: Number(r.id),
    page: Number(r.page),
    x: Number(r.x),
    y: Number(r.y),
    w: Number(r.w),
    h: Number(r.h),
    ocrText: r.ocr_text as string,
    setId: (r.set_id as string | null) ?? null,
    problemId: (r.problem_id as string | null) ?? null,
    count: Number(r.n ?? 0),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
