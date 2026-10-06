"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconArrow, IconClipboard } from "@/components/Icons";
import StudentPicker, { type PickStudent } from "@/components/StudentPicker";
import { addDays } from "@/lib/hwFormat";
import { cart, useCart } from "@/lib/cart";
import { createHomeworkAction, createWeakHomeworkAction } from "../actions";
import SamePicker from "./SamePicker";
import WeakPlanner, { type OutlineRow, type WeakOpts, type WeakReady } from "./WeakPlanner";

type Mode = "same" | "weak";
const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "same", label: "모두 같은 문제", hint: "고른 학생 모두에게 같은 숙제" },
  { mode: "weak", label: "학생마다 약한 유형", hint: "학생마다 따로 숙제" },
];

/** 숙제 내기 한 화면: 받는 학생 → 문제 고르기(모두 같은 문제 / 학생마다 약한 유형) → 이름·마감일 → 내기 */
export default function NewHomework({
  students,
  today,
  outline,
  mode: startMode,
  initial,
  review,
}: {
  students: PickStudent[];
  today: string;
  outline: OutlineRow[];
  mode: Mode;
  initial: string[];
  review: boolean; // 복습 숙제로 들어옴: 복습할 학생을 골라 두고 복습 날이 된 유형만 바로 찾는다
}) {
  const ids = useCart();
  const [mode, setMode] = useState<Mode>(startMode);
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [opts, setOpts] = useState<WeakOpts>({ count: 10, verifiedOnly: false, dueOnly: review });
  const [weakReady, setWeakReady] = useState<WeakReady[]>([]);
  const [autoFind, setAutoFind] = useState(review);
  const [title, setTitle] = useState<string | null>(null); // null 이면 아직 안 고침 → 기본 이름
  const [due, setDue] = useState(addDays(today, 2));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const router = useRouter();

  const md = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`;
  const shownTitle = title ?? `${md} ${mode === "same" ? "숙제" : review ? "복습 숙제" : "약한 유형 숙제"}`;
  const order = students.filter((s) => picked.has(s.studentId)).map((s) => s.studentId);
  const nameOf = (id: string) => students.find((s) => s.studentId === id)?.name || id;

  const pickStudents = (n: Set<string>) => {
    setPicked(n);
    setWeakReady([]); // 약한 유형 미리보기는 학생이 바뀌면 새로 찾는다
    setAutoFind(false);
    setError("");
  };

  const canSend = mode === "same" ? picked.size > 0 && ids.length > 0 : weakReady.length > 0;
  const status =
    mode === "same"
      ? !picked.size
        ? "받는 학생을 골라 주세요"
        : !ids.length
          ? "숙제로 낼 문제를 골라 주세요"
          : `${picked.size}명에게 같은 ${ids.length}문제`
      : !picked.size
        ? "받는 학생을 골라 주세요"
        : weakReady.length
          ? `${weakReady.length}명에게 각자 숙제를 하나씩 내요`
          : "약한 유형을 찾아 주세요";

  const submit = () => {
    setError("");
    start(async () => {
      if (mode === "same") {
        const chosen = students.filter((s) => picked.has(s.studentId));
        const cls = [...new Set(chosen.map((s) => s.classId))];
        const r = await createHomeworkAction({
          title: shownTitle,
          dueDate: due,
          classId: cls.length === 1 ? cls[0] : "",
          memo,
          studentIds: chosen.map((s) => s.studentId),
          problemIds: ids,
        });
        if ("error" in r) return setError(r.error);
        setSent(true);
        cart.clear();
        router.push(`/teacher/homework/${r.hwId}?new=1`);
      } else {
        const r = await createWeakHomeworkAction({ title: shownTitle, dueDate: due, memo, plans: weakReady });
        if ("error" in r) return setError(r.error);
        setSent(true);
        router.push("/teacher/homework");
      }
    });
  };

  if (sent) return <p className="card mt-10 text-center text-sm text-ink-soft">숙제를 냈어요. 숙제 현황으로 가는 중…</p>;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/teacher/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          숙제 목록
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">숙제 내기</h1>
        <p className="mt-1 text-sm text-ink-soft">받는 학생을 고르고, 문제를 골라 내요. 학생은 답만 적어 내면 바로 채점돼요.</p>
        {review && (
          <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm">
            {initial.length ? `오늘 복습할 유형이 있는 학생 ${initial.length}명을 골라 두었어요.` : "오늘 복습할 학생이 없어요."}
          </p>
        )}
      </div>

      <section className="card space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">
            <span className="mr-2 text-accent">1</span>받는 학생
          </h2>
          <span className="text-sm text-ink-soft">{picked.size}명 골랐어요</span>
        </div>
        <StudentPicker students={students} picked={picked} onChange={pickStudents} />
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">
          <span className="mr-2 text-accent">2</span>문제 고르기
        </h2>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="문제 고르는 방법">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              onClick={() => (setMode(m.mode), setWeakReady([]), setAutoFind(false), setError(""))}
              className={`rounded-lg px-3 py-2 text-left transition-colors ${mode === m.mode ? "bg-surface shadow-sm" : "text-ink-soft hover:text-ink"}`}
            >
              <span className="block text-sm font-semibold">{m.label}</span>
              <span className="block text-xs text-ink-faint">{m.hint}</span>
            </button>
          ))}
        </div>
        {mode === "same" ? (
          <SamePicker ids={ids} studentIds={order} nameOf={nameOf} outline={outline} />
        ) : (
          <WeakPlanner
            key={order.join(",")}
            studentIds={order}
            nameOf={nameOf}
            outline={outline}
            opts={opts}
            onOpts={setOpts}
            autoFind={autoFind}
            onReady={setWeakReady}
          />
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">
          <span className="mr-2 text-accent">3</span>숙제 이름과 마감일
        </h2>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">숙제 이름{mode === "weak" && " (뒤에 학생 이름이 붙어요)"}</span>
            <input value={shownTitle} onChange={(e) => setTitle(e.target.value)} maxLength={mode === "weak" ? 40 : 60} className="field" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">마감일</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="field" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-soft">메모 (선택 · 학생에게 보여요)</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder="예: 풀이 과정도 공책에 써 오기" className="field" />
        </label>
      </section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
        {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-ink-soft">{status}</p>}
        <button type="button" className="btn-accent ml-auto" disabled={!canSend || pending} onClick={submit}>
          <IconClipboard />
          {pending ? "내는 중…" : "숙제 내기"}
        </button>
      </div>
    </div>
  );
}
