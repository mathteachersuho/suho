/** 얇은 선 아이콘 (24px 기준). 색은 글자색을 따른다. */
type P = { className?: string };
const base = (path: React.ReactNode, className = "h-4 w-4") => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {path}
  </svg>
);
export const IconUsers = ({ className }: P) =>
  base(<><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="3.5" /><path d="M22 19v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>, className);
export const IconBook = ({ className }: P) =>
  base(<><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19.5A2 2 0 0 1 6 18h14" /></>, className);
export const IconClipboard = ({ className }: P) =>
  base(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 11h6M9 15h4" /></>, className);
export const IconChart = ({ className }: P) => base(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>, className);
export const IconHome = ({ className }: P) => base(<><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" /></>, className);
export const IconStar = ({ className }: P) =>
  base(<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z" />, className);
export const IconNote = ({ className }: P) =>
  base(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>, className);
export const IconKey = ({ className }: P) =>
  base(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" /></>, className);
export const IconTrash = ({ className }: P) =>
  base(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>, className);
export const IconPlus = ({ className }: P) => base(<path d="M12 5v14M5 12h14" />, className);
export const IconLogout = ({ className }: P) =>
  base(<><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" /></>, className);
export const IconArrow = ({ className }: P) => base(<path d="M5 12h14M13 6l6 6-6 6" />, className);
