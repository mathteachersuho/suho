"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { IconArrow, IconCheck, IconPlus } from "@/components/Icons";
import { DIFFICULTIES } from "@/lib/difficulty";
import type { CardResult, Suggestion } from "@/lib/create";
import { generateAction, ocrAction, regenerateAction, saveAction } from "./actions";
import ClassPicker from "./ClassPicker";
import { shrinkImage } from "./image";
import type { Classification, Source } from "./types";
import { usePreview } from "./usePreview";

type Tax = { grade: string; unit: string; type: string; frame: string; description: string };

type Card = {
  source: Source;
  label: string;
  question: string;
  answer: string;
  solution: string;
  error?: string;
  include: boolean;
  difficulty: string;
  verified: boolean;
  editing: boolean;
  busy: boolean;
};

const KIND: Record<Source, 0 | 1 | 2> = { 원본: 0, "AI 기본": 1, "AI 실력": 2 };
const EMPTY_CLS: Classification = { grade: "", unit: "", type: "", frame: "", description: "" };
const SEMESTERS = ["1학기", "2학기", "공통"];

function newGroupId() {
  // Streamlit 과 같은 모양의 저장 번호 (밀리초 + 'x' + 여섯 자리)
  return `${Date.now()}x${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-4 flex items-center gap-2.5 text-base font-semibold">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-good text-white" : "bg-ink text-bg"}`}
        >
          {done ? <IconCheck className="h-3.5 w-3.5" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}

