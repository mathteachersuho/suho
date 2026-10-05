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
   - 점 이름(A, B, C...) 글자는 그 꼭짓점에서 6~10px 떨어진 도형 바깥쪽에 놓고, 다른 선이나 글자와 겹치지 않게 하라.
   - 색칠하는 도형은 SVG에서 가장 먼저(맨 뒤에) 그리고 fill-opacity="0.3"으로 반투명하게 해서 선과 글자를 가리지 않게 하라.
   - 정사각형, 직사각형, 정삼각형, 직각, 길이가 같은 변처럼 모양이 정확해야 하는 평면도형 그림은 SVG를 직접 그리지 말고 아래 <좌표그림> 블록에 "axes":false 를 넣어 꼭짓점 좌표를 계산해서 적어라 (축 없이 도형만 같은 비율로 그려진다).
     <좌표그림>
     {"axes":false,"points":[{"name":"A","x":0,"y":0},{"name":"B","x":5,"y":0},{"name":"C","x":5,"y":5},{"name":"D","x":0,"y":5},{"name":"E","x":5,"y":2}],"squares":["ABCD"],"polygons":["ABCD"],"shade":["BCE"],"segments":[["D","E"]]}
     </좌표그림>
     "squares": 정사각형 꼭짓점을 순서대로. 앱이 앞의 두 점(A, B)을 기준으로 나머지 두 점을 정확한 정사각형 자리로 맞춘다. "shade": 색칠할 도형 (맨 뒤에 반투명하게 칠해진다). 색칠하지 않을 도형만 있으면 "shade":[] 로 둔다.
2-1. **좌표평면 그림(함수의 그래프, 좌표 위의 점·도형) 전용 규칙 (매우 중요):**
   - 좌표평면 그림은 SVG를 직접 그리지 말고, 아래처럼 <좌표그림> 블록에 JSON 한 줄로 좌표와 식만 적어라. 앱이 계산해서 정확하게 그리고, 점 이름 글자도 꼭짓점 바로 옆 빈 곳에 알아서 놓는다.
     <좌표그림>
     {"x":[-2,17],"y":[-2,14],"graphs":[{"f":"4*x","label":"y=4x"},{"f":"180/x","label":"y=a/x"}],"points":[{"name":"A","x":3,"on":0},{"name":"B","x":3,"y":0},{"name":"C","x":15,"y":0},{"name":"D","x":15,"on":1}],"polygons":["ABCD"],"segments":[]}
     </좌표그림>
   - "x", "y": 보이는 범위 [최소, 최대]. 모든 점과 그래프의 중요한 부분이 들어가고 원점이 보이게 조금 여유를 둬라.
   - "graphs": "f"는 x에 대한 식 (곱하기 *, 나누기 /, 거듭제곱 ^, sqrt(), abs()). 수직선 x=3 은 {"x":3}. 점선이면 "dashed":true. 문제에서 a, k처럼 문자로 둔 상수도 그림은 계산한 실제 값으로 그리고, "label"에만 문자를 써라.
   - "points": 그래프 위의 점은 "x"와 "on"(graphs 번호, 0부터)만 적어라. 앱이 y를 계산해 정확히 그래프 위에 찍는다. 다른 점은 "x", "y"를 적어라. 좌표까지 보여 줄 점은 "label":"B(3, 0)". 원점 O는 따로 적지 않아도 앱이 표시한다.
   - "polygons": 꼭짓점 이름을 순서대로 이어 쓴다 ("ABCD"). "segments": [["A","C"]] 처럼 선분. 격자가 필요하면 "grid":true. 정사각형은 "squares":["ABCD"]도 함께 적고, 색칠할 도형만 "shade"에 적어라 (없으면 polygons 모두 옅게 칠해진다).
   - 문제 조건(점이 그래프 위에 있다, 정사각형이다, 변이 축에 평행하다 등)이 그림에서 정확히 맞도록 좌표를 계산해서 적어라.
   - 문제를 고칠 때 받은 <좌표그림> 블록은 SVG로 바꾸지 말고 블록 그대로 고쳐서 다시 적어라.
3. **정육면체 겨냥도/전개도:**
   - 3D 겨냥도는 3면 큐브 SVG로, 펼쳐진 전개도는 3x4 마크다운 격자 표로 작성하라.
