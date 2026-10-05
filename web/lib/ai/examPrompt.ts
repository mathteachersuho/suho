import type { Exam } from "../report";
import type { TypeStat } from "../study";

/**
 * 시험지 사진 → 문항별 단원·유형·난이도 + 맞음/틀림 → 학원 숙제 기록과 비교한 분석 (app.py analyze_school_exam 을 사진 바로 읽기로 바꾼 것).
 * 틀린 번호를 선생님이 적으면 그것을 따르고, 비워 두면 사진의 채점 표시로 구별하게 한다.
 */
export function examPrompt(exam: Exam, wrong: string[], hist: TypeStat[]) {
  const history =
    hist
      .slice(0, 60)
      .map((t) => `- ${t.unit} › ${t.type} | 숙제 ${t.right}/${t.right + t.wrong} 맞힘`)
      .join("\n") || "(기록 없음)";
  return `너는 대한민국 중·고등학교 수학 선생님이다. 사진은 학생이 본 시험지(${exam.kind} 시험)이다. 여러 장이면 쪽 순서대로다.
문항마다 단원·유형·난이도를 정하고, 맞았는지 틀렸는지 구별한 뒤, 이 학생이 학원에서 한 숙제 기록과 비교해 시험 결과를 분석해라.

[시험] ${exam.takenOn} ${exam.name} · 점수 ${exam.score ?? "-"} / ${exam.maxScore ?? "-"}
[틀린 문항 번호] ${wrong.length ? wrong.join(", ") + " (선생님이 적은 것. 이 번호만 틀림, 나머지는 맞음)" : "(적지 않음 → 사진의 채점 표시로 판단)"}

[학생의 학원 숙제 기록] (단원 › 유형 | 맞힌 수/푼 수)
${history}

[규칙]
- 시험지의 문항 번호 그대로, 모든 문항을 빠짐없이 적어라. 서술형은 번호 앞에 "서"를 붙여라 (예: "서1").
- result: "맞음" 또는 "틀림". 틀린 번호가 주어졌으면 그대로 따르고, 아니면 사진의 채점 표시(빗금·X·감점 표시는 틀림, 동그라미는 맞음)로 정해라. 표시가 없거나 알아볼 수 없으면 "".
- related: 숙제 기록에 같거나 비슷한 유형이 있으면 짧게 (예: "숙제 3/5 맞힘"), 없으면 "기록 없음".
- note: 이 문항의 핵심 개념이나 실수하기 쉬운 점을 한 줄로.
- summary: 틀린 문항이 어떤 단원·유형인지, 학원에서 연습한 유형은 잘 풀었는지, 연습하지 않은 유형이 얼마나 나왔는지 3~5문장.
- advice: 다음 시험까지 할 공부 3가지, 줄마다 "- "로 시작.
- 기록에 없는 사실은 지어내지 말 것. 수식은 $ $ 없이 평범한 글자로.
- 출력은 JSON만: {"problems": [{"no": "1", "result": "맞음", "unit": "...", "type": "...", "difficulty": "하|중|상", "related": "...", "note": "..."}], "summary": "...", "advice": "..."}`;
}
