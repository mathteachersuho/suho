const STYLE: Record<string, string> = {
  하: "bg-good/15 text-good ring-good/40",
  중: "bg-accent/15 text-accent ring-accent/40",
  상: "bg-bad/15 text-bad ring-bad/40",
};

/** 난이도 하·중·상을 색 있는 큰 표로 보여 준다 (문제 은행·숙제 화면에서 한눈에 보이게) */
export default function DifficultyBadge({ level, className = "" }: { level: string; className?: string }) {
  if (!level) return null;
  return (
    <span className={`inline-flex shrink-0 items-baseline gap-1 rounded-lg px-2.5 py-0.5 ring-1 ring-inset ${STYLE[level] ?? "bg-surface-2 text-ink-soft ring-line"} ${className}`}>
      <span className="text-xs font-medium opacity-80">난이도</span>
      <span className="text-base leading-6 font-bold">{level}</span>
    </span>
  );
}
