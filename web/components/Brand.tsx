/** 앱 이름과 마스코트 (동그란 파이 캐릭터) */
export function Mascot({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="42" r="34" fill="var(--grape)" />
      <circle cx="40" cy="42" r="34" fill="url(#shine)" />
      <defs>
        <radialGradient id="shine" cx="30%" cy="25%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="29" cy="38" r="5" fill="#fff" />
      <circle cx="51" cy="38" r="5" fill="#fff" />
      <circle cx="30" cy="39" r="2.4" fill="var(--ink)" />
      <circle cx="52" cy="39" r="2.4" fill="var(--ink)" />
      <circle cx="22" cy="49" r="4" fill="var(--bubble)" opacity="0.7" />
      <circle cx="58" cy="49" r="4" fill="var(--bubble)" opacity="0.7" />
      <path d="M33 50 Q40 57 47 50" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <text x="40" y="20" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--sunny)">π</text>
    </svg>
  );
}

export function Logo() {
  return (
    <span className="font-display text-2xl tracking-tight">
      <span className="text-grape">수학</span>
      <span className="text-bubble">클래스룸</span>
    </span>
  );
}

/** 배경에 둥둥 떠다니는 수학 기호 */
export function FloatingSymbols() {
  const items = [
    { s: "π", c: "text-grape/25", pos: "left-[6%] top-[12%]", r: "-12deg", d: "0s" },
    { s: "√", c: "text-bubble/30", pos: "right-[8%] top-[18%]", r: "10deg", d: "1s" },
    { s: "∑", c: "text-sky/35", pos: "left-[10%] bottom-[14%]", r: "8deg", d: "2s" },
    { s: "÷", c: "text-mint/35", pos: "right-[12%] bottom-[10%]", r: "-6deg", d: "3s" },
    { s: "x²", c: "text-sunny/60", pos: "left-[45%] top-[6%]", r: "4deg", d: "1.5s" },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {items.map((it) => (
        <span
          key={it.s}
          className={`floaty absolute font-display text-6xl sm:text-8xl ${it.c} ${it.pos}`}
          style={{ ["--r" as string]: it.r, animationDelay: it.d }}
        >
          {it.s}
        </span>
      ))}
    </div>
  );
}
