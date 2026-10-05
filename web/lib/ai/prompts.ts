import "server-only";

/*
 * Streamlit app.py 의 Gemini 지시문을 그대로 옮긴 것.
 * 두 앱이 같은 형태의 문제를 만들도록, 고칠 때는 app.py 쪽도 함께 고친다.
 */

export type GenKind = 0 | 1 | 2; // 0 = 원본 다시 쓰기, 1 = 기본 다지기, 2 = 실력 키우기

const RULES = `
[공통 그래픽/수식 규칙 (속도 최우선)]
1. **방정식 풀이 과정 / 등식의 성질 (오른쪽 곡선 화살표 ㉠, ㉡, ㉢) 표기 규칙 (매우 중요):**
   - 원본 문제가 '방정식 풀이 과정 중 등식의 성질 ㉠, ㉡, ㉢ 찾기' 유형인 경우, **마크다운 코드블록(\`\`\`)을 절대 쓰지 말고 아래와 같이 순수 SVG 태그(\`<svg ...>...</svg>\`)로 직접 출력**하라:
     <svg width="220" height="155" viewBox="0 0 220 155">
       <rect x="5" y="5" width="210" height="145" rx="10" fill="#ffffff" stroke="#aaaaaa" stroke-width="1.5"/>
       <text x="75" y="32" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">1단계 식</text>
       <text x="75" y="68" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">2단계 식</text>
       <text x="75" y="104" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">3단계 식</text>
       <text x="75" y="138" font-size="14" font-weight="bold" fill="#000000" text-anchor="middle">∴ x = 값</text>
       <path d="M 130,28 C 160,30 160,62 135,66" fill="none" stroke="#222222" stroke-width="1.5"/>
       <polygon points="135,66 142,61 141,71" fill="#222222"/>
       <text x="168" y="51" font-size="13" font-weight="bold" fill="#000000">㉠</text>
       <path d="M 130,68 C 160,70 160,98 135,102" fill="none" stroke="#222222" stroke-width="1.5"/>
       <polygon points="135,102 142,97 141,107" fill="#222222"/>
       <text x="168" y="89" font-size="13" font-weight="bold" fill="#000000">㉡</text>
       <path d="M 130,104 C 160,106 160,132 135,136" fill="none" stroke="#222222" stroke-width="1.5"/>
       <polygon points="135,136 142,131 141,141" fill="#222222"/>
       <text x="168" y="123" font-size="13" font-weight="bold" fill="#000000">㉢</text>
     </svg>
2. **도형/그래프/수직선 SVG 초경량 작성:**
   - 도형이 필요한 경우 6~8줄 이내의 초간단 인라인 SVG(\`<svg width="220" height="130" viewBox="0 0 220 130">...</svg>\`)로 작성하라.
   - 모든 SVG 텍스트는 \`fill="#000000"\`으로 작성하라.
2-1. **좌표평면(점의 좌표, 그래프 위 점 찍기 등) 문제 전용 규칙:**
   - 반드시 아래 예시처럼 \`<pattern>\`으로 연한 회색 격자를 배경 전체에 채우고, 그 위에 x축/y축(화살표 포함)과 점들을 검은색으로 찍어라. 격자 눈금 간격은 20으로 고정한다:
     <svg width="200" height="200" viewBox="0 0 200 200">
       <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#dddddd" stroke-width="1"/></pattern></defs>
       <rect width="200" height="200" fill="url(#g)"/>
       <line x1="0" y1="100" x2="200" y2="100" stroke="#000000" stroke-width="1.5"/>
       <line x1="100" y1="0" x2="100" y2="200" stroke="#000000" stroke-width="1.5"/>
       <polygon points="200,100 193,96 193,104" fill="#000000"/>
       <polygon points="100,0 96,7 104,7" fill="#000000"/>
       <text x="205" y="104" font-size="12" fill="#000000">x</text>
       <text x="104" y="10" font-size="12" fill="#000000">y</text>
       <circle cx="120" cy="80" r="3" fill="#000000"/><text x="124" y="76" font-size="12" fill="#000000">A</text>
     </svg>
   - 점의 좌표는 격자 눈금(20 간격) 위에만 찍어라. 점과 라벨(A, B, C...) 외의 불필요한 장식은 넣지 마라.
3. **정육면체 겨냥도/전개도:**
   - 3D 겨냥도는 3면 큐브 SVG로, 펼쳐진 전개도는 3x4 마크다운 격자 표로 작성하라.
4. **수식 표기:** 지문 본문에서 단순 문자(A, B, C, 보기 ㄱ, ㄴ, ㄷ 등)에는 $를 쓰지 말고, 분수식/계산식만 \`$수식$\`으로 작성하라.
`;

