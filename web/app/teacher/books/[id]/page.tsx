import Link from "next/link";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/clients";
import { signedReadUrl, storageConfigured } from "@/lib/storage";
import { listTaxonomy, unitSemesters } from "@/lib/taxonomy";
import { getBook, listCrops } from "@/lib/textbooks";
import BookWorkspace from "./BookWorkspace";

// 고른 문제로 유사문제를 만드는 데 수십 초 걸릴 수 있어서 넉넉하게 (문제 만들기 화면과 같게)
export const maxDuration = 120;

export const metadata = { title: "교재" };

export default async function BookPage({ params, searchParams }: PageProps<"/teacher/books/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[a-f0-9]{16}$/.test(id)) notFound();
  const book = await getBook(id);
  if (!book) notFound();
  if (!storageConfigured()) {
    return <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm">Vercel에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 넣어야 교재를 열 수 있어요.</p>;
  }
  const [url, crops, taxonomy, semesters] = await Promise.all([signedReadUrl(book.storagePath), listCrops(id), listTaxonomy(), unitSemesters()]);
  const cfg = aiConfigured();
  const p = Number(Array.isArray(sp.p) ? sp.p[0] : sp.p);
  return (
    <div className="space-y-4 pb-16">
      <div>
        <Link href="/teacher/books" className="text-sm text-ink-soft hover:text-ink">
          ← 교재 목록
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{book.title}</h1>
      </div>
      {(!cfg.mathpix || !cfg.gemini) && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm">문제 만들기 키(Mathpix·Gemini)가 Vercel에 없어서 유사문제를 만들 수 없어요.</p>
      )}
      <BookWorkspace
        key={book.id}
        book={{ id: book.id, title: book.title, pages: book.pages, pageOffset: book.pageOffset }}
        url={url}
        crops={crops}
        initialPage={Number.isInteger(p) && p > 0 ? p : null}
        taxonomy={taxonomy}
        semesters={semesters}
      />
    </div>
  );
}
