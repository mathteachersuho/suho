import type { ReportData } from "../report";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "기록 없음");
const short = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/** 학부모 리포트의 '문제 분석'과 '선생님 종합 의견' 초안을 쓰게 하는 프롬프트 (app.py report_ai_analysis 와 같은 틀) */
export function reportPrompt(name: string, r: ReportData) {
  const done = r.hw.filter((h) => h.submitted).length;
  const hw = r.hw.map((h) => `- ${h.day} ${h.title}: ${h.submitted ? `${h.right}/${h.total}` : "안 냄"}`).join("\n") || "(없음)";
  const units = r.units.map((u) => `${u.unit} ${u.right}/${u.total}`).join(", ") || "(없음)";
  const weak = r.weak.map((t) => `${t.unit} › ${t.type} ${t.right}/${t.total}${t.hard ? ` (선생님이 어려움 표시 ${t.hard}문제)` : ""}`).join(", ") || "뚜렷한 약점 없음";
  const wrong =
    r.wrong
      .map(
        (w) =>
          `- [${w.day}] ${w.unit} › ${w.type} | ${short(w.question)} | 학생 답: ${w.myAnswer || "(빈칸)"} | 정답: ${short(w.answer, 60)}${w.reason ? ` | 선생님이 본 틀린 이유: ${w.reason}` : ""}`,
      )
      .join("\n") ||
    "(없음)";
  const exams =
    r.exams
      .map((e) => {
        let line = `- ${e.takenOn} ${e.kind} ${e.name} ${e.score ?? "-"}/${e.maxScore ?? "-"}${e.memo ? ` (${e.memo})` : ""}`;
        const a = e.analysis;
        if (a) {
          const bad = a.problems.filter((p) => p.result === "틀림").map((p) => `${p.no}번 ${p.unit} › ${p.type}`);
          if (bad.length) line += `\n  틀린 문항: ${bad.join(", ")}`;
          if (a.summary) line += `\n  시험지 분석: ${short(a.summary, 500)}`;
        }
        return line;
      })
      .join("\n") || "(없음)";
  return `너는 수학 학원 선생님이다. 아래 기록을 읽고 ${name} 학생의 학부모님께 보낼 학습 리포트의 '문제 분석'과 '선생님 종합 의견'을 써라.
- 기간: ${r.from} ~ ${r.to}
- 숙제: ${r.hw.length}번 중 ${done}번 제출, 채점된 문제 ${r.solved}개, 정답률 ${pct(r.right, r.solved)}
- 날짜별 숙제 점수 (맞힌 수/문제 수):
${hw}
- 단원별 (맞힌 수/푼 수): ${units}
- 정답률이 낮거나 어려워하는 유형 (맞힌 수/푼 수): ${weak}
- 선생님이 고른 틀린 이유 (문제 수): ${r.reasons.map((x) => `${x.reason} ${x.n}`).join(", ") || "(고른 것 없음)"}
- 최근 틀린 문제:
${wrong}
- 시험:
${exams}

[규칙]
- analysis: 아래 네 칸을 이 순서로, 칸마다 1~3줄. 칸 제목은 그대로 쓰고 내용 줄은 "- "로 시작.
  ■ 자주 틀리는 유형
  ■ 틀린 원인 (선생님이 고른 틀린 이유가 있으면 그것을 먼저 근거로, 없으면 학생 답을 보고 개념 이해 / 계산 실수 / 문제 해석 중 무엇인지)
  ■ 시험과 연결해 본 점
  ■ 앞으로의 지도 계획
- comment: 학부모님께 드리는 존댓말 4~6문장. 잘한 점 → 보완할 점 → 지도 계획 순서.
- 기록에 없는 내용은 지어내지 말 것. 기록이 없는 칸은 "- 이번 기간에는 기록이 없습니다."
- 수식은 $ $ 없이 평범한 글자로 쓸 것.
- 출력은 JSON만: {"analysis": "...", "comment": "..."}`;
}
