"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import CreateFlow, { type Preset } from "../../create/CreateFlow";
import { cropPage, openPdfUrl, renderPage, type Rect } from "@/lib/pdfClient";
import type { BookCrop } from "@/lib/textbooks";
import { updateBookAction } from "../actions";

type Props = {
  book: { id: string; title: string; pages: number; pageOffset: number };
  url: string;
  crops: BookCrop[];
  /** PDF 쪽 번호 (주소의 ?p=) */
  initialPage: number | null;
  taxonomy: Parameters<typeof CreateFlow>[0]["taxonomy"];
  semesters: Record<string, string>;
};

const MIN = 0.02; // 이보다 작은 네모는 실수로 누른 것으로 본다

/** 두 네모가 얼마나 겹치는지 (작은 쪽 넓이 기준 0~1) */
function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}

export default function BookWorkspace({ book, url, crops, initialPage, taxonomy, semesters }: Props) {
  const router = useRouter();
  const offset = book.pageOffset;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pdfPage, setPdfPage] = useState(() => Math.min(Math.max(initialPage ?? 1 + offset, 1), Math.max(book.pages, 1)));
  const [pageInput, setPageInput] = useState(String(pdfPage - offset));
  const [rendering, setRendering] = useState(true);
  const [width, setWidth] = useState(0);
  /** 꺼져 있으면 쪽 전체가 한 화면에 들어오게 줄인다 (태블릿에서 쪽 위를 끌어도 화면이 안 움직여서) */
  const [big, setBig] = useState(false);
  const [sel, setSel] = useState<Rect | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [run, setRun] = useState(0);
  const [cropping, setCropping] = useState(false);
  const [error, setError] = useState("");
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [offsetInput, setOffsetInput] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const total = doc?.numPages ?? book.pages;
  const pageCrops = crops.filter((c) => c.page === pdfPage);
  const madePages = [...new Map(crops.map((c) => [c.page, crops.filter((d) => d.page === c.page).length])).entries()];
  const match = sel ? pageCrops.find((c) => overlap(sel, c) > 0.6) : undefined;

  // PDF 열기 (쪽마다 필요한 부분만 내려받음)
  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    openPdfUrl(url)
      .then((t) => {
        task = t;
        if (!alive) return void t.destroy();
        return t.promise.then((d) => alive && setDoc(d));
      })
      .catch(() => alive && setLoadError("교재 PDF를 열지 못했어요. 새로고침해 보세요."));
    return () => {
      alive = false;
      task?.destroy();
    };
  }, [url]);

  // 화면 폭에 맞춰 그리기
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !width || !canvasRef.current) return;
    let task: RenderTask | null = null;
    let alive = true;
    const canvas = canvasRef.current;
    (async () => {
      setRendering(true);
      try {
        const page = await doc.getPage(pdfPage);
        if (!alive) return;
        const vp = page.getViewport({ scale: 1 });
        const fit = Math.floor(((window.innerHeight - 90) * vp.width) / vp.height);
        task = await renderPage(page, canvas, big ? width : Math.min(width, Math.max(fit, 320)));
      } catch (e) {
        if (alive && (e as { name?: string })?.name !== "RenderingCancelledException") setError("이 쪽을 그리지 못했어요.");
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, pdfPage, width, big]);

  const go = (p: number) => {
    const n = Math.min(Math.max(Math.round(p), 1), total || 1);
    setPdfPage(n);
    setPageInput(String(n - offset));
    setSel(null);
    setError("");
    window.history.replaceState(null, "", `?p=${n}`);
  };

  // 네모 고르기 (마우스·펜·손가락 모두)
  const pos = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = pos(e);
    setDragging(true);
    setSel(null);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s) return;
    const p = pos(e);
    setSel({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    drag.current = null;
    setDragging(false);
    if (!s) return;
    const p = pos(e);
    const r = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    if (r.w < MIN || r.h < MIN) {
      // 그냥 누른 경우: 전에 만든 자리 안을 눌렀으면 그 자리를 고른다
      const hit = pageCrops.find((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h);
      setSel(hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : null);
      return;
    }
    setSel(r);
  };

  /** 고른 부분을 선명하게 잘라 문제 만들기로. reuse = 전에 읽어 둔 글자 (있으면 글자 읽기 건너뜀) */
  const make = async (reuse?: string) => {
    if (!doc || !sel) return;
    setError("");
    setCropping(true);
    try {
      const image = await cropPage(await doc.getPage(pdfPage), sel);
      setPreset({
        image,
        text: reuse || undefined,
        crop: { bookId: book.id, page: pdfPage, ...sel },
        caption: `${book.title} · ${pdfPage - offset}쪽`,
      });
      setRun((n) => n + 1);
      setTimeout(() => flowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch {
      setError("고른 부분을 자르지 못했어요. 다시 골라 주세요.");
    } finally {
      setCropping(false);
    }
  };

  const reset = () => {
    setPreset(null);
    setSel(null);
    wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const saveOffset = async () => {
    const bookPage = Math.round(Number(offsetInput));
    if (!Number.isFinite(bookPage) || !offsetInput.trim()) return;
    const next = pdfPage - bookPage;
    const r = await updateBookAction({ id: book.id, pageOffset: next });
    if (!r.ok) return setError(r.error);
    setOffsetOpen(false);
    setPageInput(String(bookPage));
    router.refresh();
  };

  if (loadError) return <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">{loadError}</p>;

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-soft px-3 py-1.5" onClick={() => go(pdfPage - 1)} disabled={pdfPage <= 1} aria-label="앞 쪽">
            ‹
          </button>
          <form
            className="flex items-center gap-1.5 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(pageInput);
              if (Number.isFinite(n)) go(n + offset);
            }}
          >
            <span className="text-ink-soft">책</span>
            <input value={pageInput} onChange={(e) => setPageInput(e.target.value)} inputMode="numeric" className="field w-20 py-1.5 text-center" aria-label="책 쪽 번호" />
            <span className="text-ink-soft">쪽</span>
            <button type="submit" className="btn-soft px-3 py-1.5">
              가기
            </button>
          </form>
          <button type="button" className="btn-soft px-3 py-1.5" onClick={() => go(pdfPage + 1)} disabled={pdfPage >= total} aria-label="다음 쪽">
            ›
          </button>
          <span className="text-xs text-ink-faint">
            PDF {pdfPage} / {total}쪽
          </span>
          <button type="button" className="ml-auto text-xs text-ink-soft underline-offset-4 hover:underline" onClick={() => setOffsetOpen((v) => !v)}>
            책 쪽 번호 맞추기
          </button>
        </div>
        {offsetOpen && (
          <form
            className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              saveOffset();
            }}
          >
            <span>지금 보이는 쪽(PDF {pdfPage}쪽)에 찍힌 책 쪽 번호는</span>
            <input value={offsetInput} onChange={(e) => setOffsetInput(e.target.value)} inputMode="numeric" className="field w-20 py-1.5 text-center" />
            <span>쪽이에요.</span>
            <button type="submit" className="btn-main py-1.5">
              맞추기
            </button>
            <p className="w-full text-xs text-ink-faint">한 번 맞추면 다음부터 책에 찍힌 쪽 번호로 바로 찾아가요.</p>
          </form>
        )}
        {madePages.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-soft">문제를 만든 쪽</span>
            {madePages.map(([p, n]) => (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                className={`rounded-full border px-2 py-0.5 ${p === pdfPage ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
              >
                {p - offset}쪽{n > 1 ? ` · ${n}` : ""}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-faint">틀린 문제를 손가락이나 마우스로 끌어 네모로 감싸 주세요. 그림과 보기까지 같이 넣으면 더 정확해요.</p>

        <div ref={wrapRef} className="w-full scroll-mt-20">
        <div className="relative mx-auto min-h-60 w-fit min-w-[280px] max-w-full overflow-hidden rounded-lg border border-line bg-white">
          <canvas ref={canvasRef} className="block" />
          {(rendering || !doc) && (
            <div className="absolute inset-0 flex min-h-60 items-center justify-center gap-2 bg-surface/60 text-sm text-ink-soft">
              <Spinner /> 쪽을 불러오는 중…
            </div>
          )}
          <div
            className="absolute inset-0 cursor-crosshair touch-none select-none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
          >
            {pageCrops.map((c) => (
              <div
                key={c.id}
                className="pointer-events-none absolute rounded border-2 border-dashed border-good/70 bg-good/5"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
              >
                <span className="absolute bottom-0 right-0 rounded-tl bg-good px-1.5 py-0.5 text-[11px] font-medium text-white">만듦{c.count ? ` · ${c.count}문제` : ""}</span>
              </div>
            ))}
            {sel && (
              <div
                className="pointer-events-none absolute rounded border-2 border-accent bg-accent/10"
                style={{ left: `${sel.x * 100}%`, top: `${sel.y * 100}%`, width: `${sel.w * 100}%`, height: `${sel.h * 100}%` }}
              />
            )}
          </div>
        </div>

        </div>
        <button type="button" className="text-xs text-ink-soft underline-offset-4 hover:underline" onClick={() => setBig((v) => !v)}>
          {big ? "쪽 전체 보기" : "화면 폭에 맞게 크게 보기"}
        </button>

        {sel && !dragging && (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg">
            {match ? (
              <>
                <p className="mr-auto text-sm">
                  전에 이 문제로 {match.count ? `${match.count}문제를` : "문제를"} 만들었어요.
                </p>
                {match.problemId && (
                  <Link href={`/teacher/bank/${match.problemId}`} className="btn-soft py-2">
                    문제 은행에서 보기
                  </Link>
                )}
                <button type="button" className="btn-main py-2" onClick={() => make(match.ocrText)} disabled={cropping}>
                  {cropping ? <Spinner /> : null} 더 만들기
                </button>
              </>
            ) : (
              <>
                <p className="mr-auto text-sm text-ink-soft">고른 부분으로 원본을 다시 쓰고 유사문제를 만들어요.</p>
                <button type="button" className="btn-soft py-2" onClick={() => setSel(null)}>
                  다시 고르기
                </button>
                <button type="button" className="btn-main py-2" onClick={() => make()} disabled={cropping}>
                  {cropping ? <Spinner /> : null} 이 문제로 만들기
                </button>
              </>
            )}
            {preset && <p className="w-full text-xs text-ink-faint">누르면 아래에서 만들던 문제 대신 새로 시작해요. 저장 안 한 문제는 사라져요.</p>}
          </div>
        )}
        {error && <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p>}
      </section>

      <div ref={flowRef} className="scroll-mt-20">
        {preset && (
          <CreateFlow
            key={run}
            taxonomy={taxonomy}
            semesters={semesters}
            preset={preset}
            onSaved={() => router.refresh()}
            onReset={reset}
          />
        )}
      </div>
    </div>
  );
}
