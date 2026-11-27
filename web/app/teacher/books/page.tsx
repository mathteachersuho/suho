import Link from "next/link";
import { storageConfigured } from "@/lib/storage";
import { listBooks } from "@/lib/textbooks";
import { IconArrow } from "@/components/Icons";
import UploadBook from "./UploadBook";
import DeleteBook from "./DeleteBook";

export const metadata = { title: "교재" };

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export default async function BooksPage() {
  const ready = storageConfigured();
  const books = await listBooks().catch(() => null);
  return (
    <div className="space-y-6 pb-16">
      <div>
        <p className="eyebrow">Textbooks</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">교재</h1>
        <p className="mt-1 text-sm text-ink-soft">
          교재 PDF를 통째로 올려 두고, 쪽 번호를 넣어 틀린 문제를 네모로 고르면 바로 유사문제를 만들어요. 한 번 만든 문제는 기억해 두었다가 다시 보여 줘요.
        </p>
      </div>

      {!ready && (
        <div className="rounded-2xl border border-line bg-warn-soft p-5 text-sm">
          <p className="font-semibold">아직 Vercel에 Supabase 저장소 키가 없어요</p>
          <p className="mt-1 text-ink-soft">
            Supabase 대시보드 → Project Settings → API 에서 <b>Project URL</b>과 <b>service_role(secret) 키</b>를 복사해, Vercel 프로젝트 Settings → Environment
            Variables에 <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>로 넣고 다시 배포해 주세요. 키 값은 채팅에 올리지 말고 Vercel에만 넣어 주세요.
          </p>
        </div>
      )}
      {books === null && (
        <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">교재 목록을 읽지 못했어요. db/schema.sql을 Supabase에서 다시 실행했는지 확인해 주세요.</p>
      )}

      {ready && books !== null && <UploadBook />}

      {books && books.length > 0 && (
        <ul className="space-y-2">
          {books.map((b) => (
            <li key={b.id} className="card flex flex-wrap items-center gap-3 py-4">
              <Link href={`/teacher/books/${b.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold">{b.title}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {b.pages}쪽 · {mb(b.sizeBytes)} · 만든 문제 자리 {b.crops}곳 · {b.createdAt.slice(0, 10)} 올림
                </p>
              </Link>
              <Link href={`/teacher/books/${b.id}`} className="btn-soft py-2">
                열기 <IconArrow />
              </Link>
              <DeleteBook id={b.id} title={b.title} />
            </li>
          ))}
        </ul>
      )}
      {books && books.length === 0 && ready && <p className="text-sm text-ink-faint">아직 올린 교재가 없어요.</p>}
    </div>
  );
}
