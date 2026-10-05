import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Logo, Mascot } from "./Brand";

export type NavItem = { label: string; href?: string; active?: boolean };

/** 화면 위쪽 막대: 앱 이름, 메뉴, 나가기 버튼 */
export default function TopBar({ items, who }: { items: NavItem[]; who: string }) {
  return (
    <header className="sticky top-0 z-10 border-b-2 border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Mascot size={36} />
          <Logo />
        </Link>
        <nav className="order-3 flex w-full gap-2 overflow-x-auto sm:order-none sm:ml-4 sm:w-auto">
          {items.map((it) =>
            it.href ? (
              <Link
                key={it.label}
                href={it.href}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold transition ${
                  it.active ? "bg-grape text-white" : "bg-bg text-ink-soft hover:text-ink"
                }`}
              >
                {it.label}
              </Link>
            ) : (
              <span
                key={it.label}
                title="곧 열려요"
                className="whitespace-nowrap rounded-full bg-bg px-4 py-1.5 text-sm font-bold text-ink-soft/50"
              >
                {it.label} <span className="text-[10px]">곧</span>
              </span>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-ink-soft sm:inline">{who}</span>
          <form action={logout}>
            <button className="rounded-full border-2 border-line px-3 py-1 text-sm font-bold text-ink-soft hover:border-grape hover:text-grape">
              나가기
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
