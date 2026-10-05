"use client";

import { useRef, useState, useTransition } from "react";
import { IconSparkle, IconX } from "@/components/Icons";
import type { ExamAnalysis } from "@/lib/report";
import { shrinkImage } from "../../create/image";
import { analyzeExamAction } from "../actions";

const MAX_PAGES = 6;
const MAX_TOTAL = 3_800_000;

/** 시험지 사진 올리기 → AI가 문항마다 단원·유형과 맞음/틀림을 구별해 분석. 결과는 시험 기록에 저장된다. */
export default function ExamAnalyze({ studentId, examId, initial }: { studentId: string; examId: string; initial: ExamAnalysis | null }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<{ b64: string; url: string }[]>([]);
  const [wrong, setWrong] = useState(initial?.wrong.join(", ") ?? "");
  const [result, setResult] = useState<ExamAnalysis | null>(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_PAGES - pages.length);
    try {
      const next = [...pages];
      for (const f of list) next.push(await shrinkImage(f, 1500));
      if (next.reduce((a, p) => a + p.b64.length, 0) > MAX_TOTAL) return setError("사진이 너무 커요. 장수를 줄여 주세요.");
      setPages(next);
    } catch {
      setError("사진을 읽지 못했어요. 다른 사진으로 해 보세요.");
    }
    if (input.current) input.current.value = "";
  };

  const run = () => {
    setError("");
    start(async () => {
      const r = await analyzeExamAction(studentId, examId, pages.map((p) => p.b64), wrong);
      if (r.error) return setError(r.error);
      setResult(r.analysis ?? null);
      setPages([]);
    });
  };

  const bad = result?.problems.filter((p) => p.result === "틀림").length ?? 0;
  return (
    <div className="w-full">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-sm font-medium text-accent hover:underline">
        {result ? `시험지 분석 보기 (${result.problems.length}문항 중 ${bad}개 틀림)` : "시험지 사진으로 분석하기"}
      </button>
      {open && (
        <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface-2/50 p-4">
          {result && <AnalysisView a={result} />}
          <div className="space-y-3">
            <p className="text-sm font-semibold">{result ? "다시 분석하기" : "시험지 사진 올리기"}</p>
            <div className="flex flex-wrap items-center gap-2">
              {pages.map((p, i) => (
                <span key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`${i + 1}쪽`} className="h-20 w-16 rounded-lg border border-line object-cover" />
                  <button
                    type="button"
                    aria-label={`${i + 1}쪽 빼기`}
                    onClick={() => setPages(pages.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-bg"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {pages.length < MAX_PAGES && (
                <label className="btn-soft cursor-pointer px-3 py-2">
                  사진 고르기
                  <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => pick(e.target.files)} />
                </label>
              )}
              <span className="text-xs text-ink-faint">채점된 시험지를 쪽 순서대로, {MAX_PAGES}장까지</span>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-ink-soft">틀린 문항 번호 (선택)</span>
              <input value={wrong} onChange={(e) => setWrong(e.target.value)} placeholder="예: 3, 7, 12, 서2" className="field py-2" />
              <span className="block text-xs text-ink-faint">비워 두면 사진의 채점 표시(빗금·동그라미)를 보고 AI가 맞은 문제와 틀린 문제를 구별해요.</span>
            </label>
            <button type="button" onClick={run} disabled={pending || !pages.length} className="btn-accent">
              <IconSparkle />
              {pending ? "분석하는 중… (1분쯤 걸려요)" : "분석하기"}
            </button>
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalysisView({ a }: { a: ExamAnalysis }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs text-ink-faint">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-2 font-medium">번호</th>
              <th className="py-1.5 pr-2 font-medium">결과</th>
              <th className="py-1.5 pr-2 font-medium">단원 › 유형</th>
              <th className="py-1.5 pr-2 font-medium">난이도</th>
              <th className="py-1.5 pr-2 font-medium">학원 기록</th>
              <th className="py-1.5 font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {a.problems.map((p, i) => (
              <tr key={i} className={`border-b border-line last:border-0 ${p.result === "틀림" ? "bg-bad-soft/60" : ""}`}>
                <td className="py-1.5 pr-2 font-semibold tabular-nums">{p.no}</td>
                <td className={`py-1.5 pr-2 font-semibold ${p.result === "틀림" ? "text-bad" : p.result === "맞음" ? "text-good" : "text-ink-faint"}`}>
                  {p.result || "-"}
                </td>
                <td className="py-1.5 pr-2">{[p.unit, p.type].filter(Boolean).join(" › ")}</td>
                <td className="py-1.5 pr-2">{p.difficulty}</td>
                <td className="py-1.5 pr-2 text-ink-soft">{p.related}</td>
                <td className="py-1.5 text-ink-soft">{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.summary && <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.summary}</p>}
      {a.advice && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{a.advice}</p>}
      {a.analyzedAt && <p className="text-xs text-ink-faint">{a.analyzedAt} 분석</p>}
    </div>
  );
}