export default function CreateFlow({ taxonomy, semesters }: { taxonomy: Tax[]; semesters: Record<string, string> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<{ b64: string; url: string } | null>(null);
  const [text, setText] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [rebuilt, setRebuilt] = useState(true);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [cls, setCls] = useState<Classification>(EMPTY_CLS);
  const [semester, setSemester] = useState("");
  const [groupId, setGroupId] = useState("");
  const [saved, setSaved] = useState<{ count: number; duplicate?: boolean } | null>(null);
  const [ocrPending, startOcr] = useTransition();
  const [genPending, startGen] = useTransition();
  const [savePending, startSave] = useTransition();

  const textHtml = usePreview([text]);
  const cardHtml = usePreview(cards ? cards.flatMap((c) => [c.question, c.answer, c.solution]) : []);

  const resetResult = () => {
    setCards(null);
    setSaved(null);
    setSuggestion(null);
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      const img = await shrinkImage(f);
      setImage(img);
      setText("");
      setTextOpen(false);
      resetResult();
      startOcr(async () => {
        const r = await ocrAction(img.b64);
        if ("error" in r) setError(r.error);
        else {
          setText(r.text);
          setTextOpen(true);
        }
      });
    } catch {
      setError("사진을 열지 못했어요. 다른 사진으로 해 보세요.");
    }
  };

  const generate = () => {
    setError("");
    resetResult();
    startGen(async () => {
      const r = await generateAction({ text, imageB64: image?.b64, detailed });
      if ("error" in r) {
        setError(r.error ?? "");
        return;
      }
      const { original, originalRebuilt, p1, p2, suggestion: sug } = r.result;
      const diff = sug?.difficulty || "중";
      const up = DIFFICULTIES[Math.min(DIFFICULTIES.indexOf(diff as (typeof DIFFICULTIES)[number]) + 1, 2)];
      const base = { include: true, verified: false, editing: false, busy: false };
      const fromCard = (c: CardResult) => (c.ok ? { ...c.data } : { question: "", answer: "", solution: "", error: c.error });
      setCards([
        { ...base, source: "원본", label: "원본 문제", ...original, difficulty: diff },
        { ...base, source: "AI 기본", label: "유사문제 1 · 기본 다지기", ...fromCard(p1), difficulty: diff, include: p1.ok },
        { ...base, source: "AI 실력", label: "유사문제 2 · 실력 키우기", ...fromCard(p2), difficulty: up, include: p2.ok },
      ]);
      setRebuilt(originalRebuilt);
      setSuggestion(sug);
      const next = sug ? { grade: sug.grade, unit: sug.unit, type: sug.type, frame: sug.frame, description: sug.description } : EMPTY_CLS;
      setCls(next);
      setSemester(sug?.semester || semesters[`${next.grade}\u0000${next.unit}`] || "");
      setGroupId(newGroupId());
    });
  };

  const update = (i: number, patch: Partial<Card>) => setCards((cs) => cs && cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const regenerate = async (i: number) => {
    if (!cards) return;
    update(i, { busy: true });
    const r = await regenerateAction({ kind: KIND[cards[i].source], text, imageB64: image?.b64, detailed });
    if (r.ok) update(i, { ...r.data, error: undefined, busy: false, include: true });
    else update(i, { busy: false, error: r.error });
    setGroupId(newGroupId());
    setSaved(null);
  };

  const save = () => {
    if (!cards) return;
    setError("");
    startSave(async () => {
      const items = cards
        .filter((c) => c.include && !c.error)
        .map((c) => ({
          source: c.source,
          question: c.question,
          answer: c.answer,
          solution: c.solution,
          difficulty: c.difficulty,
          verified: c.verified,
          cls,
        }));
      const r = await saveAction({ groupId, semester, items });
      if (r.ok) setSaved({ count: r.ids.length, duplicate: r.duplicate });
      else setError(r.error);
    });
  };

  const startOver = () => {
    setImage(null);
    setText("");
    setTextOpen(false);
    setError("");
    resetResult();
    if (fileRef.current) fileRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const chosen = cards?.filter((c) => c.include && !c.error).length ?? 0;
  const clsReady = !!(cls.grade && cls.unit && cls.type && cls.frame);

  return (
    <div className="space-y-4">
      {/* 1. 사진 */}
      <Step n={1} title="문제 사진 올리기" done={!!text}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <label className="flex min-h-36 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/50 p-4 text-center hover:bg-surface-2">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.url} alt="올린 문제 사진" className="max-h-64 rounded-lg object-contain" />
            ) : (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-ink-soft">
                  <IconPlus className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium">사진 찍기 또는 고르기</span>
                <span className="text-xs text-ink-faint">문제 하나만 보이게 찍으면 더 정확해요</span>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <div className="space-y-2 sm:w-56">
            {ocrPending ? (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <Spinner /> 글자와 수식을 읽는 중…
              </p>
            ) : image ? (
              <button type="button" className="btn-soft w-full" onClick={() => fileRef.current?.click()}>
                다른 사진으로
              </button>
            ) : null}
            {!image && !textOpen && (
              <button type="button" className="w-full text-left text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline" onClick={() => setTextOpen(true)}>
                사진 없이 글자로 입력하기
              </button>
            )}
          </div>
        </div>
      </Step>

      {/* 2. 글자 확인 */}
      {textOpen && (
        <Step n={2} title="읽은 글자 확인하고 만들기" done={!!cards}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-soft">문제 글자 (빠진 조건이나 틀린 수식을 고쳐 주세요)</span>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (cards) resetResult();
                }}
                rows={9}
                className="field font-mono text-sm leading-relaxed"
                placeholder="문제를 입력하세요. 수식은 $x^2+1$ 처럼 $ 로 감싸요."
              />
            </label>
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-soft">미리 보기</span>
              <div className="problem-body min-h-40 rounded-xl border border-line p-4" dangerouslySetInnerHTML={{ __html: textHtml[0] || "" }} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} className="h-4 w-4 accent-accent" />
              단계별 상세 풀이 (끄면 핵심 풀이만)
            </label>
            <button type="button" className="btn-main ml-auto" disabled={!text.trim() || genPending} onClick={generate}>
              {genPending ? (
                <>
                  <Spinner /> 만드는 중… (보통 10~30초)
                </>
              ) : (
                <>
                  원본 다시 쓰기 + 유사문제 2개 만들기 <IconArrow />
                </>
              )}
            </button>
          </div>
        </Step>
      )}

      {error && <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p>}

      {/* 3. 확인하고 저장 */}
      {cards && (
        <Step n={3} title="확인하고 문제 은행에 저장" done={!!saved}>
          <div className="space-y-5">
            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">분류</p>
                {suggestion ? (
                  <p className="text-xs text-ink-faint">
                    AI 제안: {[suggestion.grade, suggestion.unit, suggestion.type, suggestion.frame].join(" › ")}
                    {suggestion.isNewFrame ? " (새 문제틀)" : " (기존 문제틀)"}
                  </p>
                ) : (
                  <p className="text-xs text-bad">AI가 분류하지 못했어요. 직접 적어 주세요.</p>
                )}
              </div>
              <ClassPicker id="cls" value={cls} onChange={setCls} taxonomy={taxonomy} />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-ink-soft">이 단원을 배우는 학기</span>
                <select value={semester} onChange={(e) => setSemester(e.target.value)} className="field w-auto py-1.5">
                  <option value="">정하지 않음</option>
                  {SEMESTERS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {cards.map((c, i) => (
              <article key={c.source} className={`rounded-xl border p-4 ${c.include && !c.error ? "border-line" : "border-line opacity-70"}`}>
                <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex cursor-pointer items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={c.include && !c.error}
                      disabled={!!c.error}
                      onChange={(e) => update(i, { include: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    {c.label}
                  </label>
                  {c.source === "원본" && !rebuilt && (
                    <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs text-ink-soft">다시 쓰기 실패 · 읽은 글자 그대로</span>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <select
                      value={c.difficulty}
                      onChange={(e) => update(i, { difficulty: e.target.value })}
                      className="field w-auto py-1.5 text-sm"
                      aria-label="난이도"
                    >
                      {DIFFICULTIES.map((d) => (
                        <option key={d} value={d}>
                          난이도 {d}
                        </option>
                      ))}
                    </select>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-soft" title="정답과 풀이까지 확인한 문제만 체크하세요">
                      <input type="checkbox" checked={c.verified} onChange={(e) => update(i, { verified: e.target.checked })} className="h-4 w-4 accent-accent" />
                      검토함
                    </label>
                    <button type="button" className="btn-soft px-2.5 py-1.5" onClick={() => update(i, { editing: !c.editing })} disabled={!!c.error}>
                      {c.editing ? "고치기 닫기" : "고치기"}
                    </button>
                    <button type="button" className="btn-soft px-2.5 py-1.5" onClick={() => regenerate(i)} disabled={c.busy || !text.trim()}>
                      {c.busy ? <Spinner /> : null}
                      다시 만들기
                    </button>
                  </div>
                </header>

                {c.error ? (
                  <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{c.error}</p>
                ) : (
                  <>
                    <div className="problem-body" dangerouslySetInnerHTML={{ __html: cardHtml[i * 3] ?? "" }} />
                    {(c.answer || c.solution) && (
                      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                        <div className="flex gap-2">
                          <span className="shrink-0 font-semibold">정답</span>
                          <div className="problem-body" dangerouslySetInnerHTML={{ __html: cardHtml[i * 3 + 1] ?? "" }} />
                        </div>
                        {c.solution && <div className="problem-body text-ink-soft" dangerouslySetInnerHTML={{ __html: cardHtml[i * 3 + 2] ?? "" }} />}
                      </div>
                    )}
                    {c.editing && (
                      <div className="mt-4 grid gap-2.5 border-t border-line pt-4">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink-soft">문제</span>
                          <textarea value={c.question} onChange={(e) => update(i, { question: e.target.value })} rows={6} className="field font-mono text-sm" />
                        </label>
                        <div className="grid gap-2.5 sm:grid-cols-[1fr_2fr]">
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-ink-soft">정답</span>
                            <textarea value={c.answer} onChange={(e) => update(i, { answer: e.target.value })} rows={3} className="field font-mono text-sm" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-ink-soft">풀이</span>
                            <textarea value={c.solution} onChange={(e) => update(i, { solution: e.target.value })} rows={3} className="field font-mono text-sm" />
                          </label>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            ))}

            {saved ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft p-4">
                <p className="text-sm font-medium">
                  {saved.duplicate ? "이미 저장된 문제예요. 두 번 저장하지 않았어요." : `문제 은행에 ${saved.count}문제를 저장했어요.`}
                </p>
                <div className="ml-auto flex gap-2">
                  <Link href={`/teacher/bank?grade=${encodeURIComponent(cls.grade)}&unit=${encodeURIComponent(cls.unit)}`} className="btn-soft py-2">
                    문제 은행에서 보기
                  </Link>
                  <button type="button" className="btn-main py-2" onClick={startOver}>
                    새 문제 만들기
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {!clsReady && <p className="text-sm text-ink-soft">학년·단원·유형·문제틀을 모두 정하면 저장할 수 있어요.</p>}
                <button type="button" className="btn-accent" disabled={!chosen || !clsReady || savePending} onClick={save}>
                  {savePending ? <Spinner /> : <IconCheck />}
                  {chosen}문제 저장하기
                </button>
              </div>
            )}
          </div>
        </Step>
      )}
    </div>
  );
}
