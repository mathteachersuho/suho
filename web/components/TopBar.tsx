import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Logo } from "./Brand";
import { IconLogout } from "./Icons";

export type NavItem = { label: string; icon?: React.ReactNode; href?: string; active?: boolean };

/** 화면 위쪽 막대: 앱 이름, 메뉴, 나가기 버튼 */
export default function TopBar({ items, who }: { items: NavItem[]; who: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:h-16 sm:py-0">
        <Link href="/" aria-label="처음으로">
          <Logo size={26} />
        </Link>
        <div className="ml-auto flex items-center gap-3 sm:order-last">
          <span className="hidden text-sm text-ink-soft sm:inline">{who}</span>
          <form action={logout}>
            <button className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink">
              <IconLogout />
              나가기
            </button>
          </form>
        </div>
        <nav className="-mx-1 flex w-full gap-1 overflow-x-auto pb-2 sm:mx-0 sm:w-auto sm:pb-0">
          {items.map((it) =>
            it.href ? (
              <Link
                key={it.label}
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  it.active ? "bg-surface-2 text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {it.icon}
                {it.label}
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
      </div>
    </header>
  );
}
