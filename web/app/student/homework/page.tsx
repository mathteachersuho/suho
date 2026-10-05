import type { Metadata } from "next";
import Link from "next/link";
import { IconArrow, IconClipboard } from "@/components/Icons";
import { studentHomeworkList } from "@/lib/homework";
import { dueLabel, todaySeoul } from "@/lib/hwFormat";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "숙제 · 수학클래스룸" };

export default async function MyHomework() {
  const me = await requireStudent();
  const list = await studentHomeworkList(me.studentId);
  const today = todaySeoul();
  const todo = list.filter((h) => !h.submittedCount);
  const done = list.filter((h) => h.submittedCount);

  const Row = ({ h }: { h: (typeof list)[number] }) => {
    const late = !h.submittedCount && h.dueDate && h.dueDate < today;
    return (
      <li>
        <Link href={`/student/homework/${h.hwId}`} className="flex items-center gap-3 px-5 py-4 hover:bg-surface-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{h.title}</p>
            <p className="text-sm text-ink-soft">
              {h.problemCount}문제
              {h.dueDate && <span className={late ? "text-bad" : ""}> · {dueLabel(h.dueDate)}{late ? " (지났어요)" : ""}</span>}
            </p>
          </div>
          {h.submittedCount ? (
            <span className="text-sm font-semibold tabular-nums">
              {h.correctCount}/{h.problemCount}
            </span>
          ) : (
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">풀기</span>
          )}
          <IconArrow className="h-4 w-4 text-ink-faint" />
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">숙제</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{todo.length ? `풀 숙제 ${todo.length}개` : "밀린 숙제가 없어요"}</h1>
        <p className="mt-1 text-sm text-ink-soft">답만 적어서 내면 바로 채점돼요. 한 번 내면 다시 낼 수 없으니 꼼꼼히 확인하세요.</p>
      </div>
      {!list.length && (
        <div className="card text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <IconClipboard className="h-5 w-5" />
          </span>
          <p className="mt-3 font-semibold">아직 받은 숙제가 없어요</p>
        </div>
      )}
      {todo.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-soft">아직 안 낸 숙제</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {todo.map((h) => (
              <Row key={h.hwId} h={h} />
            ))}
          </ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-soft">낸 숙제</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {done.map((h) => (
              <Row key={h.hwId} h={h} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
