import { findGuide } from "./curriculum";
import { KINDS } from "../bankReviewCore";

/*
 * 문제 은행 자동 점검 프롬프트. 몇 문제를 한 번에 보내 고칠 것만 JSON으로 받는다 (AI 비용을 줄이려고 묶어 보낸다).
 * 실제로 고친 글은 lib/create.ts editOne 으로 문제마다 따로 받는다.
 */

export type ReviewInput = {
  id: string;
  grade: string;
  unit: string;
  type: string;
  difficulty: string;
  createdAt: string; // YYYY-MM-DD
  question: string;
  answer: string;
  solution: string;
  /** 코드 점검에서 이미 찾은 것 (AI가 다시 적지 않아도 된다) */
  known: string[];
};

const kindLines = Object.entries(KINDS)
  .map(([k, v]) => `  - "${k}": ${v}`)
  .join("\n");

export function bankReviewPrompt(guide: string, items: ReviewInput[]) {
  const blocks = items
    .map((p) => {
      const g = findGuide(p.grade);
      return `<<문제 id="${p.id}">>
분류: ${[p.grade, p.unit, p.type].filter(Boolean).join(" › ") || "(없음)"} | 난이도 ${p.difficulty || "-"} | 만든 날 ${p.createdAt}
${g ? `이 학년이 아직 배우지 않은 것: ${g.avoid}\n` : ""}${p.known.length ? `이미 찾은 것(다시 적지 마라): ${p.known.join(" / ")}\n` : ""}[문제]
${p.question}
[정답]
${p.answer || "(없음)"}
[풀이]
${p.solution || "(없음)"}
<</문제>>`;
    })
    .join("\n\n");

  return `너는 대한민국 중·고등학교 수학 학원의 문제 은행 검수자야. 아래 문제들을 하나씩 직접 풀어 보고, 선생님의 [점검 기준]에 따라 고칠 것만 찾아라.

[점검 기준] (선생님이 직접 쓴 것. 가장 중요하다. 여기서 고치지 말라고 한 것은 절대 고칠 것으로 적지 마라)
${guide.trim() || "(기준 없음: 확실한 오류만 찾아라)"}

[찾는 방법]
- 문제를 직접 풀어 정답·풀이와 비교하라. 확실할 때만 적어라. 애매하거나 취향 차이면 적지 마라.
- 그림(SVG)은 좌표·글자 위치를 보고 잘림, 겹침, 지문과 다른 점, 기준에 맞지 않는 모양을 찾아라.
- 고칠 것이 없으면 findings 를 빈 배열로 둬라. 대부분의 문제는 고칠 것이 없다.

[kind 값] (하나의 고칠 것마다 하나)
${kindLines}
  figure=그림 모양만, notation=수식·기호 표기(뜻은 같음), format=번호·서식·배치, wording=어색한 문장(뜻은 같음),
  solution=풀이 과정의 오류나 빠진 단계(정답은 같음), grade=학년 밖 개념을 쓴 풀이, answer=정답이 틀림,
  question=지문의 조건·숫자·보기가 잘못됨, class=학년·단원·유형·난이도 분류가 틀림.

[출력] 설명 없이 JSON 하나만:
{"results":[{"id":"문제 id","findings":[{"kind":"figure","what":"무엇이 왜 문제인지 (선생님이 읽을 한국어 한두 문장, 해요체)","fix":"어떻게 고칠지 (AI에게 줄 구체적인 지시)"}]}]}

${blocks}
`;
}

/** 찾은 것을 고친 안으로 바꿀 때 editOne 에 줄 요청 */
export function bankFixInstruction(guide: string, fixes: string) {
  return `문제 은행 점검에서 아래 고칠 것이 나왔다. 이것만 고치고 나머지(지문·숫자·보기·그림·정답)는 한 글자도 바꾸지 마라.
[고칠 것]
${fixes}

[선생님 점검 기준] (특히 '손대지 말 것'은 반드시 지켜라)
${guide.trim()}`;
}
