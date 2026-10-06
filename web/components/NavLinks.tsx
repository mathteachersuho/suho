"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./TopBar";

/** 지금 보고 있는 쪽의 메뉴를 진하게 표시한다 */
export default function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  // 가장 길게 맞는 주소 하나만 진하게 (예: /teacher/bank 에서 /teacher 는 진하지 않게)
  const active = items
    .filter((it) => it.href && (path === it.href || path.startsWith(it.href + "/")))
    .sort((a, b) => b.href!.length - a.href!.length)[0]?.href;
  return (
    <nav className="-mx-1 flex w-full gap-1 overflow-x-auto pb-2 sm:mx-0 sm:w-auto sm:pb-0">
      {items.map((it) =>
        it.href ? (
          <Link
            key={it.label}
            href={it.href}
            aria-current={it.href === active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              it.href === active ? "bg-surface-2 text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {it.icon}
            {it.label}
            {it.dot && <span className="h-1.5 w-1.5 rounded-full bg-bad" aria-label="확인할 것 있음" />}
          </Link>
        ) : (
          <span
            key={it.label}
            title="곧 열려요"
            className="inline-flex cursor-default items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-faint"
          >
            {it.icon}
            {it.label}
            <span className="rounded border border-line px-1 text-[10px] leading-4">곧</span>
          </span>
        ),
      )}
    </nav>
  );
}
