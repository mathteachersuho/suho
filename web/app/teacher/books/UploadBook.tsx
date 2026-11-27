"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconPlus } from "@/components/Icons";
import { countPdfPages } from "@/lib/pdfClient";
import { finishUploadAction, startUploadAction } from "./actions";

/** 브라우저에서 Supabase 저장소로 바로 올린다 (Vercel을 거치지 않음). 올라가는 만큼 막대로 보여 준다. */
function put(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413 || /maximum allowed size|too large/i.test(xhr.responseText))
        reject(new Error("Supabase 파일 크기 한도에 걸렸어요. 무료 플랜은 파일당 50MB까지예요. PDF를 나눠 올리거나 Supabase Storage 설정에서 한도를 올려 주세요."));
      else reject(new Error(`올리지 못했어요 (${xhr.status}). 다시 해 주세요.`));
    };
    xhr.onerror = () => reject(new Error("인터넷 연결이 끊겼어요. 다시 해 주세요."));
    xhr.send(file);
  });
}

export default function UploadBook() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (f: File | undefined) => {
    setError("");
    setFile(null);
    setPages(0);
    if (!f) return;
    if (f.type && f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setError("PDF 파일만 올릴 수 있어요.");
      return;
    }
    setBusy(true);
    try {
      setPages(await countPdfPages(f));
      setFile(f);
      setTitle(f.name.replace(/\.pdf$/i, ""));
    } catch {
      setError("PDF를 열지 못했어요. 암호가 걸렸거나 깨진 파일일 수 있어요.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const s = await startUploadAction({ size: file.size });
      if (!s.ok) throw new Error(s.error);
      await put(s.uploadUrl, file, setProgress);
      const f = await finishUploadAction({ id: s.id, title, pages });
      if (!f.ok) throw new Error(f.error);
      router.push(`/teacher/books/${f.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "올리지 못했어요.");
      setProgress(null);
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold">새 교재 올리기</h2>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-soft" onClick={() => fileRef.current?.click()} disabled={busy}>
          <IconPlus /> PDF 고르기
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        {file && (
          <span className="text-sm text-ink-soft">
            {file.name} · {pages}쪽 · {(file.size / 1024 / 1024).toFixed(1)}MB
          </span>
        )}
      </div>
      {file && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-60 flex-1">
            <span className="mb-1 block text-xs font-medium text-ink-soft">교재 이름</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" maxLength={100} />
          </label>
          <button type="button" className="btn-main" onClick={upload} disabled={busy || !title.trim()}>
            {progress !== null ? `올리는 중… ${Math.round(progress * 100)}%` : "올리기"}
          </button>
        </div>
      )}
      {progress !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {error && <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p>}
    </section>
  );
}