4. **수식 표기:** 지문 본문에서 단순 문자(A, B, C, 보기 ㄱ, ㄴ, ㄷ 등)에는 $를 쓰지 말고, 분수식/계산식만 \`$수식$\`으로 작성하라.
`;

const TYPE_INSTRUCTION: Record<GenKind, string> = {
  0: `[원본 문제 다시 쓰기 원칙 (새 문제를 만들지 마라!)]
- 원본 문제의 지문, 숫자, 조건, 보기, 묻는 것을 **하나도 바꾸지 말고 그대로** 옮겨 적어라. 숫자를 바꾸거나 문제를 쉽게/어렵게 고치지 마라.
- 글자 인식(OCR) 과정에서 깨진 수식, 빠진 기호, 잘못 읽힌 글자는 문맥(과 함께 보낸 사진)에 맞게 바로잡아라.
- 사진이 함께 왔다면 사진을 기준으로 삼아라. 사진 속 도형, 그래프, 수직선, 표는 아래 규칙대로 SVG나 표로 **사진과 같게** 다시 그려라 (좌표평면 그림은 아래 <좌표그림> 규칙으로) (점 이름, 표시된 길이·각도, 위치 관계를 그대로). 정확하게 그리는 것이 줄 수보다 중요하다.
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
/** bank = 문제 은행에 이미 있는 같은 유형 문제 (겹치지 않게) */
export type Variation = { index?: number; total?: number; avoid?: string[]; bank?: string[] };

/** 여러 문제를 만들 때 번호마다 바꾸는 방향 (같은 문제가 덜 나오게) */
const VARY = [
  "숫자와 계수를 모두 새로 고른다.",
  "묻는 것을 바꾼다 (예: 값을 구하던 것을 조건을 만족하는 미지수 구하기로).",
  "주어진 조건과 구할 것을 맞바꿔 거꾸로 묻는다.",
  "그래프·도형의 위치나 모양(부호, 사분면, 기울기 방향 등)을 바꾼다.",
  "같은 개념을 실생활 상황이나 다른 표현(표, 그래프, 문장)으로 바꾼다.",
  "조건 하나를 더하거나 빼서 풀이 단계를 바꾼다.",
  "답이 분수나 음수가 되도록 숫자를 고른다.",
  "같은 유형 안에서 다른 접근(식 세우기, 그래프 읽기, 넓이·길이 활용 등)이 필요하게 만든다.",
];

function variationText(kind: GenKind, v: Variation) {
  if (kind === 0) return "";
  const lines: string[] = [];
  if ((v.total ?? 1) > 1)
    lines.push(
      `- 이 문제는 같은 종류 ${v.total}문제 중 ${v.index}번째다. 다른 번호 문제와 숫자·조건·상황이 겹치지 않게, ${v.index}번째에 맞는 서로 다른 값과 접근을 골라라.`,
      `- 원본과 똑같은 문제나 원본 숫자를 그대로 쓴 문제는 안 된다. 이번 문제는 이렇게 바꿔라: ${VARY[((v.index ?? 1) - 1) % VARY.length]}`,
    );
  if (v.bank?.length)
    lines.push(
      `- 아래는 문제 은행에 이미 있는 같은 유형 문제다. 이것들과 숫자·조건·답이 같은 문제를 만들지 마라. 상황이나 말만 바꾸고 숫자와 답이 같으면 같은 문제다.\n${v.bank.map((q, i) => `(은행 ${i + 1}) ${q}`).join("\n")}`,
    );
  if (v.avoid?.length)
    lines.push(`- 아래 문제들은 이미 만들었다. 이것들과 숫자·조건이 같거나 거의 같은 문제를 만들지 마라. 상황이나 말만 바꾸고 숫자와 답이 같으면 같은 문제다.\n${v.avoid.map((q, i) => `(${i + 1}) ${q}`).join("\n")}`);
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
- 그림을 고치라는 요청이면 SVG 코드를 직접 고쳐서 다시 출력하라. <좌표그림> 블록이면 블록의 좌표·식을 고쳐라. 좌표, 점 이름, 길이·각도 표시가 문제 지문과 맞는지 확인하라.
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
