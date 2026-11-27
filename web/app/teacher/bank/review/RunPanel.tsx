"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh, IconSparkle, IconX } from "@/components/Icons";
import { startRunAction, stopRunAction } from "./actions";

export type RunView = {
  runId: string;
  trigger: "manual" | "cron";
  status: "running" | "done" | "stopped" | "failed";
  total: number;
  pos: number;
  checked: number;
  autoFixed: number;
  queued: number;
  failed: number;
  note: string;
  startedAt: string; // 화면에 쓸 글 (서울 시간)
  stale: boolean;
  guidelineVersion: number;
};

/** 점검 현황: 지금 점검 버튼(문제 수), 진행 막대, 멈추기·이어서 하기. 점검 중이면 10초마다 새로 고친다 */
export default function RunPanel({ run, sizes }: { run: RunView | null; sizes: readonly number[] }) {
  const router = useRouter();
  const [size, setSize] = useState(sizes[1] ?? sizes[0]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const running = run?.status === "running";

  useEffect(() => {
    if (!running || run?.stale) return;
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [running, run?.stale, router]);

  const go = () =>
    start(async () => {
      setMsg(null);
      const r = await startRunAction(size);
      setMsg(r.ok ? { ok: true, text: r.note ?? "시작했어요." } : { ok: false, text: r.error });
      router.refresh();
    });
  const stop = () =>
    run &&
    window.confirm("점검을 멈출까요? 이미 고친 것과 확인함에 넣은 것은 그대로 남아요.") &&
    start(async () => {
      const r = await stopRunAction(run.runId);
      if (!r.ok) setMsg({ ok: false, text: r.error });
      router.refresh();
    });

  const pct = run && run.total ? Math.round((Math.min(run.pos, run.total) / run.total) * 100) : 0;
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">점검하기</h2>
        <span className="text-sm text-ink-soft">매주 월요일 오전 6시에 자동으로 150문제씩 봐요.</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {running && !run!.stale ? (
            <button type="button" className="btn-danger py-2" onClick={stop} disabled={pending}>
              <IconX />
              멈추기
            </button>
          ) : (
            <>
              {!running && (
                <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="field w-auto py-2" aria-label="점검할 문제 수">
                  {sizes.map((n) => (
                    <option key={n} value={n}>
                      {n}문제
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn-main py-2" onClick={go} disabled={pending}>
                {running ? <IconRefresh /> : <IconSparkle />}
                {pending ? "시작하는 중…" : running ? "이어서 하기" : "지금 점검"}
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}

      {run ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium">
              {running ? (run.stale ? "멈춘 것 같아요" : "점검 중") : run.status === "done" ? "지난 점검" : run.status === "stopped" ? "멈춘 점검" : "실패한 점검"}
            </span>
            <span className="text-ink-faint">
              {run.startedAt} · {run.trigger === "cron" ? "매주 자동" : "직접 시작"} · 기준 {run.guidelineVersion ? `${run.guidelineVersion}번` : "처음 기준"}
            </span>
          </div>
          {run.total > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="text-ink-soft">
            {run.total}문제 중 {run.checked}문제를 봤어요 · 자동으로 고침 <b className="text-ink">{run.autoFixed}</b> · 확인할 것 <b className="text-ink">{run.queued}</b>
            {run.failed > 0 && <span className="text-warn"> · 못 본 문제 {run.failed}</span>}
          </p>
          {run.stale && <p className="text-warn">몇 분째 진행이 없어요. &apos;이어서 하기&apos;를 누르면 남은 문제부터 다시 봐요.</p>}
          {run.note && <p className="text-ink-faint">{run.note}</p>}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">아직 점검한 적이 없어요. &apos;지금 점검&apos;을 눌러 보세요.</p>
      )}
    </section>
  );
}
