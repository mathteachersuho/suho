"use client";

import { useEffect, useState } from "react";
import { addDays, dayLabel, todaySeoul } from "@/lib/hwFormat";
import type { WeakScope } from "@/lib/weak";
import { recentHomeworkAction } from "../actions";

/** 약한 유형을 찾을 범위: 모든 숙제 / 낸 날 기간 / 고른 숙제 */
export type ScopeChoice = { kind: "all" } | { kind: "range"; from: string; to: string } | { kind: "hw"; hwIds: string[] };
export const ALL_SCOPE: ScopeChoice = { kind: "all" };

/** 서버에 넘길 범위 (모든 숙제면 null) */
export function toWeakScope(c: ScopeChoice): WeakScope | null {
  if (c.kind === "range") return { from: c.from || undefined, to: c.to || undefined };
  if (c.kind === "hw") return { hwIds: c.hwIds };
  return null;
}

/** 범위를 아직 다 못 골랐으면 (숙제를 하나도 안 골랐으면) 찾지 않는다 */
export const scopeReady = (c: ScopeChoice) => c.kind !== "hw" || c.hwIds.length > 0;

const KINDS: { kind: ScopeChoice["kind"]; label: string }[] = [
  { kind: "all", label: "모든 숙제" },
  { kind: "range", label: "기간 정하기" },
  { kind: "hw", label: "숙제 고르기" },
];
const QUICK = [
  { days: 14, label: "최근 2주" },
  { days: 30, label: "최근 1달" },
  { days: 90, label: "최근 3달" },
  { days: 180, label: "최근 6달" },
];

export default function WeakScopePicker({ value, onChange, studentIds }: { value: ScopeChoice; onChange: (c: ScopeChoice) => void; studentIds: string[] }) {
  const today = todaySeoul();
  const [hws, setHws] = useState<{ key: string; list: { hwId: string; title: string; day: string }[] } | null>(null);
  const stuKey = studentIds.join(",");
  const wantHw = value.kind === "hw";
  useEffect(() => {
    let alive = true;
    if (!wantHw || !stuKey) return;
    recentHomeworkAction(stuKey.split(",")).then((list) => alive && setHws({ key: stuKey, list }));
    return () => {
      alive = false;
    };
  }, [wantHw, stuKey]);
  const list = hws?.key === stuKey ? hws.list : null;

  const pick = (kind: ScopeChoice["kind"]) =>
    onChange(kind === "range" ? { kind, from: addDays(today, -30), to: today } : kind === "hw" ? { kind, hwIds: [] } : ALL_SCOPE);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-soft">틀린 유형을 찾을 곳</span>
        <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="틀린 유형을 찾을 곳">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={value.kind === k.kind}
              onClick={() => value.kind !== k.kind && pick(k.kind)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${value.kind === k.kind ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {value.kind === "range" && (
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((q) => {
            const from = addDays(today, -q.days);
            const on = value.from === from && value.to === today;
            return (
              <button
                key={q.days}
                type="button"
                onClick={() => onChange({ kind: "range", from, to: today })}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent-soft font-semibold" : "border-line text-ink-soft hover:bg-surface-2"}`}
              >
                {q.label}
              </button>
            );
          })}
          <span className="flex items-center gap-1.5 text-sm">
            <input type="date" aria-label="시작 날짜" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className="field w-auto py-1" />
            <span className="text-ink-soft">~</span>
            <input type="date" aria-label="끝 날짜" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className="field w-auto py-1" />
          </span>
        </div>
      )}

      {value.kind === "hw" &&
        (!studentIds.length ? (
          <p className="text-sm text-ink-faint">받는 학생을 먼저 골라 주세요.</p>
        ) : !list ? (
          <p className="text-sm text-ink-soft">숙제를 불러오는 중…</p>
        ) : !list.length ? (
          <p className="text-sm text-ink-faint">고른 학생이 받은 숙제가 아직 없어요.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm text-ink-soft">
              {value.hwIds.length ? `숙제 ${value.hwIds.length}개에서 틀린 유형을 찾아요.` : "틀린 유형을 찾을 숙제를 골라 주세요."}
              {value.hwIds.length > 0 && (
                <button type="button" className="ml-2 text-accent underline" onClick={() => onChange({ kind: "hw", hwIds: [] })}>
                  모두 해제
                </button>
              )}
            </p>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
              {list.map((h) => {
                const on = value.hwIds.includes(h.hwId);
                return (
                  <li key={h.hwId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => onChange({ kind: "hw", hwIds: on ? value.hwIds.filter((x) => x !== h.hwId) : [...value.hwIds, h.hwId] })}
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className="w-24 shrink-0 text-ink-soft">{dayLabel(h.day)}</span>
                      <span className="min-w-0 truncate">{h.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}
