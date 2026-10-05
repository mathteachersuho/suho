"use client";

import Link from "next/link";
import { cart, useCart } from "@/lib/cart";
import { IconCheck, IconClipboard, IconPlus, IconPrinter } from "@/components/Icons";

/** 문제 하나를 학습지에 담기 / 빼기 */
export function CartToggle({ id }: { id: string }) {
  const ids = useCart();
  const on = ids.includes(id);
  return (
    <button
      type="button"
      onClick={() => cart.toggle(id)}
      aria-pressed={on}
      className={`btn shrink-0 px-3 py-1.5 ${on ? "bg-accent text-white hover:bg-accent-strong" : "border border-line bg-surface text-ink hover:bg-surface-2"}`}
    >
      {on ? <IconCheck /> : <IconPlus />}
      {on ? "담음" : "담기"}
    </button>
  );
}

/** 이 쪽에 보이는 문제를 한 번에 담기 */
export function AddAllButton({ ids }: { ids: string[] }) {
  const cur = useCart();
  const left = ids.filter((id) => !cur.includes(id)).length;
  return (
    <button type="button" className="btn-soft py-2" disabled={!left} onClick={() => cart.addMany(ids)}>
      <IconPlus />
      {left ? `이 쪽 ${left}문제 모두 담기` : "이 쪽 문제를 모두 담았어요"}
    </button>
  );
}

/** 화면 아래에 떠 있는 '담은 문제' 막대 */
export function CartBar() {
  const ids = useCart();
  if (!ids.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-4 print:hidden">
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 pl-4 shadow-lg shadow-black/10 backdrop-blur">
        <p className="text-sm">
          <b className="font-semibold tabular-nums">{ids.length}</b>
          <span className="text-ink-soft">문제 담음</span>
        </p>
        <button type="button" onClick={() => cart.clear()} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink">
          비우기
        </button>
        <Link href={`/print?ids=${encodeURIComponent(ids.join(","))}`} className="btn-soft py-2">
          <IconPrinter />
          <span className="hidden sm:inline">학습지 만들기</span>
          <span className="sm:hidden">학습지</span>
        </Link>
        <Link href="/teacher/homework/new" className="btn-main py-2">
          <IconClipboard />
          <span className="hidden sm:inline">숙제로 내기</span>
          <span className="sm:hidden">숙제</span>
        </Link>
      </div>
    </div>
  );
}
