"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconNote, IconTrash } from "@/components/Icons";
import type { FrameRow, TypeGroup } from "@/lib/taxonomyEdit";
import { deleteFrameAction, moveFrameAction, renameTypeAction } from "./actions";

type Open = { kind: "type"; type: string } | { kind: "edit" | "merge"; type: string; frame: string } | null;

const NEW = "\u0000new";
const show = (s: string, empty: string) => s || empty;
const key = (type: string, frame: string) => `${type}\u0000${frame}`;

/** 한 단원의 유형 › 세부 유형 목록. 줄마다 고치기(이름·설명·유형 옮기기), 합치기, 빈 세부 유형 지우기. */
export default function TypesEditor({ grade, unit, groups }: { grade: string; unit: string; groups: TypeGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const types = groups.map((g) => g.type).filter(Boolean);
  const all = groups.flatMap((g) => g.frames.filter((f) => f.frame).map((f) => ({ type: g.type, ...f })));
  const exists = (type: string, frame: string) => all.some((f) => f.type === type && f.frame === frame);
  const count = (type: string, frame: string) => groups.find((g) => g.type === type)?.frames.find((f) => f.frame === frame)?.n ?? 0;

  const run = (job: () => Promise<{ error?: string; moved?: number; merged?: boolean }>, ok: (r: { moved?: number; merged?: boolean }) => string) =>
    start(async () => {
      const r = await job();
      if (r.error) {
        alert(r.error);
        return;
      }
      setOpen(null);
      setMsg(ok(r));
      router.refresh();
    });

  const bankHref = (type: string, frame?: string) => {
    const q = new URLSearchParams({ grade, unit, type });
    if (frame) q.set("frame", frame);
    return "/teacher/bank?" + q.toString();
  };

  if (!groups.length) return <div className="card py-10 text-center text-sm text-ink-soft">이 단원에는 유형이 없어요.</div>;

  return (
    <div className="space-y-4">
      {msg && (
        <p role="status" className="rounded-xl bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent-strong">
          {msg}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.type} className="card space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">
              {show(g.type, "(유형 없음)")} <span className="text-sm font-medium text-ink-soft tabular-nums">· {g.n}문제</span>
            </h2>
            <button type="button" className="btn-soft px-3 py-1.5" onClick={() => setOpen({ kind: "type", type: g.type })}>
              유형 이름 바꾸기
            </button>
          </div>

          {open?.kind === "type" && open.type === g.type && (
            <RenameType
              from={g.type}
              others={types.filter((t) => t !== g.type)}
              pending={pending}
              onCancel={() => setOpen(null)}
              onSave={(to) => {
                if (types.includes(to) && !confirm(`'${to}' 유형이 이미 있어요. 두 유형을 하나로 합칠까요?\n이름이 같은 세부 유형은 함께 합쳐져요.`)) return;
                run(
                  () => renameTypeAction(grade, unit, g.type, to),
                  (r) => `'${show(g.type, "(유형 없음)")}' 유형을 '${to}'(으)로 바꿨어요. 문제 ${r.moved ?? 0}개가 옮겨졌어요.`,
                );
              }}
            />
          )}

          <ul className="divide-y divide-line">
            {g.frames.map((f) => {
              const here = open && open.kind !== "type" && open.type === g.type && open.frame === f.frame ? open.kind : null;
              return (
                <li key={f.frame} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {show(f.frame, "(세부 유형 없음)")}{" "}
                        <Link href={bankHref(g.type, f.frame)} className="text-sm font-medium text-accent tabular-nums hover:underline">
                          {f.n}문제
                        </Link>
                        {f.n <= 2 && <span className="ml-1.5 whitespace-nowrap rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">문제 적음</span>}
                      </p>
                      {f.description && <p className="mt-0.5 text-sm text-ink-soft">{f.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" className="btn-soft px-2.5 py-1.5" onClick={() => setOpen({ kind: "edit", type: g.type, frame: f.frame })}>
                        <IconNote />
                        고치기
                      </button>
                      <button
                        type="button"
                        className="btn-soft px-2.5 py-1.5"
                        disabled={f.n === 0 || all.length < 2}
                        onClick={() => setOpen({ kind: "merge", type: g.type, frame: f.frame })}
                      >
                        합치기
                      </button>
                      {f.n === 0 && (
                        <button
                          type="button"
                          className="btn-danger px-2.5 py-1.5"
                          disabled={pending}
                          aria-label={`${f.frame} 지우기`}
                          onClick={() => {
                            if (!confirm(`문제가 없는 세부 유형 '${f.frame}'을(를) 지울까요?`)) return;
                            run(
                              () => deleteFrameAction({ grade, unit, type: g.type, frame: f.frame }),
                              () => `'${f.frame}'을(를) 지웠어요.`,
                            );
                          }}
                        >
                          <IconTrash />
                        </button>
                      )}
                    </div>
                  </div>

                  {here === "edit" && (
                    <EditFrame
                      type={g.type}
                      f={f}
                      types={types}
                      pending={pending}
                      onCancel={() => setOpen(null)}
                      onSave={(to, description) => {
                        const merging = exists(to.type, to.frame) && !(to.type === g.type && to.frame === f.frame);
                        if (merging && !confirm(`'${to.type} › ${to.frame}'이(가) 이미 있어요.\n문제 ${f.n}개를 그쪽으로 합칠까요? (설명은 그쪽 것을 써요)`)) return;
                        run(
                          () => moveFrameAction({ grade, unit, type: g.type, frame: f.frame }, to, description),
                          (r) => (r.merged ? `'${to.frame}'(으)로 합쳤어요. 문제 ${r.moved}개가 옮겨졌어요.` : `'${to.frame}'(으)로 저장했어요.`),
                        );
                      }}
                    />
                  )}

                  {here === "merge" && (
                    <MergeFrame
                      type={g.type}
                      f={f}
                      targets={all.filter((t) => !(t.type === g.type && t.frame === f.frame))}
                      pending={pending}
                      onCancel={() => setOpen(null)}
                      onSave={(to) => {
                        const label = show(f.frame, "(세부 유형 없음)");
                        const msg = `'${label}'의 문제 ${f.n}개를 '${to.type} › ${to.frame}'(으)로 옮기고 '${label}'은(는) 없앨까요?\n합친 뒤에는 '${to.frame}' 문제가 ${count(to.type, to.frame) + f.n}개가 돼요.`;
                        if (!confirm(msg)) return;
                        run(
                          () => moveFrameAction({ grade, unit, type: g.type, frame: f.frame }, to),
                          (r) => `'${to.frame}'(으)로 합쳤어요. 문제 ${r.moved}개가 옮겨졌어요.`,
                        );
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

const panel = "mt-3 space-y-3 rounded-xl border border-line bg-surface-2 p-3 sm:p-4";
const label = "block text-sm font-semibold text-ink-soft";

function Buttons({ pending, onCancel, text }: { pending: boolean; onCancel: () => void; text: string }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-soft py-2" onClick={onCancel}>
        취소
      </button>
      <button className="btn-main py-2" disabled={pending}>
        {pending ? "저장하는 중…" : text}
      </button>
    </div>
  );
}

function RenameType({ from, others, pending, onCancel, onSave }: { from: string; others: string[]; pending: boolean; onCancel: () => void; onSave: (to: string) => void }) {
  const [to, setTo] = useState(from);
  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (to.trim() && to.trim() !== from) onSave(to.trim());
      }}
    >
      <label className={label}>
        새 유형 이름
        <input className="field mt-1" value={to} onChange={(e) => setTo(e.target.value)} maxLength={100} list="type-names" autoFocus />
        <datalist id="type-names">
          {others.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <p className="text-sm text-ink-soft">이미 있는 유형 이름을 적으면 두 유형이 하나로 합쳐져요.</p>
      <Buttons pending={pending} onCancel={onCancel} text="바꾸기" />
    </form>
  );
}

function EditFrame({
  type,
  f,
  types,
  pending,
  onCancel,
  onSave,
}: {
  type: string;
  f: FrameRow;
  types: string[];
  pending: boolean;
  onCancel: () => void;
  onSave: (to: { type: string; frame: string }, description: string) => void;
}) {
  const [pick, setPick] = useState(type || NEW);
  const [newType, setNewType] = useState("");
  const [frame, setFrame] = useState(f.frame);
  const [description, setDescription] = useState(f.description);
  const toType = (pick === NEW ? newType : pick).trim();
  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (!toType || !frame.trim()) return alert("유형과 세부 유형 이름을 모두 적어 주세요.");
        onSave({ type: toType, frame: frame.trim() }, description.trim());
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          유형
          <select className="field mt-1" value={pick} onChange={(e) => setPick(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={NEW}>새 유형 만들기…</option>
          </select>
        </label>
        {pick === NEW && (
          <label className={label}>
            새 유형 이름
            <input className="field mt-1" value={newType} onChange={(e) => setNewType(e.target.value)} maxLength={100} />
          </label>
        )}
      </div>
      <label className={label}>
        세부 유형 이름
        <input className="field mt-1" value={frame} onChange={(e) => setFrame(e.target.value)} maxLength={120} />
      </label>
      <label className={label}>
        설명 <span className="font-normal text-ink-faint">(AI가 문제를 분류할 때 참고해요)</span>
        <textarea className="field mt-1 min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </label>
      <Buttons pending={pending} onCancel={onCancel} text="저장" />
    </form>
  );
}

function MergeFrame({
  type,
  f,
  targets,
  pending,
  onCancel,
  onSave,
}: {
  type: string;
  f: FrameRow;
  targets: ({ type: string } & FrameRow)[];
  pending: boolean;
  onCancel: () => void;
  onSave: (to: { type: string; frame: string }) => void;
}) {
  // 같은 유형 안의 세부 유형을 먼저 보여 준다
  const sorted = [...targets].sort((a, b) => Number(b.type === type) - Number(a.type === type));
  const [pick, setPick] = useState(sorted[0] ? key(sorted[0].type, sorted[0].frame) : "");
  const to = sorted.find((t) => key(t.type, t.frame) === pick);
  const byType = [...new Set(sorted.map((t) => t.type))];
  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (to) onSave({ type: to.type, frame: to.frame });
      }}
    >
      <label className={label}>
        &lsquo;{show(f.frame, "(세부 유형 없음)")}&rsquo;의 문제 {f.n}개를 어디로 합칠까요?
        <select className="field mt-1" value={pick} onChange={(e) => setPick(e.target.value)}>
          {byType.map((t) => (
            <optgroup key={t} label={show(t, "(유형 없음)")}>
              {sorted
                .filter((x) => x.type === t)
                .map((x) => (
                  <option key={key(x.type, x.frame)} value={key(x.type, x.frame)}>
                    {x.frame} ({x.n}문제)
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {to?.description && <p className="text-sm text-ink-soft">{to.description}</p>}
      <Buttons pending={pending} onCancel={onCancel} text="합치기" />
    </form>
  );
}
