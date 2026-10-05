import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Logo } from "./Brand";
import { IconKey, IconLogout } from "./Icons";
import NavLinks from "./NavLinks";

export type NavItem = { label: string; icon?: React.ReactNode; href?: string };

const SIDE_BTN =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink";

/** 화면 위쪽 막대: 앱 이름, 메뉴, (비밀번호 바꾸기), 나가기 버튼 */
export default function TopBar({ items, who, passwordHref }: { items: NavItem[]; who: string; passwordHref?: string }) {
  return (
    <header className="print:hidden sticky top-0 z-10 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:h-16 sm:py-0">
        <Link href="/" aria-label="처음으로">
          <Logo size={26} />
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 sm:order-last">
          <span className="hidden text-sm text-ink-soft sm:inline">{who}</span>
          {passwordHref && (
            <Link href={passwordHref} className={SIDE_BTN}>
              <IconKey />
              비밀번호
            </Link>
          )}
          <form action={logout}>
            <button className={SIDE_BTN}>
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
