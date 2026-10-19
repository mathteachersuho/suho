/*
 * 풀이에 문제 학년에서 아직 배우지 않은 표현이 있는지 글자로 찾는다 (예: 중1 해설의 가우스 기호, 지수법칙 공식).
 * AI가 만든 풀이를 한 번 더 고치게 하거나, 화면에 경고를 띄우는 데 쓴다. 확실한 표현만 찾으므로 못 찾는 경우도 있다.
 */

/** 학년 순서. 고등 과목은 대략 배우는 순서 */
const ORDER: [RegExp, number][] = [
  [/^(중\s*1|중학교\s*1|중등\s*1)/, 1],
  [/^(중\s*2|중학교\s*2|중등\s*2)/, 2],
  [/^(중\s*3|중학교\s*3|중등\s*3)/, 3],
  [/^(공통\s*수학\s*1|공통\s*수학\s*I(?!I)|수학\s*\(?상\)?)/, 4],
  [/^(공통\s*수학\s*2|공통\s*수학\s*II|수학\s*\(?하\)?)/, 5],
];

export function gradeOrder(grade: string | undefined): number | null {
  const g = (grade ?? "").replace(/\s+/g, " ").trim();
  for (const [re, n] of ORDER) if (re.test(g)) return n;
  return null;
}

/** from = 이 표현을 처음 배우는 학년 순서 (ORDER). 그보다 낮은 학년 풀이에 나오면 경고 */
const RULES: { label: string; from: number; re: RegExp }[] = [
  { label: "가우스 기호 [x]", from: 6, re: /\\lfloor|\\rfloor|⌊|⌋|가우스|\\left\s*\[[^\]]*\/|\[\s*\d+\s*\/\s*\d+\s*\]/ },
  { label: "지수법칙 공식 ((a^m)^n 꼴)", from: 2, re: /\([^()]*(\^|\\times|×|\\cdot)[^()]*\)\s*\^|지수\s*법칙/ },
  { label: "순환소수", from: 2, re: /순환\s*소수/ },
  { label: "연립방정식", from: 2, re: /연립/ },
  { label: "일차부등식의 풀이", from: 2, re: /일차\s*부등식/ },
  { label: "함수 기호 f(x)", from: 2, re: /f\s*\(\s*[x0-9-]/ },
  { label: "일차함수의 기울기·절편", from: 2, re: /기울기|y\s*절편|x\s*절편|일차\s*함수/ },
  { label: "피타고라스 정리", from: 2, re: /피타고라스/ },
  { label: "닮음", from: 2, re: /닮음/ },
  { label: "확률", from: 2, re: /확률/ },
  { label: "제곱근·√", from: 3, re: /\\sqrt|√|제곱근/ },
  { label: "곱셈공식·인수분해", from: 3, re: /곱셈\s*공식|(?<!소)인수\s*분해/ },
  { label: "이차방정식·근의 공식", from: 3, re: /이차\s*방정식|근의\s*공식/ },
  { label: "이차함수", from: 3, re: /이차\s*함수/ },
  { label: "삼각비 (sin, cos, tan)", from: 3, re: /삼각비|\\(sin|cos|tan)\b/ },
  { label: "원주각", from: 3, re: /원주각/ },
  { label: "분산·표준편차", from: 3, re: /분산|표준\s*편차/ },
  { label: "판별식", from: 4, re: /판별식/ },
  { label: "복소수·허수", from: 4, re: /복소수|허수/ },
  { label: "근과 계수의 관계", from: 4, re: /근과\s*계수/ },
  { label: "나머지정리·조립제법", from: 4, re: /나머지\s*정리|조립\s*제법/ },
  { label: "순열·조합 기호 (nPr, nCr)", from: 4, re: /_\{?[\dnr]+\}?\s*(\\mathrm\{)?[PC]\}?\s*_|순열/ },
  { label: "볼록 (이차함수 용어)", from: 3, re: /볼록/ },
  { label: "± 기호", from: 3, re: /\\pm|±/ },
  { label: "논리 기호 ⟹", from: 5, re: /\\implies|\\Rightarrow|⟹|⇒/ },
  { label: "gcd·lcm 기호", from: 6, re: /\\gcd|\\operatorname\{(gcd|lcm)\}|\b(gcd|lcm)\s*\(/ },
  { label: "집합 기호 (∈, ⊂)", from: 5, re: /\\in\b|\\subset|∈|⊂/ },
  { label: "산술·기하평균", from: 5, re: /산술\s*평균|기하\s*평균/ },
  { label: "로그", from: 6, re: /\\log|로그/ },
  { label: "Σ (시그마)", from: 6, re: /\\sum|Σ|시그마/ },
  { label: "극한", from: 6, re: /\\lim|극한/ },
  { label: "미분·적분", from: 6, re: /\\int|미분|적분|도함수/ },
];

/** AI에게 풀이를 학년에 맞게 다시 쓰라고 할 때 쓰는 요청 */
export function rewriteInstruction(grade: string, found: string[]) {
  return `풀이에 ${grade}에서 아직 배우지 않은 표현(${found.join(", ")})이 있다. 정답은 그대로 두고, 이 표현을 쓰지 말고 ${grade}에서 배우는 개념과 방식만으로 풀이를 다시 써라.`;
}

/** 풀이에서 그 학년에서 아직 배우지 않은 표현의 이름들 (없으면 빈 배열). 학년을 모르면 찾지 않는다. */
export function outOfLevel(grade: string | undefined, text: string): string[] {
  const n = gradeOrder(grade);
  if (n === null || !text) return [];
  return RULES.filter((r) => n < r.from && r.re.test(text)).map((r) => r.label);
}
