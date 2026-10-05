/** 숙제·시험 정답률(%) 흐름. 가로는 날짜, 세로는 0~100%. */
export type Point = { day: string; pct: number; label: string };

const W = 640;
const H = 200;
const PAD = { l: 34, r: 12, t: 12, b: 26 };
const t = (day: string) => Date.parse(day + "T00:00:00Z");

export default function ScoreChart({ hw, exams, from, to }: { hw: Point[]; exams: Point[]; from: string; to: string }) {
  if (!hw.length && !exams.length) return null;
  const x0 = t(from);
  const span = Math.max(t(to) - x0, 86_400_000);
  const x = (day: string) => PAD.l + ((t(day) - x0) / span) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);
  const md = (day: string) => day.slice(5).replace("-", "/");
  const line = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.pct).toFixed(1)}`).join("");
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="숙제와 시험 정답률 흐름">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="stroke-line" strokeDasharray={g ? "3 4" : undefined} />
            <text x={PAD.l - 6} y={y(g) + 4} textAnchor="end" className="fill-ink-faint text-[11px]">
              {g}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="fill-ink-faint text-[11px]">
          {md(from)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-ink-faint text-[11px]">
          {md(to)}
        </text>
        {hw.length > 1 && <path d={line(hw)} fill="none" className="stroke-accent" strokeWidth={2} />}
        {hw.map((p) => (
          <circle key={"h" + p.day + p.label} cx={x(p.day)} cy={y(p.pct)} r={3.5} className="fill-accent">
            <title>{`${md(p.day)} ${p.label} ${p.pct}%`}</title>
          </circle>
        ))}
        {exams.length > 1 && <path d={line(exams)} fill="none" className="stroke-warn" strokeWidth={2} strokeDasharray="6 4" />}
        {exams.map((p) => (
          <rect key={"e" + p.day + p.label} x={x(p.day) - 4.5} y={y(p.pct) - 4.5} width={9} height={9} className="fill-warn">
            <title>{`${md(p.day)} ${p.label} ${p.pct}%`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="flex gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          숙제 정답률
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-warn" />
          시험 점수 (만점 대비 %)
        </span>
      </figcaption>
    </figure>
  );
}