const TYPE_INSTRUCTION: Record<GenKind, string> = {
  0: `[원본 문제 다시 쓰기 원칙 (새 문제를 만들지 마라!)]
- 원본 문제의 지문, 숫자, 조건, 보기, 묻는 것을 **하나도 바꾸지 말고 그대로** 옮겨 적어라. 숫자를 바꾸거나 문제를 쉽게/어렵게 고치지 마라.
- 글자 인식(OCR) 과정에서 깨진 수식, 빠진 기호, 잘못 읽힌 글자는 문맥(과 함께 보낸 사진)에 맞게 바로잡아라.
- 사진이 함께 왔다면 사진을 기준으로 삼아라. 사진 속 도형, 그래프, 수직선, 표는 아래 규칙대로 SVG나 표로 **사진과 같게** 다시 그려라 (점 이름, 표시된 길이·각도, 위치 관계를 그대로). 정확하게 그리는 것이 줄 수보다 중요하다.
- 원본에 그림이 없으면 그림을 새로 넣지 마라.
- 정답과 풀이도 작성하라.`,
  1: `[1번 기본 다지기 출제 원칙]
- 원본 문제의 형태와 구조를 그대로 유지하되, **반드시 원본에 주어진 숫자(예: 계수, 상수 등)를 다른 수치로 확실하게 변경**하여 1문제를 출제하라.`,
  2: `[2번 실력 키우기 출제 원칙 (1번과 절대 중복 금지!)]
- 1번과 똑같은 단순 숫자 변경 문제를 만들지 마라!
- 같은 단원 개념을 사용하되, 반드시 **'다른 등식의 성질을 묻기'**, **'괄호나 소수/분수가 포함된 1단계 더 발전된 방정식'**, 또는 **'역방향 계산'**으로 1번과 완전히 차별화하여 1문제를 출제하라.`,
};

const KIND_NAME: Record<GenKind, string> = { 0: "원본 문제 다시 쓰기", 1: "1번 기본 다지기 문제", 2: "2번 실력 키우기 문제" };

/** 같은 종류를 여러 개 만들 때: 몇 번째인지, 이미 만든 문제(겹치면 안 되는 것) */
export type Variation = { index?: number; total?: number; avoid?: string[] };

function variationText(kind: GenKind, v: Variation) {
  if (kind === 0) return "";
  const lines: string[] = [];
  if ((v.total ?? 1) > 1)
    lines.push(
      `- 이 문제는 같은 종류 ${v.total}문제 중 ${v.index}번째다. 다른 번호 문제와 숫자·조건·상황이 겹치지 않게, ${v.index}번째에 맞는 서로 다른 값과 접근을 골라라.`,
    );
  if (v.avoid?.length)
    lines.push(`- 아래 문제들은 이미 만들었다. 이것들과 숫자·조건이 같거나 거의 같은 문제를 만들지 마라.\n${v.avoid.map((q, i) => `(${i + 1}) ${q}`).join("\n")}`);
  return lines.length ? `\n[여러 문제 만들기]\n${lines.join("\n")}\n` : "";
}

export function problemPrompt(kind: GenKind, ocrText: string, detailed: boolean, v: Variation = {}) {
  const solution = detailed ? "단계별 상세 풀이와 해설 작성" : "핵심 수식 전개 및 정답 도출 과정만 1~2줄로 매우 간결하게 작성";
  const head =
    kind === 0 ? "원본 문제를 실제 시험지처럼 깔끔하게 다시 써라." : `원본 문제를 바탕으로 [${KIND_NAME[kind]}]를 1개만 제작하라.`;
  return `너는 대한민국 중학교/고등학교 수학 출제 위원이야. ${head}

[원본 문제]
${ocrText}

${TYPE_INSTRUCTION[kind]}${variationText(kind, v)}
${RULES}
[출력 양식]
[문제]
(문제 지문 및 SVG)
[정답]
(정답)
[풀이]
(${solution})
`;
}

export type Generated = { question: string; answer: string; solution: string };

export type EditTarget = "problem" | "solution";

