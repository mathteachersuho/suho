"use client";

import { useEffect, useState } from "react";
import DifficultyBadge from "@/components/DifficultyBadge";
import { weakExtrasAction, type WeakExtra } from "../actions";

/**
 * 숙제 내기 › 모두 같은 문제 + '학생마다 약한 유형 한 문제씩 더하기'.
 * 켜면 고른 학생마다 전에 틀린 유형에서 한 문제씩 골라 보여 주고, 같이 내는 문제 뒤에 붙인다.
 * 고른 학생이나 같이 내는 문제가 바뀌면 다시 고른다.
 */
export default function PersonalWeak({
  on,
  onToggle,
  studentIds,
  common,
  nameOf,
  onExtras,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  studentIds: string[];
  common: string[];
  nameOf: (id: string) => string;
  onExtras: (x: WeakExtra[] | null) => void;
}) {
  const [extras, setExtras] = useState<{ key: string; list: WeakExtra[] } | null>(null);
  const [error, setError] = useState("");
  const key = `${studentIds.join(",")}|${common.join(",")}`;
  const ready = on && extras?.key === key ? extras.list : null;

  useEffect(() => {
    let alive = true;
    if (!on || !studentIds.length) return;
    onExtras(null); // 다시 고르는 동안은 낼 수 없게
    const [stu, com] = key.split("|");
    weakExtrasAction(stu.split(","), com ? com.split(",") : []).then((r) => {
      if (!alive) return;
      if ("error" in r) {
        setError(r.error);
        onExtras(null);
      } else {
        setError("");
        setExtras({ key, list: r });
        onExtras(r);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 가 학생과 문제를 모두 담는다
  }, [on, key]);

  const total = ready?.reduce((a, x) => a + x.items.length, 0) ?? 0;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${on ? "border-accent/40 bg-accent-soft/40" : "border-line"}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            onToggle(e.target.checked);
            if (!e.target.checked) onExtras(null);
          }}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
        />
        <span>
          <span className="block font-semibold">학생마다 약한 유형 한 문제씩 더하기</span>
          <span className="block text-sm text-ink-soft">
            아래에서 고른 문제는 모두 같이 받고, 학생마다 전에 틀렸거나 어려워한 유형에서 아직 안 받은 문제를 한 문제씩 더해요. 학생마다 숙제가 따로 나가고, 학습지도 학생별로 한꺼번에 인쇄할 수 있어요.
          </span>
        </span>
      </label>

      {on && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {!studentIds.length ? (
            <p className="text-sm text-ink-faint">위에서 받는 학생을 먼저 골라 주세요.</p>
          ) : error ? (
            <p className="text-sm text-bad">{error}</p>
          ) : !ready ? (
            <p className="text-sm text-ink-soft">학생마다 약한 유형을 찾는 중…</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                학생마다 더할 문제 {total}개{ready.some((x) => x.types > x.items.length) && " · 은행에 안 받은 문제가 없는 유형은 빠졌어요"}
              </p>
              <ul className="space-y-1.5">
                {ready.map((x) => (
                  <li key={x.studentId}>
                    <details className="group rounded-xl border border-line bg-surface">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                        <span className="font-semibold">{nameOf(x.studentId)}</span>
                        {x.items.length ? (
                          <>
                            <span className="text-accent">+{x.items.length}문제</span>
                            <span className="min-w-0 truncate text-ink-soft">{x.items.map((q) => q.tag.split(" · ")[0]).join(", ")}</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">{x.untyped ? "틀린 문제에 유형이 없어 더할 문제가 없어요" : "약한 유형이 없어 같은 문제만 받아요"}</span>
                        )}
                      </summary>
                      {x.items.length > 0 && (
                        <ol className="space-y-2 border-t border-line px-3 py-2">
                          {x.items.map((q, i) => (
                            <li key={q.id} className="flex gap-2">
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-soft">+{i + 1}</span>
                              <div className="min-w-0 flex-1">
                                <p className="mb-1 flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink-soft">
                                  <DifficultyBadge level={q.difficulty} />
                                  {q.tag}
                                </p>
                                <div className="problem-body line-clamp-3 text-sm" dangerouslySetInnerHTML={{ __html: q.html }} />
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
