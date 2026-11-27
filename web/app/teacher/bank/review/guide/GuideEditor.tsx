"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconSave } from "@/components/Icons";
import { saveGuideAction } from "../actions";

type Old = { version: number; body: string; note: string; when: string; autoKinds: string[] };

/** 기준 글 고치기 + 자동으로 고칠 종류 고르기 + 지난 버전 보기·불러오기 */
export default function GuideEditor({
  version,
  body,
  autoKinds,
  kinds,
  defaultBody,
  history,
}: {
  version: number;
  body: string;
  autoKinds: string[];
  kinds: { k: string; label: string; never: boolean }[];
  defaultBody: string;
  history: Old[];
}) {
  const router = useRouter();
  const [text, setText] = useState(body);
  const [auto, setAuto] = useState(new Set(autoKinds));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = text !== body || [...auto].sort().join() !== [...autoKinds].sort().join();

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveGuideAction(text, [...auto], note);
      setMsg(r.ok ? { ok: true, text: r.note ?? "저장했어요." } : { ok: false, text: r.error });
      if (r.ok) {
        setNote("");
        router.refresh();
      }
    });
  const toggle = (k: string) => {
    const s = new Set(auto);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setAuto(s);
  };

  return (
    <>
      <section className="card space-y-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-semibold">지금 기준</h2>
          <span className="text-sm text-ink-soft">{version ? `${version}번째 버전` : "처음 기준 (아직 저장한 적 없음)"}</span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={22} maxLength={20_000} className="field text-sm leading-relaxed" />

        <div className="space-y-2">
          <p className="text-sm font-semibold">확인 없이 바로 고칠 종류</p>
          <p className="text-xs text-ink-soft">
            고른 종류만 있는 수정은 바로 고치고(되돌리기 가능), 나머지는 확인함에 넣어요. 고른 종류라도 정답이나 지문·풀이의 숫자가 바뀌면, 또 검수한 문제면 확인함으로 가요.
          </p>
          <div className="flex flex-wrap gap-2">
            {kinds.map(({ k, label, never }) => (
              <label
                key={k}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${never ? "border-line text-ink-faint" : "cursor-pointer border-line"}`}
                title={never ? "정답·지문 내용·분류는 항상 선생님이 확인해요" : undefined}
              >
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={!never && auto.has(k)} disabled={never} onChange={() => toggle(k)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="무엇을 바꿨는지 짧게 (선택)" className="field max-w-sm flex-1" />
          <button type="button" className="btn-main" onClick={save} disabled={pending || !text.trim() || (!dirty && version > 0)}>
            <IconSave />
            {pending ? "저장하는 중…" : "새 버전으로 저장"}
          </button>
          {text !== defaultBody && (
            <button type="button" className="btn-soft" onClick={() => setText(defaultBody)} disabled={pending}>
              처음 기준 불러오기
            </button>
          )}
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">지난 버전</h2>
          <div className="space-y-2">
            {history.map((h) => (
              <details key={h.version} className="rounded-2xl border border-line bg-surface">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold">{h.version}번</span>
                  <span className="text-ink-faint">{h.when}</span>
                  {h.note && <span className="text-ink-soft">{h.note}</span>}
                  {h.version === version && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">지금</span>}
                </summary>
                <div className="space-y-2 border-t border-line px-4 py-3">
                  <p className="text-xs text-ink-soft">바로 고칠 종류: {h.autoKinds.join(", ") || "없음"}</p>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">{h.body}</pre>
                  {h.version !== version && (
                    <button
                      type="button"
                      className="btn-soft py-1.5"
                      onClick={() => {
                        setText(h.body);
                        setNote(`${h.version}번으로 되돌림`);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      이 버전 불러오기
                    </button>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
