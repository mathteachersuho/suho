"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { IconCheck, IconLink, IconPrinter, IconSave, IconSparkle, IconX } from "@/components/Icons";
import type { SavedReport } from "@/lib/savedReports";
import { reportDraftAction, saveReportAction, shareReportAction } from "../actions";

/**
 * 문제 분석 · 선생님 종합 의견. AI 초안을 받아 고칠 수 있고, 인쇄하면 글만 나온다.
 * 저장하면 서버에 남아 어느 기기에서나 다시 보고, 학부모님께 보낼 링크(/r/...)도 만들 수 있다.
 */
type Saved = Pick<SavedReport, "analysis" | "comment" | "shareToken" | "updatedAt"> | null;

const noop = () => () => {};
const origin = () => location.origin;

// 예전(이 컴퓨터에만 저장하던 때)에 쓴 글. 서버에 저장하면 지운다.
const oldKey = (studentId: string, from: string, to: string) => `report:${studentId}:${from}:${to}`;
function readOld(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function parseOld(raw: string | null) {
  try {
    const o = JSON.parse(raw || "{}");
    return { analysis: String(o.analysis || ""), comment: String(o.comment || "") };
  } catch {
    return { analysis: "", comment: "" };
  }
}

export default function ReportNotes({ studentId, from, to, saved }: { studentId: string; from: string; to: string; saved: Saved }) {
  const [analysis, setAnalysis] = useState(saved?.analysis ?? "");
  const [comment, setComment] = useState(saved?.comment ?? "");
  const [base, setBase] = useState({ analysis: saved?.analysis ?? "", comment: saved?.comment ?? "" });
  const [savedAt, setSavedAt] = useState(saved?.updatedAt ?? "");
  const [token, setToken] = useState(saved?.shareToken ?? null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const site = useSyncExternalStore(noop, origin, () => "");
  const key = oldKey(studentId, from, to);
  const oldRaw = useSyncExternalStore(noop, () => readOld(key), () => null);
  const old = parseOld(oldRaw);
  const dirty = analysis !== base.analysis || comment !== base.comment;
  const url = token && site ? `${site}/r/${token}` : "";

  // 저장 안 한 글이 있으면 나가기 전에 묻는다
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const done = (r: { updatedAt?: string; token?: string | null; error?: string }, ok: string) => {
    if (r.error) return setMsg({ error: r.error });
    setBase({ analysis, comment });
    setSavedAt(r.updatedAt ?? "");
    if (r.token !== undefined) setToken(r.token);
    try {
      localStorage.removeItem(key);
    } catch {}
    setMsg({ ok });
  };

  const draft = () => {
    if ((analysis || comment) && !confirm("지금 쓴 글을 AI 초안으로 바꿀까요?")) return;
    setMsg({});
    start(async () => {
      const r = await reportDraftAction(studentId, from, to);
      if (r.error) return setMsg({ error: r.error });
      setAnalysis(r.analysis || "");
      setComment(r.comment || "");
      setMsg({ ok: "초안을 썼어요. 고친 뒤 저장해 주세요." });
    });
  };

  const save = () => {
    setMsg({});
    start(async () => done(await saveReportAction(studentId, from, to, analysis, comment), "저장했어요."));
  };

  const share = (on: boolean) => {
    if (!on && !confirm("링크를 끄면 학부모님께 보낸 주소로 더 이상 볼 수 없어요. 끌까요?")) return;
    if (on && token && !confirm("새 링크를 만들면 예전 링크는 막혀요. 새로 만들까요?")) return;
    setMsg({});
    setCopied(false);
    start(async () =>
      done(await shareReportAction(studentId, from, to, on, analysis, comment), on ? "학부모님께 보낼 링크를 만들었어요." : "링크를 껐어요."),
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setMsg({ error: "복사하지 못했어요. 주소를 길게 눌러 복사해 주세요." });
    }
  };

  return (
    <>
      <div className="space-y-3 rounded-2xl border border-line bg-surface-2/50 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={draft} disabled={pending} className="btn-soft">
            <IconSparkle />
            AI로 초안 쓰기
          </button>
          <button type="button" onClick={save} disabled={pending || !dirty} className="btn-accent">
            <IconSave />
            {dirty ? "저장" : "저장됨"}
          </button>
          <button type="button" onClick={() => window.print()} className="btn-soft">
            <IconPrinter />
            인쇄 · PDF 저장
          </button>
          <span className="text-sm text-ink-faint" aria-live="polite">
            {pending ? "처리하는 중…" : dirty ? "저장하지 않은 글이 있어요" : savedAt ? `${savedAt}에 저장됨` : "아직 저장하지 않았어요"}
          </span>
        </div>
        {!saved && !analysis && !comment && (old.analysis || old.comment) && (
          <button
            type="button"
            onClick={() => {
              setAnalysis(old.analysis);
              setComment(old.comment);
            }}
            className="text-sm font-medium text-accent hover:underline"
          >
            이 컴퓨터에 예전에 쓴 글이 있어요. 불러오기
          </button>
        )}

        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">학부모님께 보낼 링크</p>
          {token ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="학부모 링크" className="field min-w-0 flex-1 py-2 text-sm" />
                <button type="button" onClick={copy} disabled={!url} className="btn-main px-3 py-2">
                  {copied ? <IconCheck /> : <IconLink />}
                  {copied ? "복사됨" : "복사"}
                </button>
                <a href={`/r/${token}`} target="_blank" rel="noreferrer" className="btn-soft px-3 py-2">
                  열어 보기
                </a>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                로그인 없이 이 리포트만 볼 수 있어요. 숫자는 볼 때마다 새로 모으고, 의견은 저장한 글이 보여요.
                <button type="button" onClick={() => share(true)} disabled={pending} className="font-medium text-ink-soft hover:text-ink">
                  새 링크 만들기
                </button>
                <button type="button" onClick={() => share(false)} disabled={pending} className="inline-flex items-center gap-0.5 font-medium text-bad">
                  <IconX className="h-3.5 w-3.5" />
                  링크 끄기
                </button>
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => share(true)} disabled={pending} className="btn-main px-3 py-2">
                <IconLink />
                링크 만들기
              </button>
              <span className="text-xs text-ink-faint">지금 쓴 글을 저장하고, 로그인 없이 볼 수 있는 주소를 만들어요.</span>
            </div>
          )}
        </div>
        {msg.error && <p className="text-sm text-bad">{msg.error}</p>}
        {msg.ok && <p className="text-sm text-good">{msg.ok}</p>}
      </div>
      <Note title="문제 분석" value={analysis} onChange={setAnalysis} rows={9} placeholder="자주 틀리는 유형, 틀린 원인, 앞으로의 지도 계획" />
      <Note title="선생님 종합 의견" value={comment} onChange={setComment} rows={6} placeholder="학부모님께 드리는 말씀" />
    </>
  );
}

function Note({ title, value, onChange, rows, placeholder }: { title: string; value: string; onChange: (v: string) => void; rows: number; placeholder: string }) {
  return (
    <section className={`space-y-2 print:space-y-1 ${value ? "" : "print:hidden"}`}>
      <h3 className="report-h">{title}</h3>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={6000}
        placeholder={placeholder}
        className="field leading-relaxed print:hidden"
      />
      <div className="report-note hidden whitespace-pre-wrap rounded-xl border border-line p-4 leading-relaxed print:block">{value}</div>
    </section>
  );
}
