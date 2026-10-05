"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { IconPrinter, IconSparkle } from "@/components/Icons";
import { reportDraftAction } from "../actions";

/**
 * 문제 분석 · 선생님 종합 의견. AI 초안을 받아 고칠 수 있고, 인쇄하면 글만 나온다.
 * 쓴 글은 이 브라우저에 (학생·기간별로) 저장해 두어 새로고침해도 남는다.
 */
type Notes = { analysis: string; comment: string };
const EMPTY: Notes = { analysis: "", comment: "" };
const EVENT = "report-notes-change";
let cache: { key: string; raw: string | null; v: Notes } = { key: "", raw: null, v: EMPTY };

function read(key: string): Notes {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return cache.key === key ? cache.v : EMPTY; // 저장소를 못 쓰면 메모리에만
  }
  if (cache.key === key && cache.raw === raw) return cache.v;
  let v = EMPTY;
  try {
    const o = JSON.parse(raw || "{}");
    v = { analysis: String(o.analysis || ""), comment: String(o.comment || "") };
  } catch {}
  cache = { key, raw, v };
  return v;
}

function write(key: string, v: Notes) {
  const raw = JSON.stringify(v);
  cache = { key, raw, v };
  try {
    localStorage.setItem(key, raw);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function ReportNotes({ studentId, from, to }: { studentId: string; from: string; to: string }) {
  const key = `report:${studentId}:${from}:${to}`;
  const notes = useSyncExternalStore(subscribe, () => read(key), () => EMPTY);
  const { analysis, comment } = notes;
  const setAnalysis = (a: string) => write(key, { ...read(key), analysis: a });
  const setComment = (c: string) => write(key, { ...read(key), comment: c });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const draft = () => {
    if ((analysis || comment) && !confirm("지금 쓴 글을 AI 초안으로 바꿀까요?")) return;
    setError("");
    start(async () => {
      const r = await reportDraftAction(studentId, from, to);
      if (r.error) return setError(r.error);
      write(key, { analysis: r.analysis || "", comment: r.comment || "" });
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={draft} disabled={pending} className="btn-accent">
          <IconSparkle />
          {pending ? "AI가 쓰는 중…" : "AI로 초안 쓰기"}
        </button>
        <button type="button" onClick={() => window.print()} className="btn-soft">
          <IconPrinter />
          인쇄 · PDF 저장
        </button>
        <p className="text-sm text-ink-faint">초안은 고쳐 쓸 수 있어요. 쓴 글은 이 컴퓨터에 저장돼요.</p>
      </div>
      {error && <p className="text-sm text-bad print:hidden">{error}</p>}
      <Note title="문제 분석" value={analysis} onChange={setAnalysis} rows={9} placeholder="자주 틀리는 유형, 틀린 원인, 앞으로의 지도 계획" />
      <Note title="선생님 종합 의견" value={comment} onChange={setComment} rows={6} placeholder="학부모님께 드리는 말씀" />
    </>
  );
}

function Note({ title, value, onChange, rows, placeholder }: { title: string; value: string; onChange: (v: string) => void; rows: number; placeholder: string }) {
  return (
    <section className={`space-y-2 ${value ? "" : "print:hidden"}`}>
      <h3 className="report-h">{title}</h3>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="field leading-relaxed print:hidden"
      />
      <div className="hidden whitespace-pre-wrap rounded-xl border border-line p-4 leading-relaxed print:block">{value}</div>
    </section>
  );
}
