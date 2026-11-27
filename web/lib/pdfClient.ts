"use client";

/*
 * 브라우저에서 교재 PDF를 여는 도우미 (pdf.js).
 * pdf.js 는 크니까 교재 화면에서만 불러온다(import()). 일꾼·글꼴 파일은 public/pdfjs (scripts/copy-pdfjs.mjs).
 * 주소로 열 때는 쪽마다 필요한 부분만 내려받는다(Range 요청) → 큰 교재도 첫 화면이 빠르다.
 */
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      const p = m as unknown as PdfJs;
      p.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return p;
    });
  }
  return lib;
}

const COMMON = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  isEvalSupported: false,
};

/** 주소로 열기 (쪽마다 필요한 부분만 내려받음). 다 쓰면 task.destroy() */
export async function openPdfUrl(url: string): Promise<PDFDocumentLoadingTask> {
  const p = await pdfjs();
  return p.getDocument({ ...COMMON, url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 64 * 1024 });
}

/** 올리기 전에 고른 파일 확인 (쪽 수 세기). 진짜 PDF가 아니면 오류. */
export async function countPdfPages(file: File): Promise<number> {
  const p = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = p.getDocument({ ...COMMON, data });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** 쪽을 canvas 에 그린다. width = 화면에 보일 폭(CSS px). 화면 선명도(devicePixelRatio)만큼 크게 그린다. */
export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number) {
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: (width / base.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${Math.floor((viewport.height / dpr))}px`;
  const task = page.render({ canvas, viewport, background: "#fff" });
  await task.promise;
  return task;
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * 쪽의 한 부분(0~1 비율)을 선명하게 다시 그려 JPEG base64 로.
 * 잘라 낸 부분의 긴 쪽이 약 1600px 이 되게 (글자 읽기가 잘 되고, 2000px·서버 한도 안).
 */
export async function cropPage(page: PDFPageProxy, r: Rect, longSide = 1600): Promise<{ b64: string; url: string }> {
  const base = page.getViewport({ scale: 1 });
  const cropW = base.width * r.w;
  const cropH = base.height * r.h;
  const scale = Math.min(6, Math.max(1, longSide / Math.max(cropW, cropH)));
  const viewport = page.getViewport({ scale });
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cropW * scale));
  out.height = Math.max(1, Math.round(cropH * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  // 쪽 전체 대신 잘라 낼 부분만 그리도록 옮겨서 그린다 (큰 canvas 를 만들지 않아 메모리 절약)
  await page.render({
    canvas: out,
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -r.x * viewport.width, -r.y * viewport.height],
    background: "#fff",
  }).promise;
  const url = out.toDataURL("image/jpeg", 0.9);
  return { b64: url.slice(url.indexOf(",") + 1), url };
}
