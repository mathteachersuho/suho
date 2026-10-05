/** 로고: 시그마 모노그램 + 글자 */
export function Monogram({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-ink font-bold text-bg"
      style={{ width: size, height: size, fontSize: size * 0.58 }}
      aria-hidden="true"
    >
      Σ
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Monogram size={size} />
      <span className="text-[17px] font-bold tracking-tight">수학클래스룸</span>
    </span>
  );
}
