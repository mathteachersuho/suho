"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { IconSparkle } from "@/components/Icons";
import { DIFFICULTIES } from "@/lib/difficulty";
import type { UnitCount } from "@/lib/quick";
import { randomPickAction, unitCountsAction, type RandomPick } from "../actions";
import type { OutlineRow } from "./WeakPlanner";

const uniq = (xs: string[]) => [...new Set(xs)];
const keyOf = (type: string, frame: string, diff: string) => `${type}\u0000${frame}\u0000${diff}`;

/**
 * 숙제 내기 › 모두 같은 문제 › 무작위로 뽑기.
 * 학년·단원을 고르면 그 단원의 유형 › 세부 유형마다 난이도별 문제 수가 줄줄이 나오고,
 * 칸마다 낼 문제 수를 적어 한 번에 뽑는다. 받는 학생이 안 받은 문제를 먼저 무작위로 고른다.
 */
export default function RandomPicker({
  outline,
  studentIds,
  chosen,
  onAdd,
}: {
  outline: OutlineRow[];
  studentIds: string[];
  chosen: string[]; // 이미 고른 문제 (다시 뽑지 않는다)
  onAdd: (items: RandomPick["items"]) => void;
}) {
  const [grade, setGrade] = useState("");
  const [unit, setUnit] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [counts, setCounts] = useState<UnitCount[] | null>(null);
  const [want, setWant] = useState<Record<string, number>>({});
  const [note, setNote] = useState<{ error?: string; short?: RandomPick["short"]; added?: number }>({});
  const [busy, start] = useTransition();

  const stuKey = studentIds.join(",");
  useEffect(() => {
    let alive = true;
    if (!grade || !unit) Promise.resolve().then(() => alive && setCounts(null));
    else unitCountsAction(grade, unit, stuKey ? stuKey.split(",") : [], verifiedOnly).then((c) => alive && setCounts(c));
    return () => {
      alive = false;
    };
  }, [grade, unit, stuKey, verifiedOnly]);

  const grades = uniq(outline.map((o) => o.grade));
  const units = uniq(outline.filter((o) => o.grade === grade).map((o) => o.unit));
  const diffs = [...DIFFICULTIES, ...(counts?.some((c) => !c.difficulty) ? [""] : [])];
  const types = uniq((counts ?? []).map((c) => c.type));
  const total = Object.values(want).reduce((a, n) => a + n, 0);

  const pickPlace = (g: string, u: string) => {
    setGrade(g);
    setUnit(u);
    setWant({});
    setNote({});
  };

  const draw = () => {
    setNote({});
    const rows = Object.entries(want)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => {
        const [type, frame, difficulty] = k.split("\u0000");
        return { grade, unit, type, frame, difficulty, count: n };
      });
    start(async () => {
      const r = await randomPickAction(rows, studentIds, verifiedOnly, chosen);
      if ("error" in r) return setNote({ error: r.error });
      onAdd(r.items);
      setWant({});
      setNote({ short: r.short, added: r.items.length });
    });
  };

  const sel = "field w-auto py-1.5 text-sm";
  const cols = { "--n": diffs.length } as React.CSSProperties;
  // 휴대폰에서는 숫자 칸을 좁혀 유형 이름 자리를 넓힌다
  const grid = "grid items-center gap-x-1.5 [grid-template-columns:minmax(0,1fr)_repeat(var(--n),3.25rem)] sm:gap-x-2 sm:[grid-template-columns:minmax(0,1fr)_repeat(var(--n),4.75rem)]";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">무작위로 뽑기</h3>
        <p className="mt-0.5 text-xs text-ink-faint">학년과 단원을 고르면 유형마다 문제 수가 나와요. 낼 문제 수를 적으면 받는 학생이 안 푼 문제를 무작위로 골라 위에 더해요.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="뽑을 학년" value={grade} onChange={(e) => pickPlace(e.target.value, "")} className={sel}>
          <option value="">학년 고르기</option>
          {grades.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select aria-label="뽑을 단원" value={unit} disabled={!grade} onChange={(e) => pickPlace(grade, e.target.value)} className={`${sel} max-w-[14rem]`}>
          <option value="">단원 고르기</option>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-1 text-sm text-ink-soft">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => (setVerifiedOnly(e.target.checked), setWant({}))} className="h-4 w-4 accent-accent" />
          검수한 문제만
        </label>
      </div>

      {grade && unit && !counts && <p className="text-sm text-ink-faint">문제 수를 세는 중…</p>}
      {counts && !counts.length && <p className="text-sm text-ink-faint">이 단원에는 문제가 없어요.</p>}
      {counts && counts.length > 0 && (
        <div className={`overflow-hidden rounded-xl border border-line text-sm ${busy ? "opacity-60" : ""}`}>
          <div className={`${grid} bg-surface-2 px-3 py-2 text-xs font-medium text-ink-soft`} style={cols}>
            <span>
              유형<span className="hidden sm:inline"> › 세부 유형</span>
            </span>
            {diffs.map((d) => (
              <span key={d || "none"} className="text-center">
                {d || "난이도 없음"}
              </span>
            ))}
          </div>
          {types.map((type) => {
            const rows = counts.filter((c) => c.type === type);
            const frames = uniq(rows.map((c) => c.frame));
            const flat = frames.length === 1 && frames[0] === ""; // 세부 유형이 없으면 유형 한 줄로
            const sum = rows.reduce((a, c) => a + c.n, 0);
            return (
              <Fragment key={type}>
                {!flat && (
                  <div className="border-t border-line px-3 pt-2.5 pb-1 text-xs font-semibold">
                    {type || "유형 없음"} <span className="font-normal text-ink-faint">{sum}문제</span>
                  </div>
                )}
                {frames.map((frame) => (
                  <div key={frame} className={`${grid} px-3 py-1.5 ${flat ? "border-t border-line py-2" : ""}`} style={cols}>
                    <span className={`min-w-0 break-keep ${flat ? "text-xs font-semibold" : "pl-3 text-xs text-ink-soft"}`}>
                      {flat ? (
                        <>
                          {type || "유형 없음"} <span className="font-normal text-ink-faint">{sum}문제</span>
                        </>
                      ) : (
                        frame || "세부 유형 없음"
                      )}
                    </span>
                    {diffs.map((d) => {
                      const c = rows.find((x) => x.frame === frame && x.difficulty === d);
                      const k = keyOf(type, frame, d);
                      if (!c) return <span key={d || "none"} className="text-center text-ink-faint">–</span>;
                      return (
                        <label key={d || "none"} className="flex flex-col items-center gap-0.5">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={c.n}
                            value={want[k] || ""}
                            placeholder="0"
                            onChange={(e) => setWant({ ...want, [k]: Math.min(c.n, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                            aria-label={`${type} ${frame} ${d || "난이도 없음"} 낼 문제 수`}
                            className={`field h-8 w-full px-1 py-0 text-center text-sm tabular-nums ${want[k] ? "border-accent" : ""}`}
                          />
                          <span className="text-[11px] leading-tight whitespace-nowrap text-ink-faint tabular-nums">
                            {c.n}개{c.fresh < c.n && <span className="text-warn">·새{c.fresh}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </Fragment>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/60 px-3 py-2.5">
            <span className="text-xs text-ink-faint">칸 아래 숫자는 은행에 있는 문제 수, “새”는 고른 학생이 아직 안 받은 문제 수예요.</span>
            <button type="button" className="btn-main ml-auto py-2" disabled={!total || busy} onClick={draw}>
              <IconSparkle />
              {busy ? "뽑는 중…" : total ? `${total}문제 뽑아서 더하기` : "뽑을 문제 수를 적어 주세요"}
            </button>
          </div>
        </div>
      )}
      {note.error && <p className="text-sm text-bad">{note.error}</p>}
      {note.added !== undefined && (
        <div className="space-y-0.5 text-xs">
          <p className="text-good">{note.added}문제를 무작위로 뽑아 위 목록에 더했어요.</p>
          {note.short?.map((s) => (
            <p key={s.label} className="text-warn">
              {s.label}: {s.got < s.want ? `${s.want}문제 중 ${s.got}문제만 남아 있었어요.` : ""}
              {s.fresh < s.got ? ` 안 푼 문제가 모자라 받은 적 있는 문제 ${s.got - s.fresh}개가 섞였어요.` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
