import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Logo } from "./Brand";
import { IconLogout } from "./Icons";
import NavLinks from "./NavLinks";

export type NavItem = { label: string; icon?: React.ReactNode; href?: string };

/** 화면 위쪽 막대: 앱 이름, 메뉴, 나가기 버튼 */
export default function TopBar({ items, who }: { items: NavItem[]; who: string }) {
  return (
    <header className="print:hidden sticky top-0 z-10 border-b border-line bg-surface/80 backdrop-blur-md">
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
        <NavLinks items={items} />
      </div>
    </header>
  );
}
