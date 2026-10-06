"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { IconArrow, IconClipboard } from "@/components/Icons";
import StudentPicker from "@/components/StudentPicker";
import { addDays } from "@/lib/hwFormat";
import { cart, useCart } from "@/lib/cart";
import { cartPreviewAction, createHomeworkAction } from "../actions";

type Stu = { studentId: string; name: string; classId: string };
type Preview = { id: string; tag: string; html: string };

/** 담은 문제로 숙제 내기: 이름, 마감일, 받는 학생(반 단위로 한 번에 고르기), 메모 */
export default function NewHomework({ students, today }: { students: Stu[]; today: string }) {
  const ids = useCart();
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [title, setTitle] = useState(`${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} 숙제`);
  const [due, setDue] = useState(addDays(today, 2));
  const [memo, setMemo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const [sent, setSent] = useState(false);

  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    cartPreviewAction(list).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [key]);

  const submit = () => {
    setError("");
    const chosen = students.filter((s) => picked.has(s.studentId));
    const cls = [...new Set(chosen.map((s) => s.classId))];
    start(async () => {
      const r = await createHomeworkAction({
        title,
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
    });
  };

  const shown = ids.length ? preview : [];

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/teacher/homework" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconArrow className="h-4 w-4 rotate-180" />
          숙제 목록
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">숙제 내기</h1>
        <p className="mt-1 text-sm text-ink-soft">문제 은행에서 담은 문제를 학생들에게 숙제로 내요. 학생은 답만 적어 내면 바로 채점돼요.</p>
      </div>

      {sent ? (
        <p className="card text-center text-sm text-ink-soft">숙제를 냈어요. 숙제 현황으로 가는 중…</p>
      ) : !ids.length ? (
        <div className="card text-center">
          <p className="font-semibold">담은 문제가 없어요</p>
          <p className="mt-1 text-sm text-ink-soft">문제 은행에서 숙제로 낼 문제를 담아 오세요.</p>
          <Link href="/teacher/bank" className="btn-main mt-4">
            문제 은행으로
          </Link>
        </div>
      ) : (
        <>
          <section className="card space-y-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-soft">숙제 이름</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="field" />
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

          <section className="card space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">받는 학생</h2>
              <span className="text-sm text-ink-soft">{picked.size}명 골랐어요</span>
            </div>
            <StudentPicker students={students} picked={picked} onChange={setPicked} />
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">문제 {ids.length}개</h2>
              <Link href={`/print?ids=${encodeURIComponent(ids.join(","))}`} className="text-sm text-accent underline">
                순서 바꾸기 · 학습지로 보기
              </Link>
            </div>
            {shown === null ? (
              <p className="text-sm text-ink-soft">문제를 불러오는 중…</p>
            ) : (
              <ol className="space-y-2">
                {shown.map((p, i) => (
                  <li key={p.id} className="card flex gap-3 p-4 sm:p-4">
                    <span className="mt-0.5 shrink-0 font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {p.tag && <p className="mb-1 text-xs text-ink-faint">{p.tag}</p>}
                      <div className="problem-body line-clamp-4 text-sm" dangerouslySetInnerHTML={{ __html: p.html }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg shadow-black/10 backdrop-blur">
            {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-ink-soft">{picked.size ? `${picked.size}명에게 ${ids.length}문제` : "받는 학생을 골라 주세요"}</p>}
            <button type="button" className="btn-accent ml-auto" disabled={!picked.size || pending} onClick={submit}>
              <IconClipboard />
              {pending ? "내는 중…" : "숙제 내기"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