/** 선생님이 말로 적은 요청대로 이미 만든 문제를 고친다. problem = 문제·그림, solution = 정답·풀이만. */
export function editPrompt(current: Generated, instruction: string, withImage: boolean, target: EditTarget = "problem") {
  const rules =
    target === "solution"
      ? `- 이번 요청은 정답과 풀이에 대한 것이다. [문제]는 한 글자도 바꾸지 말고 그대로 다시 적어라.
- 요청대로 풀이를 고치되 수학적으로 맞는지 다시 계산해서 확인하라. 정답이 틀렸으면 정답도 바로잡아라.
- 풀이에 그림이 필요하면 아래 규칙대로 SVG로 넣어도 된다.`
      : `- 요청한 부분만 고치고, 요청하지 않은 지문·숫자·보기·그림은 그대로 둬라.
- 그림(SVG)을 고치라는 요청이면 SVG 코드를 직접 고쳐서 다시 출력하라. 좌표, 점 이름, 길이·각도 표시가 문제 지문과 맞는지 확인하라.
- 숫자나 조건이 바뀌면 정답과 풀이도 바뀐 문제에 맞게 다시 계산해서 써라. 바뀌지 않으면 정답과 풀이는 그대로 둬라.${
          withImage ? "\n- 함께 보낸 사진은 원본 문제다. 그림을 원본과 같게 맞추라는 요청이면 사진을 기준으로 삼아라." : ""
        }`;
  return `너는 대한민국 중학교/고등학교 수학 출제 위원이야. 아래 문제를 선생님의 요청대로 고쳐라.

[지금 문제]
${current.question}

[지금 정답]
${current.answer || "(없음)"}

[지금 풀이]
${current.solution || "(없음)"}

[선생님 요청]
${instruction}

[고치기 원칙]
${rules}
${RULES}
[출력 양식] (설명이나 인사말 없이 아래 양식만)
[문제]
(고친 문제 지문 및 SVG)
[정답]
(정답)
[풀이]
(풀이)
`;
}

/** app.py parse_single_problem 과 같은 방식으로 [문제] [정답] [풀이] 를 나눈다 */
export function parseProblem(text: string): Generated {
  const q = text.match(/\[문제\]([\s\S]*?)(?=\[정답\]|$)/);
  const a = text.match(/\[정답\]([\s\S]*?)(?=\[풀이\]|$)/);
  const s = text.match(/\[풀이\]([\s\S]*?)$/);
  return { question: q ? q[1].trim() : text.trim(), answer: a ? a[1].trim() : "", solution: s ? s[1].trim() : "" };
}

type Tax = { grade: string; unit: string; type: string; frame: string; description: string };

export function classifyStep1(problem: string, types: [string, string, string][]) {
  const lines = types
    .slice(0, 2000)
    .map(([g, u, t], i) => `${i}. ${g} | ${u} | ${t}`)
    .join("\n");
  return `너는 대한민국 중·고등학교 수학 교육과정 전문가야. 아래 문제가 어느 학년·단원·유형인지 골라라.

[문제]
${problem}

[기존 목록] (번호. 학년 | 단원 | 유형)
${lines || "(아직 없음)"}

[규칙]
- 기존 목록에 맞는 것이 있으면 그 번호를 pick에 넣어라. 없으면 pick은 -1로 하고 새 이름을 만들어라.
- 학년 예: 중1, 중2, 중3, 공통수학1, 공통수학2, 대수, 미적분I, 확률과 통계
- 단원은 교과서 대단원/중단원 이름, 유형은 그 단원 안의 문제 유형(예: 방정식의 풀이, 활용 - 거리·속력·시간)
- semester: 그 단원을 보통 배우는 학기 ("1학기" 또는 "2학기", 고등 선택과목처럼 학기 구분이 없으면 "공통")
- 출력은 JSON 한 줄만: {"pick": 번호 또는 -1, "grade": "...", "unit": "...", "type": "...", "semester": "..."}
`;
}

export function classifyStep2(problem: string, path: [string, string, string], frames: Tax[]) {
  const lines = frames
    .slice(0, 1000)
    .map((t, i) => `${i}. ${t.frame} — ${t.description}`)
    .join("\n");
  return `너는 수학 문제 분류 전문가야. 아래 문제는 [${path.join(" › ")}] 유형이다.
이 유형 안에서 "문제틀"을 골라라. 문제틀은 숫자나 난이도만 다르고 푸는 방법과 구조가 같은 문제들의 묶음이다.

[문제]
${problem}

[기존 문제틀] (번호. 이름 — 설명)
${lines || "(아직 없음)"}

[규칙]
- 푸는 방법과 문제 구조가 같은 기존 문제틀이 있으면 그 번호를 pick에 넣어라. 없으면 pick은 -1.
- 새로 만들 때 frame은 15자 안팎의 구체적인 이름, description은 "어떤 조건에서 무엇을 어떻게 구하는 문제인지" 한 문장.
- difficulty는 이 문제의 난이도 (하/중/상 중 하나).
- 출력은 JSON 한 줄만: {"pick": 번호 또는 -1, "frame": "...", "description": "...", "difficulty": "중"}
`;
}
